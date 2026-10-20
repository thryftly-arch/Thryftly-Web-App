// The store is one in-memory object (db) that the routes read and change, then save().
// Two backends:
//  - local file (data/db.json + data/uploads/): the default, for running on your own computer or a VPS.
//    Every write goes to a temp file then renames, so a crash never leaves half a database.
//  - Supabase (SUPABASE_URL + SUPABASE_SECRET_KEY set): for Netlify, which has no disk. Each product,
//    order, drop, message and subscriber is a row in table "thryftly"; settings/pages are "doc" rows.
//    save() writes only the rows that changed, so two servers adding different orders don't collide.
//    Images go to the public Storage bucket "uploads". See supabase/schema.sql.
// ponytail: every request reloads the whole store (fine to a few thousand orders); past that, query per route.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const SB = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
export const remote = !!(SB && KEY);
if (!remote) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const id = () => crypto.randomBytes(8).toString('hex');

const size = (label, stock = 1, sku = '') => ({ label, stock, sku });
const ph = { front: '', back: '', detail: '', onBody: '' };

// Seed = the content of the original mockup, so a fresh install looks like the design.
const SEED = () => ({
  settings: {
    currency: 'USD',
    symbol: '$',
    shippingFee: 0,
    freeShippingOver: 150,
    dropLabel: 'DROP 07',
    liveLabel: '',
    kicker: 'PRINTED TO ORDER // SHIPPED ACROSS INDIA',
    mobileKicker: 'PRINTED TO ORDER',
    heroTitle: 'WEAR THE',
    heroAccent: 'VOLTAGE.',
    heroText: "Rescued vintage, reworked by hand and charged for the street. Every piece is a one-off. When it's gone, it's archived.",
    ctaLabel: 'SHOP NOW →',
    secondaryCta: 'TRENDING NOW',
    countdownLabel: 'NEXT DROP UNLOCKS IN',
    countdownTarget: new Date(Date.now() + (2 * 86400 + 14 * 3600 + 37 * 60) * 1000).toISOString(),
    heroImage: '',
    marquee: ['PRINTED TO ORDER', 'OVERSIZED FITS', 'HOODIES · TEES · SWEATSHIRTS', 'SHIPPED ACROSS INDIA'],
    rotationTitle: 'TRENDING NOW',
    productsTitle: 'ALL PRODUCTS',
    signupTitle: 'BE FIRST TO KNOW.',
    footerWord: 'THRYFTLY',
    socials: { instagram: '', tiktok: '', discord: '' },
    // Emails: a code in the welcome emails (account + drop list) and in abandoned-cart reminders. Create it under Discounts.
    welcomeCode: '',
    reminderCode: '',
    // Analytics: GA4 measurement ID (G-…) and Meta Pixel ID. Empty = not loaded.
    ga4Id: '',
    metaPixelId: '',
    contact: { email: '', phone: '', whatsapp: '', address: '', hours: '' },
  },
  // Long-form pages, edited in Admin → Pages. Plain text: blank line = paragraph, "- " = list, "# " = heading.
  // The policies are starting drafts with [brackets] to fill in; check them before launch.
  pages: {
    about: { title: 'ABOUT THRYFTLY', body: "THRYFTLY is streetwear charged for the street: bold graphics, oversized fits and drops that don't hang around.\n\nEvery piece is printed to order, so nothing sits in a warehouse and nothing goes to waste. Pick your colour and size, and it's made for you.\n\n# THE DROPS\nNew designs land in drops. Get the drop alert at the bottom of the page so you hear first." },
    shipping: { title: 'SHIPPING POLICY', body: "# PROCESSING\nEvery order is printed to order. Orders are usually printed and dispatched within [3–5] business days.\n\n# DELIVERY\nWe ship across India. Delivery usually takes [4–7] business days after dispatch, depending on your PIN code.\n\n# TRACKING\nOnce your order ships, you can follow it on the Track Order page with your order number and email.\n\n# SHIPPING COST\n[Free shipping on all orders / Shipping is calculated at checkout.]" },
    returns: { title: 'RETURNS & REFUNDS', body: "Because every piece is printed to order, we can't accept returns for change of mind or wrong size. Please check the size chart before ordering.\n\n# DAMAGED OR WRONG ITEM\nIf your order arrives damaged, misprinted or wrong, contact us within [7] days of delivery with your order number and photos. We'll send a replacement or refund you.\n\n# REFUNDS\nApproved refunds go back to your original payment method within [5–7] business days.\n\n# CANCELLATIONS\nOrders can be cancelled within [12] hours of placing them, before they go to print." },
    privacy: { title: 'PRIVACY POLICY', body: "We collect only what we need to make and deliver your order: your name, email, phone number and shipping address.\n\n- Payments are processed by Razorpay. We never see or store your card or UPI details.\n- Your name, phone and address are shared with our print and shipping partner only to fulfil your order.\n- If you join the drop alert, we use your email to tell you about new drops. Unsubscribe any time.\n- AI try-on photos stay on your device unless you press \"Ask the AI stylist\". They are then analysed once and not stored.\n\nQuestions about your data? Contact us at [your email]." },
    terms: { title: 'TERMS OF SERVICE', body: "By using this site and placing an order, you agree to these terms.\n\n# ORDERS & PRICING\nAll prices are in Indian Rupees and include applicable taxes unless stated. We may cancel an order and refund you in full if a product is unavailable or mispriced.\n\n# PRODUCTS\nColours on screen can differ slightly from the printed product. Sizes follow the size guide on each product.\n\n# INTELLECTUAL PROPERTY\nAll designs, graphics and content on this site belong to THRYFTLY and may not be reused without permission.\n\n# CONTACT\n[Business name, address and email]." },
  },
  messages: [],
  // Special drops, managed in Admin → Drops. Off by default.
  drops: [],
  products: [
    {
      id: id(), slug: 'volt-hoodie', name: 'VOLT HOODIE', edition: '/07', price: 128, category: 'OUTERWEAR',
      badge: '1 OF 1', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: 'WASHED BLK', fitLabel: 'FITS LIKE XL',
      description: 'A 90s heavyweight fleece, garment-washed black, hand-printed with a cracked bolt across the back. Boxy fit, dropped shoulder.',
      sizes: [size('M', 0), size('L', 0), size('XL', 1)],
      specs: [{ k: 'ERA', v: '1994 — Made in USA' }, { k: 'FABRIC', v: '80/20 cotton fleece, 420gsm' }, { k: 'CONDITION', v: '9/10 — light fading at cuffs' }, { k: 'PIT / LENGTH', v: '66cm / 72cm' }],
      images: { ...ph }, tryonImage: '', ringLabel: 'hoodie — front', featured: true, inRotation: true, active: true, sort: 1,
    },
    { id: id(), slug: 'grid-cargo', name: 'GRID CARGO', edition: '', price: 96, category: 'BOTTOMS', badge: '', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: 'OLIVE', fitLabel: 'FITS LIKE 32', description: '', sizes: [size('32')], specs: [], images: { ...ph }, tryonImage: '', ringLabel: 'cargo pant', featured: true, inRotation: true, active: true, sort: 2 },
    { id: id(), slug: 'static-varsity', name: 'STATIC VARSITY', edition: '', price: 210, category: 'OUTERWEAR', badge: 'LAST ONE', badgeStyle: 'red', tag: 'REWORKED VINTAGE', color: 'RED/CREAM', fitLabel: 'FITS LIKE L', description: '', sizes: [size('L')], specs: [], images: { ...ph }, tryonImage: '', ringLabel: 'varsity jacket', featured: true, inRotation: true, active: true, sort: 3 },
    { id: id(), slug: 'surge-tee', name: 'SURGE TEE', edition: '', price: 54, category: 'TOPS', badge: '', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: 'BONE', fitLabel: 'FITS LIKE M', description: '', sizes: [size('M')], specs: [], images: { ...ph }, tryonImage: '', ringLabel: 'graphic tee', featured: true, inRotation: true, active: true, sort: 4 },
    { id: id(), slug: 'bolt-cap', name: 'BOLT CAP', edition: '', price: 38, category: 'ACCESSORIES', badge: '', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: 'BLACK', fitLabel: 'ONE SIZE', description: '', sizes: [size('OS')], specs: [], images: { ...ph }, tryonImage: '', ringLabel: 'trucker cap', featured: false, inRotation: true, active: true, sort: 5 },
    { id: id(), slug: 'rewire-denim', name: 'REWIRE DENIM', edition: '', price: 164, category: 'OUTERWEAR', badge: '', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: 'INDIGO', fitLabel: 'FITS LIKE L', description: '', sizes: [size('L')], specs: [], images: { ...ph }, tryonImage: '', ringLabel: 'denim jacket', featured: false, inRotation: true, active: true, sort: 6 },
  ],
  orders: [],
  subscribers: [],
});

