// Run: npm run check — verifies the payment-signature logic money depends on.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

process.env.RAZORPAY_KEY_SECRET = 'test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'hook_secret';
const I = await import('./integrations.js');
const sig = (k, d) => crypto.createHmac('sha256', k).update(d).digest('hex');

assert.ok(I.razorpayVerifyPayment('order_1', 'pay_1', sig('test_secret', 'order_1|pay_1')), 'valid payment signature accepted');
assert.ok(!I.razorpayVerifyPayment('order_1', 'pay_2', sig('test_secret', 'order_1|pay_1')), 'signature for another payment rejected');
assert.ok(!I.razorpayVerifyPayment('order_1', 'pay_1', 'short'), 'malformed signature rejected');
assert.ok(!I.razorpayVerifyPayment('order_1', 'pay_1', undefined), 'missing signature rejected');
const body = Buffer.from('{"event":"payment.captured"}');
assert.ok(I.razorpayVerifyWebhook(body, sig('hook_secret', body)), 'valid webhook accepted');
assert.ok(!I.razorpayVerifyWebhook(body, sig('wrong', body)), 'forged webhook rejected');
console.log('payment checks ok');

// Qikink CSV import parses the real dashboard export shape.
const csv = `"","Product ID","Products","Product Price  Inclusive (Shipping & Tax)-->","Selling Price"
"","63475602","Unisex Oversized Hoodie                Unisex Oversized Hoodie | UH32                vibe2_69386c6a0c2da | W - 3.5 | H - 1.56bolt_6913160c253a5 | W - 1.69 | H - 3.5                7 Colors | Size : S - 3XL  | 42 Variants                Embroidery                Pushed","945.00 - 997.50","1999 - 1999"
"","63463106","NS Hoodie                Unisex Oversized Hoodie | UH32                NS | W - 4.01 | H - 5.02                7 Colors | Size : S - 3XL  | 42 Variants                DTF                Pushed","1,016.07 - 1,068.57","1999 - 1999"
"","63467032","Corporate Sample Sweatshirt                Unisex Sweatshirt | UH26                8 Colors | Size : S - L  | 24 Variants                Cotton Apparels                Pushed","433.10 - 433.10","599 - 599"`;
const [a, b, c] = I.parseQikinkCsv(csv);
assert.equal(a.name, 'UNISEX OVERSIZED HOODIE — VIBE2');
assert.deepEqual(a.sizes, ['S', 'M', 'L', 'XL', '2XL', '3XL']);
assert.equal(a.colors * a.sizes.length, a.variants);
assert.equal(a.printType, 'EMBROIDERY');
assert.equal(b.name, 'NS HOODIE');
assert.equal(b.cost, 1016.07);
assert.equal(c.baseCode, 'UH26');
assert.deepEqual(c.sizes, ['S', 'M', 'L']);
assert.equal(c.price, 599);
console.log('qikink csv checks ok');

// Shopify export: variants, per-colour images and gallery.
const shop = `Handle,Title,Body (HTML),Type,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Inventory Tracker,Variant Price,Image Src,Image Position,Variant Image,Status
ns-hoodie,NS Hoodie,<p>Heavy &amp; warm</p>,Hoodie,Color,Black,Size,S,QK-NS-BK-S,,1999,https://cdn.shopify.com/a.jpg,1,https://cdn.shopify.com/a.jpg,active
ns-hoodie,,,,,Black,,3XL,QK-NS-BK-3XL,,2099,https://cdn.shopify.com/b.jpg,2,https://cdn.shopify.com/a.jpg,
ns-hoodie,,,,,Bone,,S,QK-NS-BN-S,,1999,https://cdn.shopify.com/c.jpg,3,https://cdn.shopify.com/c.jpg,
plain-cap,Plain Cap,,Cap,Title,Default Title,,,QK-CAP,,599,,,,draft`;
const [ns, cap] = I.parseShopifyCsv(shop);
assert.equal(ns.description, 'Heavy & warm');
assert.equal(ns.price, 1999);
assert.deepEqual(ns.variants.map(v => [v.color, v.label, v.sku, v.price]), [['BLACK', 'S', 'QK-NS-BK-S', 1999], ['BLACK', '3XL', 'QK-NS-BK-3XL', 2099], ['BONE', 'S', 'QK-NS-BN-S', 1999]]);
assert.deepEqual(ns.colorImages, { BLACK: 'https://cdn.shopify.com/a.jpg', BONE: 'https://cdn.shopify.com/c.jpg' });
assert.deepEqual(ns.gallery, ['https://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com/b.jpg']);
assert.deepEqual(cap.variants.map(v => [v.color, v.label]), [['', 'OS']]);
assert.equal(cap.status, 'draft');
const [combo] = I.parseShopifyCsv(`Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Price,Status
duo,Duo,Tee A (color),Black,Tee A (size),S,Tee B (size),M,qikink-sku-1,1599,active`);
assert.deepEqual(combo.variants.map(v => [v.color, v.label]), [['BLACK', 'S / M']]);
// Back photos per colour: Qikink file codes, then interleaved order.
const backs = I.parseShopifyCsv(`Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Image Src,Image Position,Variant Image,Status
t,T,Color,Black,Size,S,a,1,https://x/Front_1_c_2_aa.jpg,1,https://x/Front_1_c_2_aa.jpg,active
t,,,Navy,,S,b,1,https://x/Front_1_c_3_bb.jpg,2,https://x/Front_1_c_3_bb.jpg,
t,,,,,,,,https://x/Back_2_c_3_cc.jpg,3,,
t,,,,,,,,https://x/Back_2_c_2_dd.jpg,4,,`)[0];
assert.deepEqual(backs.colorBacks, { BLACK: 'https://x/Back_2_c_2_dd.jpg', NAVY: 'https://x/Back_2_c_3_cc.jpg' });
assert.deepEqual(backs.gallery, ['https://x/Front_1_c_2_aa.jpg', 'https://x/Back_2_c_2_dd.jpg']);
const inter = I.parseShopifyCsv(`Handle,Title,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Image Src,Image Position,Variant Image,Status
u,U,Color,White,Size,S,a,1,https://x/1.png,1,https://x/1.png,active
u,,,,,,,,https://x/2.png,2,,
u,,,Black,,S,b,1,https://x/3.png,3,https://x/3.png,
u,,,,,,,,https://x/4.png,4,,`)[0];
assert.deepEqual(inter.colorBacks, { WHITE: 'https://x/2.png', BLACK: 'https://x/4.png' });
console.log('shopify csv checks ok');

