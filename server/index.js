import './env.js'; // first: loads .env before the store reads it
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

import * as S from './store.js';
import * as I from './integrations.js';
import * as M from './mail.js';

const { db, save, id, UPLOAD_DIR, DATA_DIR } = S;

// LAMBDA: running as the Netlify function (netlify/functions/api.mjs), not as a long-lived server.
const LAMBDA = !!process.env.LAMBDA_TASK_ROOT;
const PROD = process.env.NODE_ENV === 'production' || LAMBDA;
// --port=N (npm run dev pins 3000: the preview launcher sets PORT to Vite's port) beats $PORT.
const PORT = +(process.argv.find(a => a.startsWith('--port='))?.slice(7)) || +process.env.PORT || 3000;
const siteUrl = () => (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || (PROD ? '' : 'dev-only-secret');
if (PROD && (!SESSION_SECRET || !process.env.ADMIN_PASSWORD)) {
  const msg = 'Refusing to start: set SESSION_SECRET and ADMIN_PASSWORD in production.';
  if (LAMBDA) throw new Error(msg);
  console.error(msg);
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
      scriptSrc: ["'self'", 'https://checkout.razorpay.com', 'https://www.googletagmanager.com', 'https://connect.facebook.net'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://*.razorpay.com', 'https://*.supabase.co', 'https://*.google-analytics.com', 'https://www.googletagmanager.com', 'https://www.facebook.com'],
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

// Public catalogue responses: with Supabase, image paths point straight at Supabase's CDN
// (no hop through this server or Netlify).
const pubJson = (res, v) => (S.remote ? res.type('application/json').send(JSON.stringify(v).replaceAll('"/uploads/', '"' + S.fileUrl(''))) : res.json(v));
// Netlify's edge keeps public catalogue responses for a minute and serves the old copy instantly while
// it fetches a new one, so a page rarely waits on the function. Admin saves purge it (purgeSite).
const edgeCache = res => res.set({ 'Cache-Control': 'public, max-age=0, must-revalidate', 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=60, stale-while-revalidate=604800', 'Netlify-Cache-Tag': 'site' });
// Netlify injects SITE_ID and NETLIFY_PURGE_API_TOKEN into functions; elsewhere this does nothing.
function purgeSite() {
  if (!process.env.NETLIFY_PURGE_API_TOKEN || !process.env.SITE_ID) return Promise.resolve();
  return fetch('https://api.netlify.com/api/v1/purge', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.NETLIFY_PURGE_API_TOKEN },
    body: JSON.stringify({ site_id: process.env.SITE_ID, cache_tags: ['site'] }), signal: AbortSignal.timeout(5000),
  }).catch(e => console.error('purge failed', e.message));
}

const publicProduct = p => ({
  slug: p.slug, name: p.name, edition: p.edition, price: p.price, category: p.category, badge: p.badge, badgeStyle: p.badgeStyle,
  tag: p.tag, color: p.color, fitLabel: p.fitLabel, description: p.description, specs: p.specs, images: p.images, colorImages: p.colorImages || {}, colorBacks: p.colorBacks || {},
  model3d: p.model3d || '', printFront: p.printFront || '', printBack: p.printBack || '',
  tryonImage: p.tryonImage, ringLabel: p.ringLabel, featured: p.featured, inRotation: p.inRotation,
  sizes: p.sizes.map(s => ({ label: s.label, color: s.color || '', price: s.price || p.price, compare: s.compare > (s.price || p.price) ? s.compare : 0, available: s.stock > 0 && (!!s.sku || !I.qikinkConfigured()) })),
  unlocksAt: lockedUntil(p.id),
  sizeChart: chartFor(p), seoTitle: p.seoTitle || '', seoDescription: p.seoDescription || '',
});
// Products without a chart picked get one from what they are, using the same split Shopify had:
// zip → zip hoodie; hoodies by fit; tees by fabric (acid wash / terry / classic); oversized sweatshirts and shirts.
// Jackets, bottoms, combos and regular-fit sweatshirts have no chart. "none" on a product turns it off.
function autoChart(p) {
  const t = `${p.name} ${p.description}`, cat = p.category;
  if (/\bzip/i.test(t) && cat === 'HOODIES') return 'zipper';
  if (cat === 'HOODIES') return /regular fit/i.test(t) && !/oversized/i.test(t) ? 'hoodie' : 'ohoodie';
  if (cat === 'SWEATSHIRTS') return /oversized/i.test(t) ? 'osweatshirt' : '';
  if (cat === 'SHIRTS') return /oversized/i.test(t) ? 'oshirt' : '';
  if (cat === 'TEES' || /\b(tee|t-shirt)\b/i.test(p.name) || /terry-knit/i.test(t)) return /acid/i.test(t) ? 'acid-wash' : /terry/i.test(t) ? 'terry' : 'classic';
  return '';
}
const chartKey = p => p.sizeChart || autoChart(p);
const chartFor = p => { const c = chartKey(p) && db.sizeCharts.find(c => c.key === chartKey(p)); return c && (c.image || c.note || c.table) ? { title: c.title, image: c.image, table: c.table || '', note: c.note } : null; };

/* ---------------- email helpers ---------------- */
const sym = () => db.settings.symbol || '₹';
// Absolute image URL (emails, feeds, social previews).
const absImg = u => (!u ? '' : u.startsWith('/uploads/') ? (S.remote ? S.fileUrl(u.slice(9)) : siteUrl() + u) : u);
const itemImage = i => { const p = db.products.find(p => p.id === i.productId); return p ? p.colorImages?.[i.color] || p.images.front : ''; };
const mailOrder = (to, build, o) => M.send(to, build({ ...o, items: o.items.map(i => ({ ...i, image: itemImage(i) })) }, sym(), absImg));
const token = v => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex').slice(0, 32);
const unsubUrl = email => `${siteUrl()}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${token('unsub:' + email)}`;
const activeProducts = () => db.products.filter(p => p.active).sort((a, b) => a.sort - b.sort);

// Drops that are switched on and haven't ended. Products in a drop that hasn't opened yet are
// visible as teasers but can't be bought until it opens.
const liveDrops = () => db.drops.filter(d => d.active && !(d.endsAt && Date.parse(d.endsAt) < Date.now()));
const lockedUntil = id => {
  const d = liveDrops().find(d => d.productIds.includes(id) && d.startsAt && Date.parse(d.startsAt) > Date.now());
  return d ? d.startsAt : '';
};

/* ---------------- Supabase: fresh data in, every change saved before the reply ---------------- */
// Reads use data at most 5s old. A write waits its turn, reloads, and its reply is held until the save lands,
// so nothing is lost when Netlify freezes the function after replying.
app.use(['/api', '/wp-json'], wrap(async (req, res, next) => {
  if (!S.remote || req.originalUrl.startsWith('/api/account/wishlist')) return next();
  const json = res.json.bind(res);
  res.json = body => {
    const p = S.flush();
    if (!p) return json(body);
    p.then(() => json(body), e => { console.error(e); res.status(500); json({ error: 'Could not save. Try again.' }); });
    return res;
  };
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (!S.isBusy()) await S.load(5000);
    return next();
  }
  const release = await S.lock();
  res.once('finish', release); res.once('close', release);
  // A write that failed may have left half-changed data in memory: read everything fresh next time.
  res.once('finish', () => { if (res.statusCode >= 400) S.invalidate(); });
  // Catalogue changes (admin, Qikink pushes, stock after a sale) should show up now, not in a minute.
  if (/^\/(api\/admin|wp-json|api\/webhooks|api\/checkout\/verify)/.test(req.originalUrl) && !req.originalUrl.startsWith('/api/admin/login')) res.once('finish', purgeSite);
  try { await S.load(); } catch (e) { release(); throw e; }
  next();
}));

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
  const slugOf = Object.fromEntries(db.products.filter(p => p.active).map(p => [p.id, p.slug]));
  const drops = liveDrops().map(d => ({ id: d.id, name: d.name, tagline: d.tagline, description: d.description, banner: d.banner, startsAt: d.startsAt, endsAt: d.endsAt, products: d.productIds.map(i => slugOf[i]).filter(Boolean) }));
  const auth = S.remote && process.env.SUPABASE_PUBLISHABLE_KEY ? { url: process.env.SUPABASE_URL.replace(/\/+$/, ''), key: process.env.SUPABASE_PUBLISHABLE_KEY } : null;
  edgeCache(res);
  pubJson(res, { settings: db.settings, pages: db.pages, drops, products: activeProducts().map(publicProduct), payments: I.razorpayConfigured(), auth });
});