// Older databases miss keys added since they were created: fill those in, never overwrite.
function migrate() {
  const seed = SEED();
  for (const [k, v] of Object.entries(seed.settings)) if (!(k in db.settings)) db.settings[k] = v;
  db.pages = { ...seed.pages, ...db.pages };
  db.messages ??= [];
  db.drops ??= [];
  db.discounts ??= [];
  db.sizeCharts ??= [];
  // Copy that only made sense for the mockup's "Drop 07": swap it for the new defaults, but only
  // where it was never edited (still exactly the old text).
  const OLD = { liveLabel: 'DROP 07 LIVE', kicker: 'DROP 07 // STATIC SEASON // 300 UNITS', mobileKicker: 'DROP 07 // LIVE', ctaLabel: 'SHOP DROP 07 →', secondaryCta: 'VIEW LOOKBOOK', rotationTitle: 'THE ROTATION', signupTitle: 'GET THE DROP ALERT.' };
  for (const [k, v] of Object.entries(OLD)) if (db.settings[k] === v) db.settings[k] = seed.settings[k];
  if (db.settings.marquee?.some(m => /DROP 07|REWORKED VINTAGE|300 UNITS/.test(m))) db.settings.marquee = seed.settings.marquee;
}

export const db = {};
const ROWS = ['products', 'drops', 'orders', 'messages', 'subscribers', 'discounts', 'sizeCharts'];
const DOCS = ['settings', 'pages', 'importedImages', 'woo'];
const rowId = (coll, r) => String(coll === 'subscribers' ? r.email : r.id);

