// Tiny JSON-file store. Every write goes to a temp file then renames, so a crash
// mid-write never leaves a half-written database behind.
// ponytail: whole-file rewrite on each change, single process only. Fine for a
// boutique catalogue + a few thousand orders; move to Postgres/SQLite past that.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

export const db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : SEED();

// Older databases miss keys added since they were created: fill those in, never overwrite.
const seed = SEED();
for (const [k, v] of Object.entries(seed.settings)) if (!(k in db.settings)) db.settings[k] = v;
db.pages = { ...seed.pages, ...db.pages };
db.messages ??= [];
db.drops ??= [];
// Copy that only made sense for the mockup's "Drop 07": swap it for the new defaults, but only
// where it was never edited (still exactly the old text).
const OLD = { liveLabel: 'DROP 07 LIVE', kicker: 'DROP 07 // STATIC SEASON // 300 UNITS', mobileKicker: 'DROP 07 // LIVE', ctaLabel: 'SHOP DROP 07 →', secondaryCta: 'VIEW LOOKBOOK', rotationTitle: 'THE ROTATION', signupTitle: 'GET THE DROP ALERT.' };
for (const [k, v] of Object.entries(OLD)) if (db.settings[k] === v) db.settings[k] = seed.settings[k];
if (db.settings.marquee?.some(m => /DROP 07|REWORKED VINTAGE|300 UNITS/.test(m))) db.settings.marquee = seed.settings.marquee;

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

if (!fs.existsSync(DB_FILE)) save();