app.get('/api/products/:slug', (req, res) => {
  const p = activeProducts().find(p => p.slug === req.params.slug);
  if (!p) return fail(res, 404, 'not found');
  edgeCache(res);
  pubJson(res, publicProduct(p));
});

app.post('/api/subscribe', rateLimit({ windowMs: 15 * 60e3, limit: 20 }), wrap(async (req, res) => {
  const email = str(req.body.email, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'Enter a valid email');
  if (!db.subscribers.some(s => s.email === email)) {
    db.subscribers.push({ email, at: new Date().toISOString() });
    save();
    await M.send(email, M.welcomeSubscriber(email, db.settings.welcomeCode, unsubUrl(email)));
  }
  res.json({ ok: true });
}));

// One-click unsubscribe from the link in drop-list emails.
app.get('/api/unsubscribe', wrap(async (req, res) => {
  const email = str(req.query.e, 200).toLowerCase(), ok = email && str(req.query.t, 64) === token('unsub:' + email);
  if (ok && db.subscribers.some(s => s.email === email)) { db.subscribers = db.subscribers.filter(s => s.email !== email); await save(); }
  res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>THRYFTLY</title><body style="margin:0;background:#0b0b0c;color:#fff;font:16px Arial;display:grid;place-items:center;min-height:100vh;text-align:center"><div><h1 style="font:900 italic 34px Arial Black,Arial">${ok ? "YOU'RE <span style=color:#FF3B3B>UNSUBSCRIBED.</span>" : 'LINK <span style=color:#FF3B3B>EXPIRED.</span>'}</h1><p>${ok ? "You won't get drop emails any more. Order emails still arrive." : 'Reply to any of our emails and we will remove you.'}</p><p><a href="/" style="color:#FFD84D">Back to the shop</a></p></div>`);
}));

app.post('/api/contact', rateLimit({ windowMs: 15 * 60e3, limit: 5 }), wrap(async (req, res) => {
  const m = { id: id(), name: str(req.body.name, 100), email: str(req.body.email, 200).toLowerCase(), order: str(req.body.order, 30), message: str(req.body.message, 3000), at: new Date().toISOString(), read: false };
  if (!m.name || !m.message) return fail(res, 400, 'Add your name and a message');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email)) return fail(res, 400, 'Enter a valid email');
  db.messages.push(m); save();
  // To the shop (reply goes straight to the customer) and a "we got it" to the customer.
  await Promise.all([M.send(M.ownerEmail(), M.contactToOwner(m), { replyTo: m.email }), M.send(m.email, M.contactAutoReply(m))]);
  res.json({ ok: true });
}));

// Customer order tracking: needs the order number AND the email it was placed with.
const CUSTOMER_STATUS = { created: 'AWAITING PAYMENT', paid: 'CONFIRMED', sent_to_qikink: 'IN PRODUCTION', fulfillment_failed: 'CONFIRMED', refunded: 'CANCELLED & REFUNDED' };

// Qikink's status and tracking onto an order. Emails the customer once when it ships and once when it's delivered.
async function applyQikink(o, q) {
  o.qikinkStatus = q.status;
  if (q.shipping?.tracking_link) o.tracking = { awb: q.shipping.awb, url: q.shipping.tracking_link, courier: q.shipping.courier_provider_name };
  o.mailed ||= {};
  const jobs = [];
  if (o.tracking?.url && !o.mailed.shipped) { o.mailed.shipped = true; jobs.push(mailOrder(o.customer.email, M.orderShipped, o)); }
  if (/deliver/i.test(q.status || '') && !/undeliver|rto|return/i.test(q.status) && !o.mailed.delivered) { o.mailed.delivered = true; jobs.push(mailOrder(o.customer.email, M.orderDelivered, o)); }
  await Promise.all(jobs);
}

// Status + tracking for every open order. Qikink pages at 10, so ask in chunks of 10.
async function syncQikink() {
  if (!I.qikinkConfigured()) return 0;
  const open = db.orders.filter(o => o.qikink?.order_id && o.status !== 'refunded' && !/deliver|cancel|return/i.test(o.qikinkStatus || ''));
  for (let i = 0; i < open.length; i += 10) {
    const chunk = open.slice(i, i + 10);
    for (const q of await I.qikinkOrders({ ids: chunk.map(o => o.qikink.order_id).join(',') })) {
      const o = chunk.find(o => String(o.qikink.order_id) === String(q.order_id));
      if (o) await applyQikink(o, q);
    }
  }
  return open.length;
}
app.post('/api/track', rateLimit({ windowMs: 15 * 60e3, limit: 20 }), wrap(async (req, res) => {
  const number = str(req.body.number, 30).toLowerCase().replace(/^#/, ''), email = str(req.body.email, 200).toLowerCase();
  const o = db.orders.find(o => o.number.toLowerCase() === number && o.customer.email.toLowerCase() === email);
  if (!o) return fail(res, 404, "We couldn't find that order. Check the number and the email you used at checkout.");
  // Refresh from Qikink at most every 10 minutes per order.
  if (o.qikink?.order_id && I.qikinkConfigured() && Date.now() - (o.trackedAt || 0) > 10 * 60e3) {
    try {
      const [q] = await I.qikinkOrders({ id: o.qikink.order_id });
      if (q) await applyQikink(o, q);
      o.trackedAt = Date.now(); save();
    } catch { /* show what we have */ }
  }
  res.json({
    number: o.number, placed: o.createdAt, amount: o.amount, currency: o.currency,
    status: (o.qikinkStatus || CUSTOMER_STATUS[o.status] || o.status).toUpperCase(),
    items: o.items.map(i => ({ name: i.name, size: i.size, color: i.color, qty: i.qty })),
    tracking: o.tracking?.url && /^https:\/\//.test(o.tracking.url) ? o.tracking : null,
  });
}));

/* ---------------- checkout ---------------- */
// Discount codes (Admin → Discounts). Errors carry .discount so a quote can still show the cart.
// categories: only those products count (e.g. WINTER15 on hoodies + sweatshirts); empty = everything.
function applyDiscount(code, lines, email) {
  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const c = String(code || '').trim().toUpperCase(), d = db.discounts.find(d => d.code === c), now = Date.now();
  const no = m => Object.assign(new Error(m), { discount: true });
  if (!d || !d.active || (d.startsAt && Date.parse(d.startsAt) > now) || (d.endsAt && Date.parse(d.endsAt) < now)) throw no(`${c} isn't a valid code`);
  if (d.limit && (d.used || 0) >= d.limit) throw no(`${c} has been fully used`);
  if (d.minOrder && subtotal < d.minOrder) throw no(`${c} needs an order of ${sym()}${d.minOrder} or more`);
  if (d.oncePerCustomer && email && db.orders.some(o => o.paidAt && o.discount?.code === c && o.customer.email.toLowerCase() === email.toLowerCase())) throw no(`You've already used ${c}`);
  const cats = d.categories?.length ? new Set(d.categories) : null;
  const base = cats ? lines.filter(l => cats.has(db.products.find(p => p.id === l.productId)?.category)).reduce((t, l) => t + l.price * l.qty, 0) : subtotal;
  if (cats && !base) throw no(`${c} only works on ${[...cats].map(x => x.toLowerCase()).join(', ')}`);
  const amount = d.type === 'percent' ? Math.round(base * Math.min(100, d.value) / 100) : d.type === 'flat' ? Math.min(d.value, base) : 0;
  return { code: c, type: d.type, amount, freeShipping: d.type === 'freeship' };
}

function priceCart(items, code = '', email = '') {
  if (!Array.isArray(items) || !items.length || items.length > 20) throw new Error('Your cart is empty');
  const lines = items.map(it => {
    const p = activeProducts().find(p => p.slug === it.slug);
    const s = p?.sizes.find(s => s.label === it.size && (s.color || '') === (it.color || ''));
    const qty = Math.floor(num(it.qty, 1, 5));
    const what = p && s ? `${p.name} (${[s.color, s.label].filter(Boolean).join(' / ')})` : '';
    if (!p || !s) throw new Error('An item in your cart is no longer available');
    if (lockedUntil(p.id)) throw new Error(`${p.name} isn't out yet — it unlocks with its drop`);
    // Nothing can be printed without the Qikink SKU, so don't take money for it.
    if (I.qikinkConfigured() && !s.sku) throw new Error(`${what} can't be ordered right now`);
    if (s.stock < qty) throw new Error(`${what} is sold out`);
    return { productId: p.id, slug: p.slug, name: p.name, size: s.label, color: s.color || '', sku: s.sku, qty, price: s.price || p.price };
  });
  const subtotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
  const { shippingFee, freeShippingOver } = db.settings;
  const discount = code ? applyDiscount(code, lines, email) : null;
  const shipping = discount?.freeShipping || (freeShippingOver && subtotal >= freeShippingOver) ? 0 : shippingFee || 0;
  return { lines, subtotal, discount, shipping, amount: Math.max(1, subtotal - (discount?.amount || 0) + shipping) };
}

app.post('/api/cart/quote', (req, res) => {
  try { res.json(priceCart(req.body.items, req.body.code, str(req.body.email, 200))); } catch (e) {
    if (!e.discount) return fail(res, 400, e.message);
    try { res.json({ ...priceCart(req.body.items), discountError: e.message }); } catch (e2) { fail(res, 400, e2.message); }
  }
});

// Abandoned-checkout email link: puts the cart (and the details they typed) back.
app.get('/api/cart/restore', (req, res) => {
  const [oid, t] = str(req.query.k, 80).split('.');
  const o = oid && t === token('cart:' + oid) && db.orders.find(o => o.id === oid);
  if (!o) return fail(res, 404, 'That link has expired');
  res.set('Cache-Control', 'private, no-store');
  res.json({ items: o.items.map(i => ({ slug: i.slug, size: i.size, color: i.color, qty: i.qty })), customer: o.customer, code: o.discount?.code || '' });
});

const customerFields = ['name', 'email', 'phone', 'address1', 'address2', 'city', 'state', 'zip'];
function readCustomer(b = {}) {
  const c = Object.fromEntries(customerFields.map(k => [k, str(b[k], k.startsWith('address') ? 90 : 200)]));
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
  try { customer = readCustomer(req.body.customer); cart = priceCart(req.body.items, req.body.code, customer.email); } catch (e) { return fail(res, 400, e.message); }
  const user = await S.authUser(bearer(req));
  const order = {
    id: id(),
    number: 'th' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), // 14 chars, Qikink allows 15
    items: cart.lines, subtotal: cart.subtotal, shipping: cart.shipping, amount: cart.amount, discount: cart.discount ? { code: cart.discount.code, amount: cart.discount.amount } : null,
    currency: db.settings.currency, customer, status: 'created', createdAt: new Date().toISOString(),
    ...(user && { userId: user.id }),
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
    const s = db.products.find(p => p.id === l.productId)?.sizes.find(s => s.label === l.size && (s.color || '') === (l.color || ''));
    if (s) s.stock -= l.qty;
    if (s && s.stock < 0) { s.stock = 0; order.oversold = true; } // two people paid for a 1-of-1: refund one by hand
  }
  const d = order.discount && db.discounts.find(d => d.code === order.discount.code);
  if (d) d.used = (d.used || 0) + 1;
  save();
  await fulfill(order);
  order.mailed = { ...order.mailed, confirmed: true };
  await Promise.all([mailOrder(order.customer.email, M.orderConfirmed, order), mailOrder(M.ownerEmail(), M.newOrderAlert, order)]);
  save();
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

/* ---------------- customer accounts ---------------- */
const bearer = req => /^Bearer (.+)$/.exec(req.get('authorization') || '')?.[1] || '';
const needUser = wrap(async (req, res, next) => {
  req.user = await S.authUser(bearer(req));
  req.user ? next() : fail(res, 401, 'Sign in again');
});
// A customer's orders: placed while signed in, or (once their email is confirmed) guest orders to that email.
const mine = u => db.orders.filter(o => o.status !== 'created' && (o.userId === u.id || (u.verified && o.customer.email.toLowerCase() === u.email)));
app.get('/api/account', needUser, wrap(async (req, res) => {
  const byId = Object.fromEntries(db.products.map(p => [p.id, p]));
  const orders = mine(req.user).reverse().map(o => ({
    number: o.number, placed: o.createdAt, amount: o.amount,
    status: (o.qikinkStatus || CUSTOMER_STATUS[o.status] || o.status).toUpperCase(),
    tracking: o.tracking?.url && /^https:\/\//.test(o.tracking.url) ? o.tracking : null,
    items: o.items.map(i => { const p = byId[i.productId]; return { slug: i.slug, name: i.name, size: i.size, color: i.color, qty: i.qty, price: i.price, image: p ? p.colorImages?.[i.color] || p.images.front : '' }; }),
  }));
  // First visit to the account: send the welcome email once.
  if (!(await S.getRow('customers', req.user.id))) {
    await S.putRow('customers', req.user.id, { email: req.user.email, since: new Date().toISOString() });
    await M.send(req.user.email, M.welcomeAccount(req.user.email, db.settings.welcomeCode));
  }
  const last = mine(req.user).at(-1)?.customer || null;
  res.set('Cache-Control', 'private, no-store');
  pubJson(res, { email: req.user.email, verified: req.user.verified, orders, address: last });
}));
app.get('/api/account/wishlist', needUser, wrap(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ slugs: (await S.getRow('wishlists', req.user.id))?.slugs || [] });
}));
app.put('/api/account/wishlist', rateLimit({ windowMs: 60e3, limit: 60 }), needUser, wrap(async (req, res) => {
  const slugs = [...new Set((Array.isArray(req.body.slugs) ? req.body.slugs : []).map(s => str(s, 80)).filter(s => /^[a-z0-9-]+$/.test(s)))].slice(0, 200);
  await S.putRow('wishlists', req.user.id, { slugs, at: new Date().toISOString() });
  res.json({ slugs });
}));