/* ---------- local file ---------- */
if (!remote) {
  Object.assign(db, fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : SEED());
  migrate();
  if (!fs.existsSync(DB_FILE)) writeFile();
}
function writeFile() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- Supabase ---------- */
async function sb(url, opts = {}) {
  // Legacy service_role keys are JWTs and go in Authorization too; new sb_secret_ keys go in apikey only.
  const auth = KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + KEY } : {};
  const res = await fetch(SB + url, { ...opts, headers: { apikey: KEY, ...auth, ...opts.headers }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res;
}

let snap = new Map(), loadedAt = 0;
const current = () => {
  const m = new Map();
  for (const c of ROWS) for (const r of db[c] || []) m.set(`${c}/${rowId(c, r)}`, { coll: c, id: rowId(c, r), data: r });
  for (const d of DOCS) if (db[d] !== undefined) m.set(`doc/${d}`, { coll: 'doc', id: d, data: db[d] });
  return m;
};

// Bring db up to date with Supabase. A server that's already warm only fetches the rows that changed
// since its last look (one small request; the database sits far from Netlify's functions, so size matters).
// Everything is re-read at least once a minute (rows deleted elsewhere drop out then) and after any failed write.
// maxAge > 0 skips the check if the last one is that recent.
let fullAt = 0, newest = '';
const SKIP = '&coll=not.in.(wishlists,customers)&not.and=(coll.eq.doc,id.eq.importedImages)'; // read one at a time / when importing
async function rowsWhere(filter) {
  const rows = [];
  for (let off = 0; ; off += 1000) {
    const page = await (await sb(`/rest/v1/thryftly?select=coll,id,data,updated_at&order=coll,id&limit=1000&offset=${off}${SKIP}${filter}`)).json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}
const noteNewest = rows => { for (const r of rows) if (r.updated_at > newest) newest = r.updated_at; };
const sortLists = () => {
  const by = k => (a, b) => String(a[k]).localeCompare(String(b[k]));
  db.orders.sort(by('createdAt')); db.messages.sort(by('at')); db.subscribers.sort(by('at'));
};
// Forget the warm copy: the next load reads everything again.
export const invalidate = () => { fullAt = 0; };

export async function load(maxAge = 0) {
  if (!remote || (maxAge && Date.now() - loadedAt < maxAge)) return;
  if (fullAt && Date.now() - fullAt < 60e3 && newest) {
    // Clocks on different servers drift a little: look 5 s further back and re-apply what's unchanged.
    const since = new Date(Date.parse(newest) - 5000).toISOString();
    const rows = await rowsWhere(`&updated_at=gte.${encodeURIComponent(since)}`);
    for (const r of rows) {
      const key = `${r.coll}/${r.id}`, json = JSON.stringify(r.data);
      if (snap.get(key) === json) continue;
      if (r.coll === 'doc') db[r.id] = r.data;
      else if (db[r.coll]) {
        const i = db[r.coll].findIndex(x => rowId(r.coll, x) === r.id);
        i < 0 ? db[r.coll].push(r.data) : (db[r.coll][i] = r.data);
      }
      snap.set(key, json);
    }
    noteNewest(rows);
    if (rows.length) { sortLists(); migrate(); }
    loadedAt = Date.now();
    return;
  }
  const rows = await rowsWhere('');
  for (const k of Object.keys(db)) delete db[k];
  if (!rows.some(r => r.coll === 'doc' && r.id === 'settings')) Object.assign(db, SEED()); // empty project: start from the seed
  else {
    for (const c of ROWS) db[c] = [];
    for (const r of rows) r.coll === 'doc' ? (db[r.id] = r.data) : db[r.coll]?.push(r.data);
    sortLists();
  }
  snap = new Map(rows.map(r => [`${r.coll}/${r.id}`, JSON.stringify(r.data)]));
  newest = '';
  noteNewest(rows);
  migrate();
  loadedAt = fullAt = Date.now();
}

// Write the rows that changed since the last load/save, delete the ones that are gone.
async function push() {
  const now = current(), at = new Date().toISOString();
  const next = new Map([...now].map(([k, r]) => [k, JSON.stringify(r.data)]));
  const up = [...now].filter(([k]) => snap.get(k) !== next.get(k)).map(([, r]) => ({ ...r, updated_at: at }));
  if (!up.length && [...snap.keys()].every(k => next.has(k))) return; // nothing changed
  for (let i = 0; i < up.length; i += 200) {
    await sb('/rest/v1/thryftly', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(up.slice(i, i + 200)) });
  }
  const gone = {};
  for (const k of snap.keys()) if (!next.has(k)) { const [c, ...rest] = k.split('/'); (gone[c] ||= []).push(rest.join('/')); }
  for (const [c, ids] of Object.entries(gone)) {
    for (let i = 0; i < ids.length; i += 100) {
      const list = ids.slice(i, i + 100).map(x => `"${x.replace(/["\\]/g, '')}"`).join(',');
      await sb(`/rest/v1/thryftly?coll=eq.${c}&id=in.(${encodeURIComponent(list)})`, { method: 'DELETE' });
    }
  }
  snap = next; // only after everything landed, so a failed save is retried in full next time
}

let chain = Promise.resolve(), last = null;
export function save() {
  if (!remote) { writeFile(); return Promise.resolve(); }
  last = chain = chain.catch(() => {}).then(push);
  return last;
}
// The save started by the current request, if any (the server waits for it before replying).
export function flush() { const p = last; last = null; return p; }

// One writing request at a time per server: it reloads, changes, saves, then the next one goes.
let queue = Promise.resolve(), writers = 0;
export const isBusy = () => writers > 0;
export function lock() {
  let release;
  const mine = new Promise(r => (release = r)), before = queue;
  queue = queue.then(() => mine);
  writers++;
  let done = false;
  return before.then(() => () => { if (!done) { done = true; writers--; release(); } });
}

/* ---------- single rows, outside db (wishlists, import bookkeeping) ---------- */
export async function getRow(coll, id) {
  if (!remote) return db[coll]?.[id] ?? null;
  const [r] = await (await sb(`/rest/v1/thryftly?select=data&coll=eq.${coll}&id=eq.${encodeURIComponent(id)}`)).json();
  return r?.data ?? null;
}
export async function putRow(coll, id, data) {
  if (!remote) { (db[coll] ||= {})[id] = data; writeFile(); return; }
  await sb('/rest/v1/thryftly', { method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ coll, id, data, updated_at: new Date().toISOString() }]) });
}

