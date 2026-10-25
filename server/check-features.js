// Run by npm run check: reviews, back-in-stock alerts, exchanges/returns and settings, against a throwaway server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thryftly-features-'));
const port = 4000 + Math.floor(Math.random() * 500);
const start = () => {
  const srv = spawn(process.execPath, [path.resolve('server/index.js'), `--port=${port}`], {
    cwd: tmp, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, NODE_ENV: 'development', DATA_DIR: tmp, ADMIN_PASSWORD: 'pw', SESSION_SECRET: 's'.repeat(64), SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SMTP_USER: '', SMTP_PASS: '', QIKINK_CLIENT_ID: '', RAZORPAY_KEY_ID: '' },
  });
  return new Promise(r => srv.stdout.once('data', () => r(srv)));
};
let cookie = '';
const call = async (method, url, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body && JSON.stringify(body) });
  if (r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie').split(';')[0];
  return [r.status, await r.json().catch(() => ({}))];
};

// First run creates the seed database; add a paid, delivered order to it before the real run.
let srv = await start();
srv.kill();
await new Promise(r => setTimeout(r, 200));
const file = path.join(tmp, 'db.json'), db = JSON.parse(fs.readFileSync(file, 'utf8'));
const hoodie = db.products.find(p => p.slug === 'volt-hoodie');
db.orders.push({
  id: 'o1', number: 'thtest0001', items: [{ productId: hoodie.id, slug: hoodie.slug, name: hoodie.name, size: 'XL', color: '', sku: '', qty: 1, price: 128 }],
  subtotal: 128, shipping: 0, amount: 128, discount: null, currency: 'USD', status: 'sent_to_qikink', createdAt: new Date().toISOString(),
  paidAt: new Date().toISOString(), deliveredAt: new Date().toISOString(), paymentId: 'pay_1',
  customer: { name: 'Asha Rao', email: 'asha@example.com', phone: '9876543210', address1: '1 Road', address2: '', city: 'Pune', state: 'Maharashtra', zip: '411001' },
});
fs.writeFileSync(file, JSON.stringify(db));
srv = await start();
try {
  assert.equal((await call('GET', '/api/health'))[1].ok, true);

  // Reviews: a buyer's goes live, a stranger's waits, nobody reviews twice.
  assert.equal((await call('POST', '/api/reviews', { slug: 'volt-hoodie', name: 'A', email: 'asha@example.com', rating: 0, body: 'Lovely heavy hoodie' }))[0], 400, 'rating required');
  let [st, r] = await call('POST', '/api/reviews', { slug: 'volt-hoodie', name: 'Asha', email: 'ASHA@example.com', rating: 5, body: 'Lovely heavy hoodie', fit: 'large' });
  assert.equal(st, 200); assert.equal(r.status, 'published', 'verified review goes live');
  assert.equal((await call('POST', '/api/reviews', { slug: 'volt-hoodie', name: 'Asha', email: 'asha@example.com', rating: 4, body: 'Second go at it' }))[0], 400, 'one review each');
  [, r] = await call('POST', '/api/reviews', { slug: 'volt-hoodie', name: 'Bot', email: 'x@example.com', rating: 1, body: 'Never bought it lol' });
  assert.equal(r.status, 'pending', 'unverified review waits');
  let [, p] = await call('GET', '/api/products/volt-hoodie');
  assert.equal(p.reviews.count, 1); assert.equal(p.reviews.avg, 5); assert.equal(p.reviews.list[0].verified, true);
  assert.equal((await call('POST', '/api/reviews', { slug: 'volt-hoodie', name: 'Bot', email: 'y@example.com', rating: 1, body: 'spam spam spam', website: 'http://spam' }))[1].status, 'pending', 'honeypot answers quietly');

  // Back in stock: only for sizes that are really sold out; restocking in admin sends the email.
  assert.equal((await call('POST', '/api/restock', { slug: 'volt-hoodie', size: 'XL', color: '', email: 'w@example.com' }))[0], 400, 'in-stock size refused');
  assert.equal((await call('POST', '/api/restock', { slug: 'volt-hoodie', size: 'M', color: '', email: 'bad' }))[0], 400, 'bad email refused');
  assert.equal((await call('POST', '/api/restock', { slug: 'volt-hoodie', size: 'M', color: '', email: 'w@example.com' }))[0], 200);
  await call('POST', '/api/restock', { slug: 'volt-hoodie', size: 'M', color: '', email: 'w@example.com' });
  assert.equal((await call('POST', '/api/admin/login', { password: 'pw' }))[0], 200);
  let [, list] = await call('GET', '/api/admin/restock');
  assert.equal(list.length, 1, 'duplicate request stored once');
  const [, products] = await call('GET', '/api/admin/products');
  const h = products.find(x => x.slug === 'volt-hoodie');
  let [, saved] = await call('PUT', '/api/admin/products/' + h.id, { ...h, sizes: h.sizes.map(s => (s.label === 'M' ? { ...s, stock: 3 } : s)) });
  assert.equal(saved.alerted, 1, 'restock emails sent on save');
  [, list] = await call('GET', '/api/admin/restock');
  assert.ok(list[0].notifiedAt, 'marked as emailed');

  // Exchanges: wrong email finds nothing; returns only for damage; a piece can't be claimed twice.
  assert.equal((await call('POST', '/api/returns/lookup', { number: 'thtest0001', email: 'other@example.com' }))[0], 404);
  let [, lk] = await call('POST', '/api/returns/lookup', { number: '#THTEST0001', email: 'asha@example.com' });
  assert.equal(lk.open, true); assert.equal(lk.items[0].left, 1);
  assert.ok(lk.items[0].sizes.includes('M'), 'restocked size offered for the exchange');
  assert.equal((await call('POST', '/api/returns', { number: 'thtest0001', email: 'asha@example.com', type: 'return', items: [{ index: 0, qty: 1, reason: 'Too small' }] }))[0], 400, 'no change-of-mind returns');
  assert.equal((await call('POST', '/api/returns', { number: 'thtest0001', email: 'asha@example.com', type: 'exchange', items: [{ index: 0, qty: 1, reason: 'Too big' }] }))[0], 400, 'exchange needs a size');
  [st, r] = await call('POST', '/api/returns', { number: 'thtest0001', email: 'asha@example.com', type: 'exchange', items: [{ index: 0, qty: 1, reason: 'Too big', want: 'M' }], note: 'Please swap' });
  assert.equal(st, 200); assert.match(r.number, /^rx/);
  assert.equal((await call('POST', '/api/returns', { number: 'thtest0001', email: 'asha@example.com', type: 'exchange', items: [{ index: 0, qty: 1, reason: 'Too big', want: 'M' }] }))[0], 400, 'already requested');
  [, list] = await call('GET', '/api/admin/returns');
  [, saved] = await call('PUT', '/api/admin/returns/' + list[0].id, { status: 'approved', reply: 'Pickup on Monday' });
  assert.equal(saved.status, 'approved');
  let [, t] = await call('POST', '/api/track', { number: 'thtest0001', email: 'asha@example.com' });
  assert.deepEqual(t.returns.map(x => [x.status, x.reply]), [['approved', 'Pickup on Monday']]);
  assert.equal(t.customer.phone, '98•••••210', 'phone masked on the customer page');
  assert.equal(t.paid, true);

  // Settings: booleans and bounded numbers.
  [, saved] = await call('PUT', '/api/admin/settings', { popupOn: true, gstRate: 99, exchangeDays: 0 });
  assert.equal(saved.popupOn, true); assert.equal(saved.gstRate, 28); assert.equal(saved.exchangeDays, 0);
  assert.equal((await call('POST', '/api/returns/lookup', { number: 'thtest0001', email: 'asha@example.com' }))[1].open, false, 'exchange page can be switched off');
  [, saved] = await call('PUT', '/api/admin/settings', { popupOn: false });
  assert.equal(saved.popupOn, false);
  const [, ov] = await call('GET', '/api/admin/overview');
  assert.equal(ov.reviews, 1, 'honeypot review never stored'); assert.equal(ov.returns, 0); assert.equal(ov.waiting, 0);
  assert.equal((await call('GET', '/api/pincode/012345'))[0], 400, 'bad PIN refused');
} finally { srv.kill(); }
console.log('reviews, restock, exchanges and settings checks ok');