/* ---------------- search engines + Google Merchant Center ---------------- */
const xml = v => String(v ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const productLink = p => `${siteUrl()}/product.html?p=${encodeURIComponent(p.slug)}`;
const feedCache = res => res.set({ 'Cache-Control': 'public, max-age=3600', 'Netlify-CDN-Cache-Control': 'public, durable, s-maxage=3600, stale-while-revalidate=86400', 'Netlify-Cache-Tag': 'site' });
app.get('/api/sitemap.xml', (req, res) => {
  const pages = ['/', '/shop.html', '/about.html', '/contact.html', '/track.html', ...['faq', 'shipping', 'returns', 'privacy', 'terms'].map(k => '/policy.html?p=' + k)];
  const urls = [...pages.map(u => siteUrl() + u), ...activeProducts().map(productLink)];
  feedCache(res).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${xml(u)}</loc></url>`).join('\n')}\n</urlset>\n`);
});
app.get('/api/robots.txt', (req, res) => {
  feedCache(res).type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /checkout\nDisallow: /account\nSitemap: ${siteUrl()}/sitemap.xml\n`);
});
// One entry per colour × size, grouped by product, as Merchant Center wants for apparel.
app.get('/api/feeds/google.xml', (req, res) => {
  const items = activeProducts().flatMap(p => p.sizes.map(v => {
    const img = absImg(p.colorImages?.[v.color] || p.images.front), ok = v.stock > 0 && (!!v.sku || !I.qikinkConfigured());
    return img && `<item><g:id>${xml(v.sku || `${p.slug}-${v.color}-${v.label}`)}</g:id><g:item_group_id>${xml(p.slug)}</g:item_group_id><g:title>${xml(`${p.name}${v.color ? ' - ' + v.color : ''} - ${v.label}`)}</g:title><g:description>${xml((p.description || p.name).slice(0, 4900))}</g:description><g:link>${xml(productLink(p) + (v.color ? '&c=' + encodeURIComponent(v.color) : ''))}</g:link><g:image_link>${xml(img)}</g:image_link><g:availability>${ok ? 'in_stock' : 'out_of_stock'}</g:availability>${v.compare > (v.price || p.price) ? `<g:price>${v.compare.toFixed(2)} ${xml(db.settings.currency)}</g:price><g:sale_price>${(v.price || p.price).toFixed(2)} ${xml(db.settings.currency)}</g:sale_price>` : `<g:price>${(v.price || p.price).toFixed(2)} ${xml(db.settings.currency)}</g:price>`}<g:brand>THRYFTLY</g:brand><g:condition>new</g:condition>${p.googleCategory ? `<g:google_product_category>${xml(p.googleCategory)}</g:google_product_category>` : ''}${v.color ? `<g:color>${xml(v.color)}</g:color>` : ''}<g:size>${xml(v.label)}</g:size><g:gender>unisex</g:gender><g:age_group>adult</g:age_group><g:identifier_exists>no</g:identifier_exists></item>`;
  })).filter(Boolean);
  feedCache(res).type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel><title>THRYFTLY</title><link>${xml(siteUrl())}</link><description>THRYFTLY products</description>\n${items.join('\n')}\n</channel></rss>\n`);
});

