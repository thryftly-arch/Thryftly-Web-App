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

export const qikinkOrders = () => qikink('/api/order');

export function qikinkCreateOrder(order) {
  const [first, ...rest] = order.customer.name.trim().split(/\s+/);
  return qikink('/api/order/create', {
    method: 'POST',
    body: JSON.stringify({
      order_number: order.number, // Qikink rejects anything but letters/digits
      qikink_shipping: '1',
      gateway: 'Prepaid',
      total_order_value: String(order.amount),
      line_items: order.items.map(i => ({ search_from_my_products: 1, quantity: String(i.qty), price: String(i.price), sku: i.sku })),
      shipping_address: {
        first_name: first, last_name: rest.join(' ') || first,
        address1: order.customer.address1, address2: order.customer.address2 || '',
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
