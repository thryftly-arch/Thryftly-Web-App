// Run: npm run check — verifies the payment-signature logic money depends on.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
console.log('shopify csv checks ok');