/* ---------------- hourly jobs: shipping emails + abandoned-checkout reminders ---------------- */
// Netlify runs this from netlify/functions/hourly.mjs; a long-lived server runs it when RUN_JOBS=1.
export async function hourly() {
  const release = await S.lock();
  try {
    await S.load();
    const synced = await syncQikink().catch(e => (console.error('qikink sync', e.message), 0));
    // A checkout that was started but never paid, 1–72 hours ago: one reminder, only for the latest
    // attempt by that email, and not if they've ordered since. At most 20 an hour (Gmail's limits).
    const now = Date.now(), at = o => Date.parse(o.createdAt);
    const due = db.orders.filter(o => o.status === 'created' && !o.reminded && now - at(o) > 3600e3 && now - at(o) < 72 * 3600e3).slice(0, 20);
    let reminded = 0;
    for (const o of due) {
      o.reminded = true;
      const email = o.customer.email.toLowerCase();
      if (db.orders.some(x => x !== o && x.customer.email.toLowerCase() === email && at(x) > at(o))) continue;
      const url = `${siteUrl()}/checkout.html?restore=${o.id}.${token('cart:' + o.id)}`;
      if (await M.send(o.customer.email, M.cartReminder({ ...o, items: o.items.map(i => ({ ...i, image: itemImage(i) })) }, sym(), absImg, url, db.settings.reminderCode))) reminded++;
    }
    await save();
    return { synced, reminded };
  } finally { release(); }
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

admin.get('/me', (req, res) => res.json({ ok: true, qikink: I.qikinkConfigured(), razorpay: I.razorpayConfigured(), mail: M.mailOn(), qikinkBase: process.env.QIKINK_BASE_URL || 'https://sandbox.qikink.com' }));

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

/* drops */
function readDrop(b, prev = {}) {
  const when = v => { const t = Date.parse(v); return isNaN(t) ? '' : new Date(t).toISOString(); };
  if (!str(b.name)) throw new Error('Give the drop a name');
  return {
    ...prev, name: str(b.name, 40).toUpperCase(), tagline: str(b.tagline, 80).toUpperCase(), description: str(b.description, 600),
    banner: imgUrl(b.banner), startsAt: when(b.startsAt), endsAt: when(b.endsAt), active: !!b.active,
    productIds: (Array.isArray(b.productIds) ? b.productIds : []).filter(i => db.products.some(p => p.id === i)).slice(0, 60),
  };
}
admin.get('/drops', (req, res) => res.json(db.drops));
admin.post('/drops', (req, res) => { try { const d = readDrop(req.body, { id: id() }); db.drops.push(d); save(); res.json(d); } catch (e) { fail(res, 400, e.message); } });
admin.put('/drops/:id', (req, res) => {
  const i = db.drops.findIndex(d => d.id === req.params.id);
  if (i < 0) return fail(res, 404, 'not found');
  try { db.drops[i] = readDrop(req.body, db.drops[i]); save(); res.json(db.drops[i]); } catch (e) { fail(res, 400, e.message); }
});
admin.delete('/drops/:id', (req, res) => { db.drops = db.drops.filter(d => d.id !== req.params.id); save(); res.json({ ok: true }); });

/* pages + inbox */
admin.get('/pages', (req, res) => res.json(db.pages));
admin.put('/pages', (req, res) => {
  for (const k of Object.keys(db.pages)) if (req.body[k]) db.pages[k] = { title: str(req.body[k].title, 80).toUpperCase(), body: str(req.body[k].body, 20000) };
  save(); res.json(db.pages);
});
admin.get('/messages', (req, res) => res.json([...db.messages].reverse()));
admin.put('/messages/:id', (req, res) => { const m = db.messages.find(m => m.id === req.params.id); if (m) { m.read = !!req.body.read; save(); } res.json({ ok: !!m }); });
admin.delete('/messages/:id', (req, res) => { db.messages = db.messages.filter(m => m.id !== req.params.id); save(); res.json({ ok: true }); });

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
    sizes: (Array.isArray(b.sizes) ? b.sizes : []).slice(0, 200).map(s => ({ label: str(s.label, 12).toUpperCase(), color: str(s.color, 30).toUpperCase(), stock: Math.floor(num(s.stock, 0, 99999)), sku: str(s.sku, 50), price: num(s.price) || 0, compare: num(s.compare) || 0 })).filter(s => s.label),
    colorImages: Object.fromEntries(Object.entries(b.colorImages || {}).slice(0, 40).map(([c, u]) => [str(c, 30).toUpperCase(), imgUrl(u)]).filter(([, u]) => u)),
    colorBacks: Object.fromEntries(Object.entries(b.colorBacks || {}).slice(0, 40).map(([c, u]) => [str(c, 30).toUpperCase(), imgUrl(u)]).filter(([, u]) => u)),
    specs: (Array.isArray(b.specs) ? b.specs : []).slice(0, 12).map(s => ({ k: str(s.k, 30).toUpperCase(), v: str(s.v, 120) })).filter(s => s.k),
    images: Object.fromEntries(['front', 'back', 'detail', 'onBody'].map(k => [k, imgUrl(b.images?.[k])])),
    tryonImage: imgUrl(b.tryonImage),
    // 3D viewer: which garment model ('' = from the category) and optional original print files.
    model3d: ['tee', 'hoodie', 'sweatshirt', 'none'].includes(b.model3d) ? b.model3d : '',
    printFront: imgUrl(b.printFront), printBack: imgUrl(b.printBack),
    sizeChart: str(b.sizeChart, 30), seoTitle: str(b.seoTitle, 70), seoDescription: str(b.seoDescription, 320), googleCategory: str(b.googleCategory, 10),
    featured: !!b.featured, inRotation: !!b.inRotation, active: !!b.active, sort: num(b.sort, -1e4, 1e4),
    qikink: prev.qikink, // set by the CSV import, read-only here
  };
}
admin.get('/products', (req, res) => res.json([...db.products].sort((a, b) => a.sort - b.sort).map(p => ({ ...p, chartAuto: autoChart(p) }))));
admin.post('/products', (req, res) => {
  try { const p = readProduct(req.body, { id: id() }); db.products.push(p); save(); res.json(p); } catch (e) { fail(res, 400, e.message); }
});
admin.put('/products/:id', (req, res) => {
  const i = db.products.findIndex(p => p.id === req.params.id);
  if (i < 0) return fail(res, 404, 'not found');
  try { db.products[i] = readProduct(req.body, db.products[i]); save(); res.json(db.products[i]); } catch (e) { fail(res, 400, e.message); }
});
// Bulk switch: live / grid / ring for many products at once.
admin.patch('/products', (req, res) => {
  const ids = new Set(Array.isArray(req.body.ids) ? req.body.ids : []), set = {};
  for (const k of ['active', 'featured', 'inRotation']) if (typeof req.body.set?.[k] === 'boolean') set[k] = req.body.set[k];
  if (!ids.size || !Object.keys(set).length) return fail(res, 400, 'Nothing to change');
  let changed = 0;
  for (const p of db.products) if (ids.has(p.id)) { Object.assign(p, set); changed++; }
  save(); res.json({ changed });
});
admin.delete('/products/:id', (req, res) => {
  db.products = db.products.filter(p => p.id !== req.params.id); save(); res.json({ ok: true });
});

/* images */
const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' }; // no SVG: it can carry script
const fileName = type => Date.now().toString(36) + crypto.randomBytes(6).toString('hex') + EXT[type];
const upload = multer({
  storage: S.remote ? multer.memoryStorage() : multer.diskStorage({ destination: UPLOAD_DIR, filename: (req, f, cb) => cb(null, fileName(f.mimetype)) }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, f, cb) => cb(EXT[f.mimetype] ? null : Object.assign(new Error('Use PNG, JPG, WEBP or GIF'), { status: 400 }), !!EXT[f.mimetype]),
});
admin.post('/upload', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) return fail(res, 400, 'Choose an image');
  if (!S.remote) return res.json({ url: '/uploads/' + req.file.filename });
  const name = fileName(req.file.mimetype);
  await S.putFile(name, req.file.buffer, req.file.mimetype);
  res.json({ url: '/uploads/' + name });
}));

