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