// Qikink → WooCommerce receiver: replay a typical push against a throwaway server.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thryftly-check-'));
const port = 3900 + Math.floor(Math.random() * 100);
const srv = spawn(process.execPath, [path.resolve('server/index.js')], {
  cwd: tmp, stdio: ['ignore', 'pipe', 'inherit'],
  env: { ...process.env, NODE_ENV: 'development', PORT: port, DATA_DIR: tmp, SITE_URL: 'https://shop.test', WOO_CONSUMER_KEY: 'ck_test', WOO_CONSUMER_SECRET: 'cs_test' },
});
await new Promise(r => srv.stdout.once('data', r));
const basic = { Authorization: 'Basic ' + Buffer.from('ck_test:cs_test').toString('base64') };
const call = async (method, url, body, headers = basic) => {
  const r = await fetch(`http://127.0.0.1:${port}${url.startsWith('/?') ? '' : '/wp-json/wc/v3'}${url}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body && JSON.stringify(body) });
  return [r.status, await r.json()];
};
try {
  assert.equal((await call('GET', '/products', undefined, {}))[0], 401, 'no keys rejected');
  assert.equal((await call('GET', '/products?consumer_key=ck_test&consumer_secret=nope', undefined, {}))[0], 401, 'wrong secret rejected');
  const [, cat] = await call('POST', '/products/categories', { name: 'Hoodies' });
  const [, color] = await call('POST', '/products/attributes', { name: 'Color', type: 'select' });
  const [st, prod] = await call('POST', '/products', {
    name: 'Volt Hoodie', type: 'variable', status: 'publish', description: '<p>Heavy &amp; warm</p>', categories: [{ id: cat.id }],
    images: [{ src: 'https://127.0.0.1:1/front.jpg' }, { src: 'https://127.0.0.1:1/back.jpg' }],
    attributes: [{ id: color.id, options: ['Black', 'Bone'], variation: true, visible: true }, { name: 'Size', options: ['S', 'XL'], variation: true, visible: true }],
  });
  assert.equal(st, 201);
  const v = (c, s, sku, price) => ({ sku, regular_price: price, attributes: [{ id: color.id, option: c }, { name: 'Size', option: s }], image: { src: `https://127.0.0.1:1/${c}.jpg` } });
  const [, batch] = await call('POST', `/products/${prod.id}/variations/batch`, { create: [v('Black', 'S', 'qk-1', '1999'), v('Black', 'XL', 'qk-2', '2099'), v('Bone', 'S', 'qk-3', '1999')] });
  assert.equal(batch.create.length, 3);
  // A re-push updates in place, here with query-string auth and a single-variation call.
  const qs = '?consumer_key=ck_test&consumer_secret=cs_test';
  assert.equal((await call('PUT', `/products/${prod.id}/variations/${batch.create[1].id}${qs}`, { regular_price: '2199' }, {}))[0], 200);
  assert.equal((await call('POST', `/products/${prod.id}/variations${qs}`, v('Bone', 'XL', 'qk-4', '2199'), {}))[0], 201);
  const [, got] = await call('GET', `/?rest_route=/wc/v3/products/${prod.id}&${qs.slice(1)}`, undefined, {});
  assert.equal(got.id, prod.id, 'rest_route form works');
  assert.equal(got.variations.length, 4);
  assert.deepEqual((await call('GET', '/orders'))[1], [], 'orders never offered to Qikink');
  assert.equal((await call('DELETE', `/products/${prod.id}`))[0], 200);

  const db = JSON.parse(fs.readFileSync(path.join(tmp, 'db.json'), 'utf8'));
  const p = db.products.find(p => p.woo?.id === prod.id);
  assert.equal(p.active, false, 'pushed products land hidden');
  assert.equal(p.name, 'VOLT HOODIE');
  assert.equal(p.category, 'HOODIES');
  assert.equal(p.description, 'Heavy & warm');
  assert.equal(p.price, 1999);
  assert.deepEqual(p.sizes.map(s => [s.color, s.label, s.sku, s.price]), [['BLACK', 'S', 'qk-1', 0], ['BLACK', 'XL', 'qk-2', 2199], ['BONE', 'S', 'qk-3', 0], ['BONE', 'XL', 'qk-4', 2199]]);
  assert.deepEqual(Object.keys(p.colorImages), ['BLACK', 'BONE']);
  assert.equal(p.images.back, 'https://127.0.0.1:1/back.jpg', 'undownloadable image keeps its URL');
  const log = fs.readFileSync(path.join(tmp, 'woo-log.jsonl'), 'utf8');
  assert.ok(log.split('\n').length > 8 && !log.includes('cs_test'), 'requests logged without the secret');
} finally { srv.kill(); }
console.log('woocommerce receiver checks ok');