/* orders, subscribers, Qikink */
admin.get('/overview', (req, res) => {
  const paid = db.orders.filter(o => o.paidAt && o.status !== 'refunded'), since = t => paid.filter(o => Date.parse(o.paidAt) >= t);
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const sum = os => ({ orders: os.length, revenue: os.reduce((t, o) => t + o.amount, 0) });
  const live = db.products.filter(p => p.active);
  res.json({
    today: sum(since(+day)), month: sum(since(Date.now() - 30 * 864e5)),
    failed: db.orders.filter(o => o.status === 'fulfillment_failed').length,
    unread: db.messages.filter(m => !m.read).length,
    live: live.length, hidden: db.products.length - live.length,
    noSku: live.filter(p => p.sizes.some(s => !s.sku)).length,
    subscribers: db.subscribers.length, drop: liveDrops()[0]?.name || '',
    latest: [...db.orders].reverse().slice(0, 8).map(o => ({ number: o.number, createdAt: o.createdAt, name: o.customer.name, amount: o.amount, status: o.status })),
  });
});
admin.get('/orders', (req, res) => res.json([...db.orders].reverse()));
admin.post('/orders/:id/fulfill', wrap(async (req, res) => {
  const o = db.orders.find(o => o.id === req.params.id);
  if (!o) return fail(res, 404, 'not found');
  await fulfill(o); res.json(o);
}));
admin.get('/subscribers', (req, res) => res.json(db.subscribers));
admin.get('/qikink/orders', wrap(async (req, res) => res.json(await I.qikinkOrders({ page_no: 1 }))));

// Pull status + tracking for orders we've sent. Qikink pages at 10, so ask in chunks of 10.
admin.post('/orders/sync', wrap(async (req, res) => {
  const synced = await syncQikink();
  save();
  res.json({ synced });
}));

// Cancel + full refund through Razorpay, then tell the customer. (If Qikink already has the order,
// cancel it in the Qikink dashboard too: its API has no cancel.)
admin.post('/orders/:id/refund', wrap(async (req, res) => {
  const o = db.orders.find(o => o.id === req.params.id);
  if (!o) return fail(res, 404, 'not found');
  if (!o.paymentId || o.status === 'refunded') return fail(res, 400, o.status === 'refunded' ? 'Already refunded' : 'This order was never paid');
  const amount = Math.min(o.amount, num(req.body.amount) || o.amount);
  const r = await I.razorpayRefund(o.paymentId, amount);
  o.status = 'refunded';
  o.refund = { id: r.id, amount, at: new Date().toISOString() };
  save();
  await mailOrder(o.customer.email, M.orderRefunded, o);
  res.json(o);
}));

/* discounts */
function readDiscount(b, prev = {}) {
  const code = str(b.code, 30).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!code) throw new Error('Give the code a name, e.g. WELCOME10');
  if (db.discounts.some(d => d.code === code && d.id !== prev.id)) throw new Error('That code already exists');
  const type = ['percent', 'flat', 'freeship'].includes(b.type) ? b.type : 'percent';
  const when = v => { const t = Date.parse(v); return isNaN(t) ? '' : new Date(t).toISOString(); };
  return { ...prev, code, type, value: type === 'percent' ? num(b.value, 0, 100) : num(b.value), minOrder: num(b.minOrder), limit: Math.floor(num(b.limit)), oncePerCustomer: !!b.oncePerCustomer,
    startsAt: when(b.startsAt), endsAt: when(b.endsAt), active: !!b.active, used: prev.used || 0, note: str(b.note, 120),
    categories: (Array.isArray(b.categories) ? b.categories : []).map(c => str(c, 40).toUpperCase()).filter(Boolean).slice(0, 20) };
}
admin.get('/discounts', (req, res) => res.json(db.discounts));
admin.post('/discounts', (req, res) => { try { const d = readDiscount(req.body, { id: id() }); db.discounts.push(d); save(); res.json(d); } catch (e) { fail(res, 400, e.message); } });
admin.put('/discounts/:id', (req, res) => {
  const i = db.discounts.findIndex(d => d.id === req.params.id);
  if (i < 0) return fail(res, 404, 'not found');
  try { db.discounts[i] = readDiscount(req.body, db.discounts[i]); save(); res.json(db.discounts[i]); } catch (e) { fail(res, 400, e.message); }
});
admin.delete('/discounts/:id', (req, res) => { db.discounts = db.discounts.filter(d => d.id !== req.params.id); save(); res.json({ ok: true }); });

/* size charts: one per kind of garment, picked on each product */
function readChart(b, prev = {}) {
  const key = str(b.key || b.title, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!key) throw new Error('Give the size chart a name');
  if (db.sizeCharts.some(c => c.key === key && c.id !== prev.id)) throw new Error('Another size chart already uses that key');
  // table: one row per line, cells split by commas, first line = headings (e.g. "SIZE, CHEST, LENGTH").
  return { ...prev, key, title: str(b.title || key, 40).toUpperCase(), image: imgUrl(b.image), table: str(b.table, 3000), note: str(b.note, 2000) };
}
admin.get('/size-charts', (req, res) => res.json(db.sizeCharts.map(c => ({ ...c, products: db.products.filter(p => chartKey(p) === c.key).length }))));
admin.post('/size-charts', (req, res) => { try { const c = readChart(req.body, { id: id() }); db.sizeCharts.push(c); save(); res.json(c); } catch (e) { fail(res, 400, e.message); } });
admin.put('/size-charts/:id', (req, res) => {
  const i = db.sizeCharts.findIndex(c => c.id === req.params.id);
  if (i < 0) return fail(res, 404, 'not found');
  const was = db.sizeCharts[i].key;
  try {
    db.sizeCharts[i] = readChart(req.body, db.sizeCharts[i]);
    if (was !== db.sizeCharts[i].key) db.products.forEach(p => { if (p.sizeChart === was) p.sizeChart = db.sizeCharts[i].key; });
    save(); res.json(db.sizeCharts[i]);
  } catch (e) { fail(res, 400, e.message); }
});
admin.delete('/size-charts/:id', (req, res) => { db.sizeCharts = db.sizeCharts.filter(c => c.id !== req.params.id); save(); res.json({ ok: true }); });

/* customers: everyone who ordered, has an account, or is on the drop list */
admin.get('/customers', wrap(async (req, res) => {
  const by = new Map();
  const get = email => { const e = String(email || '').toLowerCase(); if (!by.has(e)) by.set(e, { email: e, name: '', phone: '', city: '', orders: 0, spent: 0, last: '', account: false, subscribed: false }); return by.get(e); };
  for (const o of db.orders) {
    if (!o.paidAt) continue;
    const c = get(o.customer.email);
    Object.assign(c, { name: o.customer.name, phone: o.customer.phone, city: o.customer.city });
    c.orders++; c.spent += o.status === 'refunded' ? 0 : o.amount;
    if (o.createdAt > c.last) c.last = o.createdAt;
  }
  for (const s of db.subscribers) get(s.email).subscribed = true;
  let accounts = [];
  try { accounts = await S.listUsers(); } catch (e) { console.error('list users', e.message); }
  for (const u of accounts) if (u.email) { const c = get(u.email); c.account = true; c.since = u.created_at; }
  res.json([...by.values()].filter(c => c.email).sort((a, b) => b.spent - a.spent || String(b.last).localeCompare(String(a.last))));
}));
admin.post('/test-email', wrap(async (req, res) => {
  if (!M.mailOn()) return fail(res, 400, 'Email is not set up: add SMTP_USER and SMTP_PASS');
  const ok = await M.send(M.ownerEmail(), M.welcomeAccount(M.ownerEmail(), db.settings.welcomeCode));
  ok ? res.json({ to: M.ownerEmail() }) : fail(res, 502, 'Sending failed. Check SMTP_USER / SMTP_PASS (a Gmail App Password, not your normal password).');
}));

