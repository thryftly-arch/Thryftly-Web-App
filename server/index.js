import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

try { process.loadEnvFile(); } catch { /* no .env: rely on real env vars */ }

const { db, save, id, UPLOAD_DIR } = await import('./store.js');
const I = await import('./integrations.js');

const PROD = process.env.NODE_ENV === 'production';
const PORT = +process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || (PROD ? '' : 'dev-only-secret');
if (PROD && (!SESSION_SECRET || !process.env.ADMIN_PASSWORD)) {
  console.error('Refusing to start: set SESSION_SECRET and ADMIN_PASSWORD in production.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://*.razorpay.com'],
      frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
      mediaSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

/* ---------------- helpers ---------------- */
const fail = (res, code, error) => res.status(code).json({ error });
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const num = (v, min = 0, max = 1e7) => Math.min(max, Math.max(min, Number(v) || 0));
const imgUrl = v => { const s = str(v, 500); return s.startsWith('/uploads/') || s.startsWith('https://') ? s : ''; };
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const publicProduct = p => ({
  slug: p.slug, name: p.name, edition: p.edition, price: p.price, category: p.category, badge: p.badge, badgeStyle: p.badgeStyle,
  tag: p.tag, color: p.color, fitLabel: p.fitLabel, description: p.description, specs: p.specs, images: p.images,
  tryonImage: p.tryonImage, ringLabel: p.ringLabel, featured: p.featured, inRotation: p.inRotation,
  sizes: p.sizes.map(s => ({ label: s.label, available: s.stock > 0 })),
});
const activeProducts = () => db.products.filter(p => p.active).sort((a, b) => a.sort - b.sort);

/* ---------------- Razorpay webhook (needs the raw body, so before express.json) ---------------- */
app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), wrap(async (req, res) => {
  if (!I.razorpayVerifyWebhook(req.body, req.get('x-razorpay-signature'))) return fail(res, 400, 'bad signature');
  const evt = JSON.parse(req.body.toString());
  const pay = evt.payload?.payment?.entity;
  if (pay && ['payment.captured', 'order.paid'].includes(evt.event)) {
    const order = db.orders.find(o => o.razorpayOrderId === pay.order_id);
    if (order) await markPaid(order, pay.id);
  }
  res.json({ ok: true });
}));

app.use(express.json({ limit: '12mb' })); // try-on photos come in as base64

/* ---------------- public API ---------------- */
app.get('/api/site', (req, res) => {
  res.json({ settings: db.settings, products: activeProducts().map(publicProduct), payments: I.razorpayConfigured() });
});

app.get('/api/products/:slug', (req, res) => {
  const p = activeProducts().find(p => p.slug === req.params.slug);
  p ? res.json(publicProduct(p)) : fail(res, 404, 'not found');
});

app.post('/api/subscribe', rateLimit({ windowMs: 15 * 60e3, limit: 20 }), (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (!db.subscribers.some(s => s.email === email)) { db.subscribers.push({ email, at: new Date().toISOString() }); save(); }
  res.json({ ok: true });
});

/* ---------------- checkout ---------------- */
function priceCart(items) {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Your cart is empty');
  const lines = items.map(it => {
    const p = activeProducts().find(p => p.slug === it.slug);
    const s = p?.sizes.find(s => s.label === it.size);
    const qty = Math.floor(num(it.qty, 1, 5));
    if (!p || !s) throw new Error('An item in your cart is no longer available');
    if (s.stock < qty) throw new Error(`${p.name} (${s.label}) is sold out`);
    return { productId: p.id, slug: p.slug, name: p.name, size: s.label, sku: s.sku, qty, price: p.price };
  });
  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const { shippingFee, freeShippingOver } = db.settings;
  const shipping = freeShippingOver && subtotal >= freeShippingOver ? 0 : shippingFee || 0;
  return { lines, subtotal, shipping, amount: subtotal + shipping };
}

app.post('/api/cart/quote', (req, res) => {
  try { res.json(priceCart(req.body.items)); } catch (e) { fail(res, 400, e.message); }
});

const customerFields = ['name', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'zip'];
function readCustomer(b = {}) {
  const c = Object.fromEntries(customerFields.map(k => [k, str(b[k], 200)]));
  if (!c.name || !c.address1 || !c.city || !c.state) throw new Error('Fill in your name and full address');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)) throw new Error('Enter a valid email');
  if (!/^[6-9]\d{9}$/.test(c.phone.replace(/\D/g, '').slice(-10))) throw new Error('Enter a valid 10-digit mobile number');
  if (!/^\d{6}$/.test(c.zip)) throw new Error('Enter a valid 6-digit PIN code');
  c.phone = c.phone.replace(/\D/g, '').slice(-10);
  return c;
}

