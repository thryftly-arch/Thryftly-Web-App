import crypto from 'node:crypto';

const env = k => process.env[k] || '';

/* ---------------- Qikink (print-on-demand fulfilment) ---------------- */
// Qikink's API has no product listing: products live in our admin, and each size
// carries the SKU of the matching product in the Qikink "My Products" list.
const QK_BASE = () => env('QIKINK_BASE_URL') || 'https://sandbox.qikink.com';
let qkToken = null, qkExpires = 0;

export const qikinkConfigured = () => !!(env('QIKINK_CLIENT_ID') && env('QIKINK_CLIENT_SECRET'));

async function qikinkToken() {
  if (qkToken && Date.now() < qkExpires) return qkToken;
  const res = await fetch(`${QK_BASE()}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ClientId: env('QIKINK_CLIENT_ID'), client_secret: env('QIKINK_CLIENT_SECRET') }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.Accesstoken) throw new Error('Qikink auth failed: ' + JSON.stringify(j).slice(0, 200));
  qkToken = j.Accesstoken;
  qkExpires = Date.now() + ((j.expires_in || 3600) - 120) * 1000;
  return qkToken;
}

async function qikink(path, init = {}) {
  const res = await fetch(QK_BASE() + path, {
    ...init,
    headers: { ClientId: env('QIKINK_CLIENT_ID'), Accesstoken: await qikinkToken(), 'Content-Type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok || body?.error) throw new Error(typeof body === 'string' ? body.slice(0, 300) : body.error || JSON.stringify(body));
  return body;
}

// The legacy /api/order route works on sandbox and live (/api/order/list is live-only).
// Accepts the same filters: id, ids, order_reference_no, status, page_no, live_date_min/max.
export async function qikinkOrders(query = {}) {
  const r = await qikink('/api/order?' + new URLSearchParams(query));
  return Array.isArray(r) ? r : r?.data || [];
}

export function qikinkCreateOrder(order) {
  const [first, ...rest] = order.customer.name.trim().split(/\s+/);
  return qikink('/api/order/create', {
    method: 'POST',
    body: JSON.stringify({
      order_number: order.number, // Qikink: max 15 chars, a-z 0-9 _ only
      qikink_shipping: '1',
      gateway: 'Prepaid',
      total_order_value: String(order.amount),
      line_items: order.items.map(i => ({ search_from_my_products: 1, quantity: String(i.qty), price: String(i.price), sku: i.sku })),
      shipping_address: {
        first_name: first, last_name: rest.join(' ') || first,
        // Qikink has a single address line, max 90 chars
        address1: [order.customer.address1, order.customer.address2].filter(Boolean).join(', ').slice(0, 90),
        phone: order.customer.phone, email: order.customer.email,
        city: order.customer.city, zip: order.customer.zip, province: order.customer.state, country_code: 'IN',
      },
    }),
  });
}

/* ---------------- Razorpay (payments) ---------------- */
export const razorpayConfigured = () => !!(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET'));

export async function razorpayCreateOrder({ amount, currency, receipt }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(env('RAZORPAY_KEY_ID') + ':' + env('RAZORPAY_KEY_SECRET')).toString('base64'),
      'Content-Type': 'application/json',
    },
    // Razorpay wants the smallest currency unit (paise / cents).
    body: JSON.stringify({ amount: Math.round(amount * 100), currency, receipt }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Razorpay: ' + (j.error?.description || res.status));
  return j;
}

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const razorpayVerifyPayment = (orderId, paymentId, signature) =>
  safeEq(hmac(env('RAZORPAY_KEY_SECRET'), `${orderId}|${paymentId}`), String(signature || ''));

export const razorpayVerifyWebhook = (rawBody, signature) =>
  !!env('RAZORPAY_WEBHOOK_SECRET') && safeEq(hmac(env('RAZORPAY_WEBHOOK_SECRET'), rawBody), String(signature || ''));

/* ---------------- Ollama (local AI stylist for try-on) ---------------- */
const OLLAMA = () => env('OLLAMA_URL') || 'http://127.0.0.1:11434';
export const ollamaModel = () => env('OLLAMA_MODEL') || 'gemma3:4b';

export async function ollamaStatus() {
  try {
    const r = await fetch(OLLAMA() + '/api/tags', { signal: AbortSignal.timeout(2000) });
    const { models = [] } = await r.json();
    const want = ollamaModel();
    return { up: true, model: want, ready: models.some(m => m.name === want || m.name === want + ':latest') };
  } catch {
    return { up: false, model: ollamaModel(), ready: false };
  }
}

export async function ollamaStylist({ imageBase64, product }) {
  const res = await fetch(OLLAMA() + '/api/chat', {
    method: 'POST',
    signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel(),
      stream: false,
      options: { temperature: 0.6, num_predict: 220 },
      messages: [
        { role: 'system', content: 'You are the stylist for THRYFTLY, a streetwear store selling one-off reworked vintage. Be short, direct and hype but honest. No markdown headings.' },
        {
          role: 'user',
          images: [imageBase64],
          content: `This is a virtual try-on preview: the customer's photo with the "${product.name}" (${product.category}, ${product.color}, ${product.fitLabel}) placed over it. ` +
            'In 3-4 short bullet points: how the piece works with their look, the fit/size to expect, and one styling tip. Ignore any imperfections of the overlay itself.',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error('Ollama error ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return (await res.json()).message?.content?.trim() || '';
}

/* ---------------- Qikink dashboard CSV ("My Products" export) ---------------- */
function csvRows(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(Boolean));
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
const firstNum = s => Number(String(s).split('-')[0].replace(/[^\d.]/g, '')) || 0;

// The "Products" column packs several fields separated by long runs of spaces:
// name · "Base | CODE" · design(s) · "N Colors | Size : S - 3XL | N Variants" · print type · status
export function parseQikinkCsv(text) {
  const [head, ...rows] = csvRows(text.replace(/^\uFEFF/, ''));
  const col = re => head.findIndex(h => re.test(h));
  const iId = col(/product id/i), iProd = col(/^products$/i), iCost = col(/product price/i), iSell = col(/selling price/i);
  if (iId < 0 || iProd < 0 || iSell < 0) throw new Error('Not a Qikink products export (missing Product ID / Products / Selling Price columns)');
  return rows.map(r => {
    const parts = r[iProd].split(/\s{3,}/).map(s => s.trim()).filter(Boolean);
    const vi = parts.findIndex(p => /Colors?\s*\|\s*Size/i.test(p));
    const v = /(\d+)\s*Colors?\s*\|\s*Size\s*:\s*(\S+)\s*-\s*(\S+)\s*\|\s*(\d+)\s*Variants?/i.exec(parts[vi] || '') || [];
    const [base = '', baseCode = ''] = (parts[1] || '').split('|').map(s => s.trim());
    const from = SIZE_ORDER.indexOf((v[2] || '').toUpperCase()), to = SIZE_ORDER.indexOf((v[3] || '').toUpperCase());
    const design = vi > 2 ? parts.slice(2, vi).join(' ').split('|')[0].trim() : '';
    let name = parts[0] || 'Product';
    // Several exports share a generic name ("Unisex Oversized Hoodie"); the design name tells them apart.
    if (name === base && design) name = `${name} — ${design.replace(/_[0-9a-f]{10,}$/i, '')}`;
    return {
      productId: r[iId].trim(), name: name.toUpperCase().slice(0, 80), base, baseCode, design,
      category: /hoodie/i.test(base) ? 'HOODIES' : /sweat/i.test(base) ? 'SWEATSHIRTS' : /tee|t-shirt/i.test(base) ? 'TEES' : 'APPAREL',
      colors: +v[1] || 1, variants: +v[4] || 0,
      sizes: from >= 0 && to >= from ? SIZE_ORDER.slice(from, to + 1) : ['OS'],
      printType: (parts[vi + 1] || '').toUpperCase(),
      cost: iCost >= 0 ? firstNum(r[iCost]) : 0, price: firstNum(r[iSell]),
    };
  }).filter(p => p.productId);
}

/* ---------------- Shopify product export (migration off Shopify) ---------------- */
// Shopify's Products → Export CSV: one row per variant, extra rows per image, grouped by Handle.
// Variant SKUs are the ones Qikink created when it pushed the product, so orders map 1:1.
const htmlToText = h => String(h || '')
  .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, '\n').replace(/<li[^>]*>/gi, '• ').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

export function parseShopifyCsv(text) {
  const [head, ...rows] = csvRows(text.replace(/^﻿/, ''));
  const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  if (ix.Handle == null || ix['Variant SKU'] == null) throw new Error('Not a Shopify products export (missing Handle / Variant SKU columns)');
  const get = (r, k) => (ix[k] == null ? '' : (r[ix[k]] || '').trim());
  const byHandle = new Map();
  for (const r of rows) {
    const handle = get(r, 'Handle');
    if (!handle) continue;
    let p = byHandle.get(handle);
    if (!p) byHandle.set(handle, (p = { handle, variants: [], images: [], optionNames: [] }));
    // Product-level fields only appear on the first row of each handle.
    if (get(r, 'Title')) {
      Object.assign(p, { title: get(r, 'Title'), description: htmlToText(get(r, 'Body (HTML)')), type: get(r, 'Type'), tags: get(r, 'Tags'), status: (get(r, 'Status') || 'active').toLowerCase() });
      p.optionNames = [1, 2, 3].map(n => get(r, `Option${n} Name`));
    }
    const src = get(r, 'Image Src');
    if (src && !p.images.some(i => i.src === src)) p.images.push({ src, position: +get(r, 'Image Position') || 99, alt: get(r, 'Image Alt Text') });
    const opts = [1, 2, 3].map(n => get(r, `Option${n} Value`));
    if (get(r, 'Variant SKU') || opts[0]) {
      const tracked = get(r, 'Variant Inventory Tracker') === 'shopify' && ix['Variant Inventory Qty'] != null;
      p.variants.push({ opts, sku: get(r, 'Variant SKU'), price: Number(get(r, 'Variant Price')) || 0, stock: tracked ? Math.max(0, +get(r, 'Variant Inventory Qty') || 0) : 999, image: get(r, 'Variant Image') });
    }
  }
  return [...byHandle.values()].filter(p => p.title).map(p => {
    const ci = p.optionNames.findIndex(n => /colou?r/i.test(n));
    // Everything that isn't colour becomes the size label; combo packs ("Tee A size", "Tee B size") read "S / M".
    const rest = p.optionNames.map((n, i) => i).filter(i => i !== ci && p.optionNames[i] && !/^title$/i.test(p.optionNames[i]));
    const variants = p.variants.map(v => ({
      color: ci >= 0 ? v.opts[ci].toUpperCase() : '',
      label: (rest.map(i => v.opts[i]).filter(Boolean).join(' / ') || 'OS').toUpperCase(),
      sku: v.sku, price: v.price, stock: v.stock, image: v.image,
    }));
    // Shopify often lists XS last; sort sizes the way people read them, keeping colour order.
    const rank = l => { const i = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL', '6XL', '7XL'].indexOf(l.split(' / ')[0]); return i < 0 ? 99 : i; };
    const colorOrder = [...new Set(variants.map(v => v.color))];
    variants.sort((a, b) => colorOrder.indexOf(a.color) - colorOrder.indexOf(b.color) || rank(a.label) - rank(b.label));
    const colorImages = {};
    for (const v of variants) if (v.color && v.image && !colorImages[v.color]) colorImages[v.color] = v.image;
    // Gallery = images in position order, minus the mockups that belong to other colours.
    const firstColor = variants.find(v => v.color)?.color;
    const others = new Set(Object.entries(colorImages).filter(([c]) => c !== firstColor).map(([, u]) => u));
    const gallery = p.images.sort((a, b) => a.position - b.position).map(i => i.src).filter(u => !others.has(u));
    return {
      handle: p.handle, title: p.title, description: p.description, type: p.type, status: p.status,
      price: Math.min(...variants.map(v => v.price).filter(Boolean)) || 0,
      variants, colorImages, gallery,
    };
  });
}