// Every size-chart kind a product points at gets an entry (image/table filled in under Admin → Size charts).
const CHART_NAMES = { terry: 'TERRY TEE', ohoodie: 'OVERSIZED HOODIE', hoodie: 'HOODIE', zipper: 'ZIP HOODIE', osweatshirt: 'OVERSIZED SWEATSHIRT', oshirt: 'OVERSIZED SHIRT', classic: 'CLASSIC TEE', 'acid-wash': 'ACID WASH TEE' };
function ensureSizeCharts() {
  for (const key of new Set(db.products.map(p => p.sizeChart).filter(Boolean))) {
    if (!db.sizeCharts.some(c => c.key === key)) db.sizeCharts.push({ id: id(), key, title: CHART_NAMES[key] || key.toUpperCase().replace(/-/g, ' '), image: '', note: '' });
  }
}

// Shopify's Type column is often empty, so file products by what their title says.
// Shopify's own taxonomy ("… > Clothing Tops > Hoodies") wins; the title is the fallback.
const categoryOf = (title, taxonomy = '') => {
  const rules = [[/zip|hood/i, 'HOODIES'], [/sweatshirt/i, 'SWEATSHIRTS'], [/varsity|jacket|coat/i, 'JACKETS'], [/sweatpant|jogger|\bpants?\b|trouser/i, 'BOTTOMS'], [/\btees?\b|t-shirt|tshirt/i, 'TEES'], [/shirt/i, 'SHIRTS']];
  const pick = t => rules.find(([re]) => re.test(t))?.[1];
  return pick(taxonomy.split('>').pop()) || pick(title) || 'APPAREL';
};