app.post('/api/checkout', rateLimit({ windowMs: 15 * 60e3, limit: 30 }), wrap(async (req, res) => {
  if (!I.razorpayConfigured()) return fail(res, 503, 'Payments are not set up yet');
  let cart, customer;
  try { cart = priceCart(req.body.items); customer = readCustomer(req.body.customer); } catch (e) { return fail(res, 400, e.message); }
  const order = {
    id: id(),
    number: 'TH' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase(),
    items: cart.lines, subtotal: cart.subtotal, shipping: cart.shipping, amount: cart.amount,
    currency: db.settings.currency, customer, status: 'created', createdAt: new Date().toISOString(),
  };
  const rp = await I.razorpayCreateOrder({ amount: order.amount, currency: order.currency, receipt: order.number });
  order.razorpayOrderId = rp.id;
  db.orders.push(order); save();
  res.json({ orderId: order.id, number: order.number, key: process.env.RAZORPAY_KEY_ID, razorpayOrderId: rp.id, amount: rp.amount, currency: rp.currency, customer });
}));

app.post('/api/checkout/verify', wrap(async (req, res) => {
  const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const order = db.orders.find(o => o.id === orderId && o.razorpayOrderId === razorpay_order_id);
  if (!order) return fail(res, 404, 'Order not found');
  if (!I.razorpayVerifyPayment(razorpay_order_id, razorpay_payment_id, razorpay_signature)) return fail(res, 400, 'Payment could not be verified');
  await markPaid(order, razorpay_payment_id);
  res.json({ number: order.number, status: order.status });
}));

// Idempotent: the browser callback and the webhook may both arrive.
async function markPaid(order, paymentId) {
  if (order.status !== 'created') return;
  order.status = 'paid'; order.paymentId = paymentId; order.paidAt = new Date().toISOString();
  for (const l of order.items) {
    const s = db.products.find(p => p.id === l.productId)?.sizes.find(s => s.label === l.size);
    if (s) s.stock -= l.qty;
    if (s && s.stock < 0) { s.stock = 0; order.oversold = true; } // two people paid for a 1-of-1: refund one by hand
  }
  save();
  await fulfill(order);
}

async function fulfill(order) {
  if (!['paid', 'fulfillment_failed'].includes(order.status)) return;
  if (!I.qikinkConfigured()) { order.fulfillmentError = 'Qikink not configured'; order.status = 'fulfillment_failed'; return save(); }
  const missing = order.items.filter(i => !i.sku);
  if (missing.length) { order.status = 'fulfillment_failed'; order.fulfillmentError = 'No Qikink SKU for: ' + missing.map(i => `${i.name} ${i.size}`).join(', '); return save(); }
  try {
    order.qikink = await I.qikinkCreateOrder(order);
    order.status = 'sent_to_qikink'; delete order.fulfillmentError;
  } catch (e) {
    order.status = 'fulfillment_failed'; order.fulfillmentError = e.message;
  }
  save();
}

/* ---------------- AI try-on (local Ollama) ---------------- */
app.get('/api/tryon/status', wrap(async (req, res) => res.json(await I.ollamaStatus())));

app.post('/api/tryon', rateLimit({ windowMs: 60e3, limit: 6 }), wrap(async (req, res) => {
  const p = activeProducts().find(p => p.slug === req.body.slug);
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(req.body.image || ''));
  if (!p || !m) return fail(res, 400, 'Send a product and a PNG/JPEG photo');
  const status = await I.ollamaStatus();
  if (!status.ready) return fail(res, 503, status.up ? `AI model ${status.model} is not installed on the server` : 'AI stylist is offline');
  res.json({ text: await I.ollamaStylist({ imageBase64: m[2], product: p }) });
}));

/* ---------------- admin auth ---------------- */
const sign = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const cookie = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)));
function isAdmin(req) {
  const [exp, sig] = String(cookie(req).th_admin || '').split('.');
  return !!exp && +exp > Date.now() && !!sig && sig.length === 64 && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sign(exp)));
}
const admin = express.Router();

app.post('/api/admin/login', rateLimit({ windowMs: 15 * 60e3, limit: 10 }), (req, res) => {
  const want = process.env.ADMIN_PASSWORD;
  if (!want) return fail(res, 503, 'Set ADMIN_PASSWORD on the server first');
  const h = s => crypto.createHash('sha256').update(String(s)).digest();
  if (!crypto.timingSafeEqual(h(req.body.password), h(want))) return fail(res, 401, 'Wrong password');
  const exp = String(Date.now() + 12 * 3600e3);
  res.cookie('th_admin', `${exp}.${sign(exp)}`, { httpOnly: true, sameSite: 'strict', secure: PROD, maxAge: 12 * 3600e3, path: '/' });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.clearCookie('th_admin', { path: '/' }); res.json({ ok: true }); });
app.use('/api/admin', (req, res, next) => (isAdmin(req) ? next() : fail(res, 401, 'Not signed in')), admin);

admin.get('/me', (req, res) => res.json({ ok: true, qikink: I.qikinkConfigured(), razorpay: I.razorpayConfigured(), qikinkBase: process.env.QIKINK_BASE_URL || 'https://sandbox.qikink.com' }));