/* ---------- customer sign-in (Supabase Auth) ---------- */
// The browser signs in with Supabase directly and sends its access token; this checks it with Supabase.
// Cached a minute per token so a page's few calls cost one check.
const users = new Map();
export async function authUser(token) {
  if (!remote || !token) return null;
  const hit = users.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const res = await fetch(SB + '/auth/v1/user', { headers: { apikey: KEY, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const u = await res.json();
  const user = { id: u.id, email: String(u.email || '').toLowerCase(), verified: !!u.email_confirmed_at };
  if (users.size > 500) users.clear();
  users.set(token, { user, until: Date.now() + 60e3 });
  return user;
}

// Customer accounts, for Admin → Customers.
export async function listUsers() {
  if (!remote) return [];
  const out = [];
  for (let page = 1; page < 50; page++) {
    const j = await (await sb(`/auth/v1/admin/users?page=${page}&per_page=1000`)).json();
    const users = j.users || [];
    out.push(...users);
    if (users.length < 1000) return out;
  }
  return out;
}

/* ---------- images ---------- */
export async function putFile(name, buf, type) {
  if (!remote) return fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  await sb(`/storage/v1/object/uploads/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': type, 'x-upsert': 'true', 'cache-control': 'max-age=31536000' }, body: buf });
}
export const fileUrl = name => `${SB}/storage/v1/object/public/uploads/${encodeURIComponent(name)}`;

// Names already in the bucket (the push script skips those).
export async function listFiles() {
  const names = new Set();
  for (let offset = 0; ; offset += 1000) {
    const page = await (await sb('/storage/v1/object/list/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1000, offset }) })).json();
    page.forEach(f => names.add(f.name));
    if (page.length < 1000) return names;
  }
}