// Shopify → our store. Images are copied to our own disk, since Shopify's CDN goes away with the store.
async function downloadImage(url) {
  if (!/^https:\/\//.test(url)) return '';
  // Shopify's CDN resizes on request; 1600px keeps mockups sharp.
  const u = new URL(url);
  if (u.hostname === 'cdn.shopify.com') u.searchParams.set('width', '1600');
  // Asking for WebP gets ~12x smaller files with transparency intact.
  const res = await fetch(u, { headers: { Accept: 'image/webp,image/*' }, signal: AbortSignal.timeout(30000) });
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (!res.ok || !EXT[type]) return '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024) return '';
  const name = fileName(type);
  await S.putFile(name, buf, type);
  return '/uploads/' + name;
}

// Copy a remote image once; later imports of the same URL reuse the file. Failures keep the remote URL.
async function localImage(url) {
  if (S.remote && !db.importedImages) db.importedImages = (await S.getRow('doc', 'importedImages')) || {};
  const have = db.importedImages?.[url];
  if (have && (S.remote || fs.existsSync(path.join(UPLOAD_DIR, path.basename(have))))) return have;
  const got = await downloadImage(url).catch(() => '');
  if (got) (db.importedImages ||= {})[url] = got;
  return got || url;
}

// Shared defaults for products created by an import (Shopify CSV, Qikink push).
function newImported(slugBase, title, fields) {
  let slug = slugBase.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
  while (db.products.some(p => p.slug === slug)) slug += '-2';
  return {
    id: id(), slug, edition: '', badge: '', badgeStyle: 'yellow', tag: '', color: '', fitLabel: '', specs: [], tryonImage: '',
    ringLabel: title.toLowerCase(), featured: true, inRotation: false, sort: 100 + db.products.length, ...fields,
  };
}

admin.post('/import/shopify', express.text({ type: '*/*', limit: '25mb' }), wrap(async (req, res) => {
  // Copying hundreds of images takes minutes; a Netlify function is cut off after seconds.
  if (LAMBDA) return fail(res, 400, 'Run Shopify imports from your computer (npm run dev with the Supabase keys in .env). See README.');
  let rows;
  try { rows = I.parseShopifyCsv(String(req.body || '')); } catch (e) { return fail(res, 400, e.message); }

  // Download every distinct image, 6 at a time. Failures keep the Shopify URL so nothing is lost.
  const urls = [...new Set(rows.flatMap(r => [...r.gallery, ...Object.values(r.colorImages), ...Object.values(r.colorBacks)]))];
  const local = {};
  let failed = 0;
  for (let i = 0; i < urls.length; i += 6) {
    await Promise.all(urls.slice(i, i + 6).map(async u => { local[u] = await localImage(u); if (local[u] === u) failed++; }));
  }
  const L = u => (u ? local[u] || u : '');

  let added = 0, updated = 0;
  for (const r of rows) {
    const name = r.title.toUpperCase().slice(0, 80);
    const slug = r.handle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Match on the Shopify handle only: several Shopify products share a title.
    const prev = db.products.find(p => p.shopify?.handle === r.handle) || db.products.find(p => !p.shopify && p.slug === slug);
    const variants = r.variants.map(v => ({ label: v.label.slice(0, 12), color: v.color.slice(0, 30), stock: v.stock, sku: v.sku.slice(0, 50), price: v.price !== r.price ? v.price : 0, compare: v.compare || 0 }));
    const [front = '', back = '', detail = '', onBody = ''] = r.gallery.map(L);
    const fields = {
      name, price: r.price, description: r.description.slice(0, 2000), category: (r.type || categoryOf(r.title, r.productCategory)).toUpperCase().slice(0, 40),
      sizes: variants, colorImages: Object.fromEntries(Object.entries(r.colorImages).map(([c, u]) => [c, L(u)])),
      colorBacks: Object.fromEntries(Object.entries(r.colorBacks).map(([c, u]) => [c, L(u)])),
      images: { front, back, detail, onBody }, shopify: { handle: r.handle, status: r.status },
      sizeChart: r.sizeChart.replace(/[^a-z0-9]+/g, '-'), googleCategory: r.googleCategory, seoTitle: r.seoTitle.slice(0, 70), seoDescription: r.seoDescription.slice(0, 320),
    };
    if (prev) {
      Object.assign(prev, fields);
      updated++;
    } else {
      db.products.push(newImported(r.handle, r.title, {
        // Go live straight away only if it was live on Shopify and every variant can be fulfilled.
        active: r.status === 'active' && variants.every(v => v.sku),
        ...fields,
      }));
      added++;
    }
  }
  ensureSizeCharts();
  // The 3D ring reads best with ~6 pieces: fill empty slots with the first live imports.
  for (const p of db.products.filter(p => p.shopify && p.active && !p.inRotation)) {
    if (db.products.filter(p => p.active && p.inRotation).length >= 6) break;
    p.inRotation = true;
  }
  save();
  res.json({ added, updated, images: urls.length - failed, imagesFailed: failed });
}));

// Import the "My Products" CSV exported from the Qikink dashboard. It has names, prices and
// size ranges but no variant SKUs, so products arrive hidden until SKUs are filled in.
admin.post('/import/qikink', express.text({ type: '*/*', limit: '2mb' }), (req, res) => {
  const { parseQikinkCsv } = I;
  let rows;
  try { rows = parseQikinkCsv(String(req.body || '')); } catch (e) { return fail(res, 400, e.message); }
  let added = 0, skipped = 0;
  for (const r of rows) {
    if (db.products.some(p => p.qikink?.productId === r.productId)) { skipped++; continue; }
    let slug = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'product';
    while (db.products.some(p => p.slug === slug)) slug += '-' + r.productId.slice(-4);
    db.products.push({
      id: id(), slug, name: r.name, edition: '', price: r.price, category: r.category, badge: '', badgeStyle: 'yellow',
      tag: r.printType, color: '', fitLabel: /oversized/i.test(r.base) ? 'OVERSIZED FIT' : 'REGULAR FIT', description: '',
      sizes: r.sizes.map(label => ({ label, color: '', stock: 999, sku: '' })),
      specs: [{ k: 'PRINT', v: r.printType }, { k: 'BASE', v: `${r.base} (${r.baseCode})` }],
      images: { front: '', back: '', detail: '', onBody: '' }, tryonImage: '', ringLabel: r.name.toLowerCase(),
      featured: true, inRotation: true, active: false, sort: 100 + db.products.length,
      qikink: { productId: r.productId, baseCode: r.baseCode, colors: r.colors, variants: r.variants, cost: r.cost, design: r.design },
    });
    added++;
  }
  save();
  res.json({ added, skipped });
});

// Qikink connects to WooCommerce through its WordPress plugin, then pushes products over the
// WooCommerce REST v3 API. The plugin's half is replayed by these admin endpoints (the owner's
// Qikink account email → OTP → our API keys to Qikink). See docs/qikink-woocommerce.md.
const wooKeys = () => process.env.WOO_CONSUMER_KEY && process.env.WOO_CONSUMER_SECRET;
admin.get('/qikink/woo/status', wrap(async (req, res) => res.json(await I.qikinkPlugin('check_install', { Store_URL: siteUrl() }))));
admin.post('/qikink/woo/connect', wrap(async (req, res) => res.json(await I.qikinkPlugin('wp_plugin', { EmailId: str(req.body.email, 200), store_url: siteUrl() }))));
admin.post('/qikink/woo/otp', wrap(async (req, res) => {
  if (!wooKeys()) return fail(res, 503, 'Set WOO_CONSUMER_KEY and WOO_CONSUMER_SECRET first');
  const client_id = str(req.body.client_id, 40);
  const r = await I.qikinkPlugin('wp_plugin_otp', { otp: str(req.body.otp, 10), client_id });
  if (!r.status) return fail(res, 400, 'Qikink rejected the OTP');
  res.json({ keys: await I.qikinkPluginSendKeys(client_id, process.env.WOO_CONSUMER_KEY, process.env.WOO_CONSUMER_SECRET) });
}));

/* ---------------- WooCommerce-compatible receiver (Qikink "Push to store") ---------------- */
// Only the slice of WC REST v3 a product push needs. Pushed products land hidden until ticked Live.
// Qikink's exact requests are undocumented, so every call is logged to data/woo-log.jsonl.
// ponytail: log grows forever; rotate or drop it once a real push has been checked.
const W = () => (db.woo ||= { seq: 1000, objects: {} });
const wooId = () => ++W().seq;
const wooStore = col => (W().objects[col] ||= []);
const wooErr = (res, status, code, message) => void res.status(status).json({ code, message, data: { status } });
const notFound = () => Object.assign(new Error('Invalid ID.'), { status: 404 });
const hashEq = (a, b) => { const h = s => crypto.createHash('sha256').update(String(s)).digest(); return crypto.timingSafeEqual(h(a), h(b)); };
function wooAuthed(req) {
  if (!wooKeys()) return false;
  // HTTPS clients send Basic ck:cs, or ?consumer_key=&consumer_secret=. OAuth1 (plain-HTTP only) isn't supported.
  const basic = /^Basic (.+)$/i.exec(req.get('authorization') || '');
  const [, k = '', s = ''] = basic ? /^([^:]*):(.*)$/.exec(Buffer.from(basic[1], 'base64').toString()) || [] : [, req.query.consumer_key, req.query.consumer_secret];
  return hashEq(k, process.env.WOO_CONSUMER_KEY) && hashEq(s, process.env.WOO_CONSUMER_SECRET);
}
function wooList(req, res, items) {
  const per = Math.min(100, Math.max(1, Math.floor(+req.query.per_page || 10))), page = Math.max(1, Math.floor(+req.query.page || 1));
  res.set({ 'X-WP-Total': items.length, 'X-WP-TotalPages': Math.ceil(items.length / per) }).json(items.slice((page - 1) * per, page * per));
}

// Sites without pretty permalinks are addressed as /?rest_route=/wc/v3/...
app.use((req, res, next) => {
  const u = new URL(req.url, 'http://x'), r = u.searchParams.get('rest_route');
  if (r) { u.searchParams.delete('rest_route'); req.url = '/wp-json' + r + u.search; }
  next();
});
app.use('/wp-json', express.urlencoded({ extended: true, limit: '12mb' }), (req, res, next) => {
  const entry = { at: new Date().toISOString(), method: req.method, url: req.originalUrl.replace(/(consumer_secret=)[^&]*/, '$1***'), auth: (req.get('authorization') || '').split(' ')[0], ua: req.get('user-agent'), body: req.body };
  if (S.remote) console.log('woo', JSON.stringify(entry)); // no disk on Netlify: it lands in the function log
  else fs.appendFile(path.join(DATA_DIR, 'woo-log.jsonl'), JSON.stringify(entry) + '\n', () => {});
  next();
});
app.get('/wp-json', (req, res) => res.json({ name: db.settings.footerWord || 'THRYFTLY', url: siteUrl(), home: siteUrl(), namespaces: ['wp/v2', 'wc/v3'] }));
const woo = express.Router();
app.use('/wp-json/wc/v3', (req, res, next) => (wooAuthed(req) ? next() : wooErr(res, 401, 'woocommerce_rest_cannot_view', 'Sorry, you cannot list resources.')), woo);

// A variation names its options as {name, option}, or {id, option} for a global attribute.
const attrName = a => a.name || wooStore('products/attributes').find(x => x.id === +a.id)?.name || '';
const sameRow = (s, r) => (r.sku && s.sku === r.sku) || (s.color === r.color && s.label === r.label);

function wooOut(p) {
  const abs = u => (u.startsWith('/') ? siteUrl() + u : u);
  return {
    id: p.woo.id, name: p.name, slug: p.slug, permalink: `${siteUrl()}/product.html?p=${p.slug}`, type: p.woo.type,
    status: p.active ? 'publish' : 'draft', sku: p.woo.sku || '', price: String(p.price), regular_price: String(p.price),
    description: p.description, categories: p.woo.categories || [], attributes: p.woo.attributes,
    images: p.woo.images.map((src, i) => ({ id: i + 1, src: abs(src), position: i })),
    variations: Object.keys(p.woo.vars).map(Number),
  };
}
function wooVarOut(p, key) {
  const r = p.woo.vars[key], s = p.sizes.find(s => sameRow(s, r));
  const img = p.colorImages[r.color];
  return {
    id: +key, parent_id: p.woo.id, sku: r.sku || '', price: String(r.price || p.price), regular_price: String(r.price || p.price),
    manage_stock: true, stock_quantity: s?.stock ?? 0, stock_status: s?.stock > 0 ? 'instock' : 'outofstock', attributes: r.attributes,
    image: img ? { src: img.startsWith('/') ? siteUrl() + img : img } : null,
  };
}

// Bigger sizes can cost more: the cheapest variation is the product price, the rest carry their own.
function wooPrices(p) {
  const vars = Object.values(p.woo.vars), raw = vars.map(r => r.price).filter(Boolean);
  if (!p.woo.price && raw.length) p.price = Math.min(...raw);
  for (const r of vars) { const s = p.sizes.find(s => sameRow(s, r)); if (s && r.price) s.price = r.price === p.price ? 0 : r.price; }
}

async function wooUpsertProduct(b, p) {
  if (!p) {
    const name = str(b.name, 80).toUpperCase();
    if (!name) throw Object.assign(new Error('Missing parameter(s): name'), { status: 400 });
    p = newImported(str(b.slug, 80) || name, name, {
      name, price: 0, category: 'APPAREL', description: '', sizes: [], colorImages: {}, images: { front: '', back: '', detail: '', onBody: '' },
      active: false, woo: { id: wooId(), type: 'simple', attributes: [], images: [], vars: {} },
    });
    db.products.push(p);
  }
  if (b.name) p.name = str(b.name, 80).toUpperCase();
  if (b.description || b.short_description) p.description = I.htmlToText(b.description || b.short_description).slice(0, 2000);
  if (num(b.regular_price || b.price)) p.price = p.woo.price = num(b.regular_price || b.price);
  if (b.type) p.woo.type = str(b.type, 20);
  if ('sku' in b) p.woo.sku = str(b.sku, 50);
  if (Array.isArray(b.categories) && b.categories.length) {
    p.woo.categories = b.categories;
    const c = b.categories[0], n = c.name || wooStore('products/categories').find(x => x.id === +c.id)?.name;
    if (n) p.category = str(n, 40).toUpperCase();
  }
  if (Array.isArray(b.attributes)) p.woo.attributes = b.attributes.map(a => ({ ...a, name: attrName(a) }));
  if (Array.isArray(b.images)) {
    p.woo.images = (await Promise.all(b.images.slice(0, 20).map(i => (i?.src ? localImage(str(i.src, 1000)) : '')))).filter(Boolean);
    const [front = '', back = '', detail = '', onBody = ''] = p.woo.images;
    p.images = { front, back, detail, onBody };
  }
  // A simple product is one size row carrying the product SKU.
  if (p.woo.type !== 'variable' && p.woo.sku) p.sizes = [{ label: 'OS', color: '', stock: p.sizes[0]?.stock ?? 999, sku: p.woo.sku, price: 0 }];
  return p;
}

async function wooUpsertVariation(p, v, key) {
  const prev = key ? p.woo.vars[key] : null;
  if (key && !prev) throw notFound();
  key ||= wooId();
  const r = { ...prev, attributes: Array.isArray(v.attributes) ? v.attributes : prev?.attributes || [] };
  r.color = ''; r.label = '';
  for (const a of r.attributes) {
    const o = str(a.option, 30).toUpperCase();
    if (/colou?r/i.test(attrName(a))) r.color = o; else if (!r.label) r.label = o.slice(0, 12);
  }
  r.label ||= 'OS';
  if ('sku' in v) r.sku = str(v.sku, 50);
  if (num(v.regular_price || v.price)) r.price = num(v.regular_price || v.price);
  let s = p.sizes.find(s => sameRow(s, prev || r));
  if (!s) p.sizes.push(s = { label: '', color: '', stock: 999, sku: '', price: 0 }); // print on demand: never runs out
  Object.assign(s, { label: r.label, color: r.color, sku: r.sku || s.sku });
  if (v.manage_stock && v.stock_quantity != null) s.stock = Math.floor(num(v.stock_quantity, 0, 99999));
  const img = v.image?.src || p.woo.images[v.image?.id - 1];
  if (img && r.color) p.colorImages[r.color] = await localImage(str(img, 1000));
  p.woo.vars[key] = r;
  wooPrices(p);
  return key;
}

function wooDeleteVariation(p, key) {
  const r = p.woo.vars[key];
  if (!r) throw notFound();
  const out = wooVarOut(p, key);
  p.sizes = p.sizes.filter(s => !sameRow(s, r));
  delete p.woo.vars[key];
  return out;
}

// Handlers return the response body (or send it themselves); errors come back in WooCommerce's shape.
const wooWrap = fn => async (req, res, next) => {
  try { const out = await fn(req, res, next); if (out !== undefined) { save(); res.json(out); } }
  catch (e) { if (!e.status) console.error(e); wooErr(res, e.status || 500, e.status === 404 ? 'woocommerce_rest_invalid_id' : 'woocommerce_rest_error', e.status ? e.message : 'Something went wrong'); }
};
const wooFind = id => { const p = db.products.find(p => p.woo?.id === +id); if (!p) throw notFound(); return p; };
const isId = v => /^\d+$/.test(v);

woo.get('/system_status', (req, res) => res.json({ environment: { home_url: siteUrl(), site_url: siteUrl(), version: '9.4.0', wp_version: '6.7' }, settings: { currency: db.settings.currency } }));
// Paid orders already go to Qikink through its order API; listing them here too would print each one twice.
woo.get('/orders', (req, res) => wooList(req, res, []));

woo.get('/products', (req, res) => {
  const sku = str(req.query.sku, 50), q = str(req.query.search, 80).toUpperCase();
  const ps = db.products.filter(p => p.woo && (!sku || p.woo.sku === sku || Object.values(p.woo.vars).some(r => r.sku === sku)) && (!q || p.name.includes(q)));
  wooList(req, res, ps.map(wooOut));
});
woo.post('/products', wooWrap(async (req, res) => { res.status(201); return wooOut(await wooUpsertProduct(req.body)); }));
woo.post('/products/batch', wooWrap(async req => {
  const { create = [], update = [], delete: del = [] } = req.body;
  const out = { create: [], update: [], delete: [] };
  for (const b of create) out.create.push(wooOut(await wooUpsertProduct(b)));
  for (const b of update) out.update.push(wooOut(await wooUpsertProduct(b, wooFind(b.id))));
  for (const i of del) { const p = wooFind(i); p.active = false; out.delete.push(wooOut(p)); }
  return out;
}));
// Deleting from Qikink only hides the product here, so nothing is lost by mistake.
woo.route('/products/:id')
  .all((req, res, next) => (isId(req.params.id) ? next() : next('route')))
  .get(wooWrap(req => wooOut(wooFind(req.params.id))))
  .post(wooWrap(async req => wooOut(await wooUpsertProduct(req.body, wooFind(req.params.id)))))
  .put(wooWrap(async req => wooOut(await wooUpsertProduct(req.body, wooFind(req.params.id)))))
  .patch(wooWrap(async req => wooOut(await wooUpsertProduct(req.body, wooFind(req.params.id)))))
  .delete(wooWrap(req => { const p = wooFind(req.params.id); p.active = false; return wooOut(p); }));

woo.get('/products/:pid/variations', wooWrap((req, res) => { const p = wooFind(req.params.pid); wooList(req, res, Object.keys(p.woo.vars).map(k => wooVarOut(p, k))); }));
woo.post('/products/:pid/variations', wooWrap(async (req, res) => { const p = wooFind(req.params.pid); res.status(201); return wooVarOut(p, await wooUpsertVariation(p, req.body)); }));
woo.post('/products/:pid/variations/batch', wooWrap(async req => {
  const p = wooFind(req.params.pid), { create = [], update = [], delete: del = [] } = req.body;
  const out = { create: [], update: [], delete: [] };
  for (const v of create) out.create.push(wooVarOut(p, await wooUpsertVariation(p, v)));
  for (const v of update) out.update.push(wooVarOut(p, await wooUpsertVariation(p, v, String(v.id))));
  for (const i of del) out.delete.push(wooDeleteVariation(p, String(i)));
  return out;
}));
woo.route('/products/:pid/variations/:vid')
  .get(wooWrap(req => { const p = wooFind(req.params.pid); if (!p.woo.vars[req.params.vid]) throw notFound(); return wooVarOut(p, req.params.vid); }))
  .all(wooWrap(async req => {
    const p = wooFind(req.params.pid);
    if (req.method === 'DELETE') return wooDeleteVariation(p, req.params.vid);
    return wooVarOut(p, await wooUpsertVariation(p, req.body, req.params.vid));
  }));

// Anything else (attributes, terms, categories, tags, webhooks...) is kept and echoed back with an id,
// so a push that sets those up first doesn't fail. Categories by id resolve to names on products.
woo.all('/*path', wooWrap((req, res) => {
  const segs = req.params.path, oid = isId(segs.at(-1)) ? +segs.at(-1) : 0;
  const col = (oid ? segs.slice(0, -1) : segs).join('/'), items = wooStore(col.replace(/\/batch$/, ''));
  const make = b => { res.status(201); const o = { ...b, id: wooId(), ...(b.name && !b.slug && { slug: str(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '-') }) }; items.push(o); return o; };
  const find = i => { const o = items.find(x => x.id === +i); if (!o) throw notFound(); return o; };
  if (col.endsWith('/batch')) {
    const { create = [], update = [], delete: del = [] } = req.body;
    const out = { create: create.map(make), update: update.map(b => Object.assign(find(b.id), b)), delete: del.map(i => { const o = find(i); items.splice(items.indexOf(o), 1); return o; }) };
    res.status(200);
    return out;
  }
  if (req.method === 'GET') return oid ? find(oid) : wooList(req, res, items);
  if (!oid) return req.method === 'POST' ? make(req.body) : wooErr(res, 404, 'rest_no_route', 'No route was found matching the URL and request method.');
  const o = find(oid);
  if (req.method === 'DELETE') { items.splice(items.indexOf(o), 1); return o; }
  return Object.assign(o, req.body, { id: oid });
}));

/* ---------------- static ---------------- */
// With Supabase the files live in Storage (on Netlify, _redirects proxies /uploads there instead).
if (S.remote) app.get('/uploads/:name', (req, res) => res.redirect(301, S.fileUrl(req.params.name)));
else app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true }));
if (PROD && !LAMBDA) {
  const dist = path.resolve('dist');
  app.use(express.static(dist, { extensions: ['html'], setHeaders: (res, f) => { if (f.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
  app.use((req, res) => res.status(404).sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  if (S.remote) S.invalidate();
  fail(res, err.status || (err instanceof multer.MulterError ? 400 : 500), err instanceof multer.MulterError || err.message?.startsWith('Use ') ? err.message : 'Something went wrong');
});

if (!LAMBDA && process.env.RUN_JOBS === '1') setInterval(() => hourly().then(r => console.log('hourly', r), e => console.error('hourly', e)), 3600e3);
if (!LAMBDA) app.listen(PORT, () => console.log(`THRYFTLY server on http://localhost:${PORT} (${PROD ? 'production' : 'dev'}, data in ${S.remote ? 'Supabase' : DATA_DIR})`));
export default app;