/* settings: only keys that exist in the seed, coerced to the same type */
admin.get('/settings', (req, res) => res.json(db.settings));
admin.put('/settings', (req, res) => {
  for (const [k, cur] of Object.entries(db.settings)) {
    if (!(k in req.body)) continue;
    const v = req.body[k];
    if (Array.isArray(cur)) db.settings[k] = (Array.isArray(v) ? v : []).map(x => str(x, 120)).filter(Boolean).slice(0, 20);
    else if (typeof cur === 'number') db.settings[k] = num(v);
    else if (typeof cur === 'object') db.settings[k] = Object.fromEntries(Object.keys(cur).map(s => [s, str(v?.[s], 300)]));
    else db.settings[k] = k.endsWith('Image') ? imgUrl(v) : str(v, 600);
  }
  save(); res.json(db.settings);
});

/* products */
function readProduct(b, prev = {}) {
  const slug = str(b.slug || b.name, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug || !str(b.name)) throw new Error('Name is required');
  if (db.products.some(p => p.slug === slug && p.id !== prev.id)) throw new Error('Another product already uses that URL slug');
  return {
    ...prev, slug,
    name: str(b.name, 80).toUpperCase(), edition: str(b.edition, 20), price: num(b.price), category: str(b.category, 40).toUpperCase(),
    badge: str(b.badge, 20).toUpperCase(), badgeStyle: b.badgeStyle === 'red' ? 'red' : 'yellow', tag: str(b.tag, 40).toUpperCase(),
    color: str(b.color, 40).toUpperCase(), fitLabel: str(b.fitLabel, 40).toUpperCase(), description: str(b.description, 2000),
    ringLabel: str(b.ringLabel, 40),
    sizes: (Array.isArray(b.sizes) ? b.sizes : []).slice(0, 12).map(s => ({ label: str(s.label, 10).toUpperCase(), stock: Math.floor(num(s.stock, 0, 99999)), sku: str(s.sku, 80) })).filter(s => s.label),
    specs: (Array.isArray(b.specs) ? b.specs : []).slice(0, 12).map(s => ({ k: str(s.k, 30).toUpperCase(), v: str(s.v, 120) })).filter(s => s.k),
    images: Object.fromEntries(['front', 'back', 'detail', 'onBody'].map(k => [k, imgUrl(b.images?.[k])])),
    tryonImage: imgUrl(b.tryonImage),
    featured: !!b.featured, inRotation: !!b.inRotation, active: !!b.active, sort: num(b.sort, -1e4, 1e4),
  };
}
admin.get('/products', (req, res) => res.json([...db.products].sort((a, b) => a.sort - b.sort)));
admin.post('/products', (req, res) => {
  try { const p = readProduct(req.body, { id: id() }); db.products.push(p); save(); res.json(p); } catch (e) { fail(res, 400, e.message); }
});
admin.put('/products/:id', (req, res) => {
  const i = db.products.findIndex(p => p.id === req.params.id);
  if (i < 0) return fail(res, 404, 'not found');
  try { db.products[i] = readProduct(req.body, db.products[i]); save(); res.json(db.products[i]); } catch (e) { fail(res, 400, e.message); }
});
admin.delete('/products/:id', (req, res) => {
  db.products = db.products.filter(p => p.id !== req.params.id); save(); res.json({ ok: true });
});

/* images */
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }; // no SVG: it can carry script
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, f, cb) => cb(null, Date.now().toString(36) + crypto.randomBytes(6).toString('hex') + EXT[f.mimetype]) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(EXT[f.mimetype] ? null : new Error('Use PNG, JPG, WEBP or GIF'), !!EXT[f.mimetype]),
});
admin.post('/upload', upload.single('file'), (req, res) => res.json({ url: '/uploads/' + req.file.filename }));
admin.get('/uploads', (req, res) => {
  const files = fs.readdirSync(UPLOAD_DIR).filter(f => !f.startsWith('.')).map(f => ({ url: '/uploads/' + f, at: fs.statSync(path.join(UPLOAD_DIR, f)).mtimeMs }));
  res.json(files.sort((a, b) => b.at - a.at));
});

/* orders, subscribers, Qikink */
admin.get('/orders', (req, res) => res.json([...db.orders].reverse()));
admin.post('/orders/:id/fulfill', wrap(async (req, res) => {
  const o = db.orders.find(o => o.id === req.params.id);
  if (!o) return fail(res, 404, 'not found');
  await fulfill(o); res.json(o);
}));
admin.get('/subscribers', (req, res) => res.json(db.subscribers));
admin.get('/qikink/orders', wrap(async (req, res) => res.json(await I.qikinkOrders())));

/* ---------------- static ---------------- */
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
if (PROD) {
  const dist = path.resolve('dist');
  app.use(express.static(dist, { extensions: ['html'], setHeaders: (res, f) => { if (f.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.use((req, res) => res.status(404).sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  fail(res, err.status || (err instanceof multer.MulterError ? 400 : 500), err instanceof multer.MulterError || err.message?.startsWith('Use ') ? err.message : 'Something went wrong');
});

app.listen(PORT, () => console.log(`THRYFTLY server on http://localhost:${PORT} (${PROD ? 'production' : 'dev'})`));
