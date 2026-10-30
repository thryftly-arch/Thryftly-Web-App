// Checks the Supabase backend and the Netlify function against a fake Supabase (REST + Storage)
// on localhost: reads, changed-rows-only saves, deletes, image upload, admin login.
// Run: node server/check-supabase.js   (also part of npm run check)
import http from 'node:http';
import assert from 'node:assert/strict';

const rows = new Map(), files = new Map(), log = [];
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    assert.equal(req.headers.apikey, 'sb_secret_test');
    log.push(req.method + ' ' + u.pathname);
    const send = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v ?? {})); };
    if (u.pathname === '/rest/v1/thryftly') {
      if (req.method === 'GET') {
        const all = [...rows.values()].sort((a, b) => (a.coll + a.id).localeCompare(b.coll + b.id));
        const off = +u.searchParams.get('offset'), lim = +u.searchParams.get('limit');
        return send(200, all.slice(off, off + lim).map(({ coll, id, data }) => ({ coll, id, data })));
      }
      if (req.method === 'POST') { for (const r of JSON.parse(body)) rows.set(r.coll + '/' + r.id, r); return send(201); }
      if (req.method === 'DELETE') {
        const coll = u.searchParams.get('coll').slice(3), ids = JSON.parse('[' + u.searchParams.get('id').slice(4, -1) + ']');
        ids.forEach(i => rows.delete(coll + '/' + i));
        return send(204);
      }
    }
    if (u.pathname === '/storage/v1/object/list/uploads') return send(200, [...files.keys()].map(name => ({ name })));
    const m = /^\/storage\/v1\/object\/uploads\/(.+)$/.exec(u.pathname);
    if (m && req.method === 'POST') { files.set(decodeURIComponent(m[1]), body); return send(200, { Key: m[1] }); }
    send(404, { error: 'mock: no route ' + req.method + ' ' + u.pathname });
  });
});
await new Promise(r => mock.listen(0, r));

Object.assign(process.env, {
  SUPABASE_URL: `http://127.0.0.1:${mock.address().port}`, SUPABASE_SECRET_KEY: 'sb_secret_test',
  LAMBDA_TASK_ROOT: '/var/task', ADMIN_PASSWORD: 'pw-for-check', SESSION_SECRET: 'x'.repeat(64),
  QIKINK_CLIENT_ID: '', RAZORPAY_KEY_ID: '', WOO_CONSUMER_KEY: 'ck_test', WOO_CONSUMER_SECRET: 'cs_test',
});
const { handler } = await import('../netlify/functions/api.mjs');
const S = await import('./store.js');

const call = async (method, path, { body, headers = {}, base64 } = {}) => {
  const r = await handler({
    httpMethod: method, path: '/.netlify/functions/api' + path, headers: { host: 'shop.test', 'x-forwarded-for': '1.2.3.4', ...headers },
    queryStringParameters: {}, body: base64 ?? (body ? JSON.stringify(body) : null), isBase64Encoded: !!base64,
  }, {});
  const text = r.isBase64Encoded ? Buffer.from(r.body, 'base64').toString() : r.body;
  return { status: r.statusCode, headers: r.headers, multi: r.multiValueHeaders, json: JSON.parse(text || 'null') };
};
const J = { 'content-type': 'application/json' };

// Empty project: first read seeds, nothing written until something changes.
let r = await call('GET', '/api/site');
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.ok(r.json.products.length > 0, 'seed products served');
assert.equal(rows.size, 0);

// A write saves every row the first time (fresh project), then only what changed.
r = await call('POST', '/api/subscribe', { body: { email: 'A@b.co' }, headers: J });
assert.equal(r.status, 200, JSON.stringify(r.json));
assert.ok(rows.has('subscribers/a@b.co') && rows.has('doc/settings'), 'subscriber + seed saved');
const seeded = rows.size;
log.length = 0;
await call('POST', '/api/subscribe', { body: { email: 'c@d.co' }, headers: J });
assert.equal(rows.size, seeded + 1);
assert.deepEqual(log.filter(l => !l.startsWith('GET')), ['POST /rest/v1/thryftly'], 'one upsert, nothing else rewritten');

