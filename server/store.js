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
    liveLabel: 'DROP 07 LIVE',
    kicker: 'DROP 07 // STATIC SEASON // 300 UNITS',
    mobileKicker: 'DROP 07 // LIVE',
    heroTitle: 'WEAR THE',
    heroAccent: 'VOLTAGE.',
    heroText: "Rescued vintage, reworked by hand and charged for the street. Every piece is a one-off. When it's gone, it's archived.",
    ctaLabel: 'SHOP DROP 07 →',
    secondaryCta: 'VIEW LOOKBOOK',
    countdownLabel: 'NEXT DROP UNLOCKS IN',
    countdownTarget: new Date(Date.now() + (2 * 86400 + 14 * 3600 + 37 * 60) * 1000).toISOString(),
    heroImage: '',
    marquee: ['DROP 07 — STATIC SEASON', 'ONE-OFF REWORKED VINTAGE', '300 UNITS ONLY', 'FREE SHIPPING OVER $150'],
    rotationTitle: 'THE ROTATION',
    signupTitle: 'GET THE DROP ALERT.',
    footerWord: 'THRYFTLY',
    socials: { instagram: '', tiktok: '', discord: '' },
  },
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

export function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

if (!fs.existsSync(DB_FILE)) save();