// Another server's change is seen on the next write (no stale overwrite).
rows.get('doc/settings').data.heroTitle = 'CHANGED ELSEWHERE';
await call('POST', '/api/contact', { body: { name: 'Ann', email: 'a@b.co', message: 'hi' }, headers: J });
assert.equal(rows.get('doc/settings').data.heroTitle, 'CHANGED ELSEWHERE');
assert.equal([...rows.keys()].filter(k => k.startsWith('messages/')).length, 1);

// Admin: login, edit, delete (row removed), upload (goes to Storage).
r = await call('POST', '/api/admin/login', { body: { password: 'pw-for-check' }, headers: J });
assert.equal(r.status, 200, JSON.stringify(r.json));
const cookie = String(r.headers['set-cookie'] || r.multi?.['set-cookie']?.[0]).split(';')[0];
const A = { ...J, cookie };
r = await call('GET', '/api/admin/products', { headers: A });
const victim = r.json[0];
r = await call('PUT', '/api/admin/products/' + victim.id, { body: { ...victim, price: 999 }, headers: A });
assert.equal(rows.get('products/' + victim.id).data.price, 999);
r = await call('DELETE', '/api/admin/products/' + victim.id, { headers: A });
assert.ok(!rows.has('products/' + victim.id), 'deleted row gone from Supabase');

const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const multipart = Buffer.concat([Buffer.from('--B\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n'), png, Buffer.from('\r\n--B--\r\n')]);
r = await call('POST', '/api/admin/upload', { base64: multipart.toString('base64'), headers: { ...A, 'content-type': 'multipart/form-data; boundary=B' } });
assert.equal(r.status, 200, JSON.stringify(r.json));
const name = r.json.url.replace('/uploads/', '');
assert.ok(files.get(name)?.equals(png), 'image bytes landed in Storage');

// Imports can't run inside a function; the save of a failed write isn't attempted.
r = await call('POST', '/api/admin/import/shopify', { body: 'x', headers: { ...A, 'content-type': 'text/csv' } });
assert.equal(r.status, 400);

// Qikink "Push to store": /?rest_route=/wc/v3/… reaches the store through the function, is checked,
// saved (hidden, Qikink's image links kept) and logged for the admin.
const wp = async (method, route, { body, auth } = {}) => {
  const r = await handler({
    httpMethod: method, path: '/', queryStringParameters: { rest_route: route }, isBase64Encoded: false, body: body ? JSON.stringify(body) : null,
    headers: { host: 'shop.test', 'x-forwarded-for': '1.2.3.4', 'content-type': 'application/json', ...(auth && { authorization: 'Basic ' + Buffer.from('ck_test:cs_test').toString('base64') }) },
  }, {});
  return { status: r.statusCode, json: JSON.parse(r.body || 'null') };
};
r = await wp('GET', '/wc/v3/products');
assert.equal(r.status, 401, 'push without the store keys is refused');
r = await wp('POST', '/wc/v3/products', { auth: true, body: { name: 'Pushed Tee', type: 'simple', sku: 'qk-1', regular_price: '799', images: [{ src: 'https://qikink-assets.example/front.jpg' }] } });
assert.equal(r.status, 201, JSON.stringify(r.json));
const pushed = [...rows.values()].find(x => x.coll === 'products' && x.data.name === 'PUSHED TEE')?.data;
assert.ok(pushed && pushed.active === false && pushed.price === 799 && pushed.images.front === 'https://qikink-assets.example/front.jpg', 'pushed product saved hidden, with Qikink\'s image link');
assert.ok(rows.get('doc/wooLog')?.data.length >= 2, 'push requests logged for the admin');

assert.ok((await S.listFiles()).has(name));
mock.close();
console.log('supabase + netlify function checks ok');
