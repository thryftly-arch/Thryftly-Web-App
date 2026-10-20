// Shared storefront helpers: API, cart, formatting, safe rendering.
import { setAuthConfig, authOn, signedIn, session, accountApi } from './auth.js';
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Admin-provided URLs are already restricted server-side; this keeps them inert inside CSS url().
export const cssUrl = u => (u ? `url("${encodeURI(u).replace(/"/g, '%22')}")` : '');

export async function api(path, body, headers = {}) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

let site;
export async function loadSite() {
  if (!site) { site = await api('/api/site'); setAuthConfig(site.auth); analytics(site.settings); }
  return site;
}

/* ---------- analytics (GA4 + Meta Pixel, IDs set in Admin → Site content) ---------- */
function analytics({ ga4Id, metaPixelId }) {
  const add = src => document.head.append(Object.assign(document.createElement('script'), { async: true, src }));
  if (/^G-[A-Z0-9]+$/.test(ga4Id || '')) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ga4Id);
    add('https://www.googletagmanager.com/gtag/js?id=' + ga4Id);
  }
  if (/^\d{6,20}$/.test(metaPixelId || '')) {
    const f = window.fbq = function () { f.callMethod ? f.callMethod.apply(f, arguments) : f.queue.push(arguments); };
    window._fbq ||= f; f.push = f; f.loaded = true; f.version = '2.0'; f.queue = [];
    add('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', metaPixelId);
    window.fbq('track', 'PageView');
  }
}
// One call, both tools. items: [{ slug, name, price, qty, size, color }]
const FB = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', sign_up: 'CompleteRegistration' };
export function track(event, { items = [], value, id } = {}) {
  const currency = site?.settings.currency || 'INR';
  value ??= items.reduce((t, i) => t + (i.price || 0) * (i.qty || 1), 0);
  window.gtag?.('event', event, { currency, value, transaction_id: id, items: items.map(i => ({ item_id: i.slug, item_name: i.name, item_variant: [i.color, i.size].filter(Boolean).join(' / '), price: i.price, quantity: i.qty || 1 })) });
  if (FB[event]) window.fbq?.('track', FB[event], { currency, value, content_type: 'product', content_ids: items.map(i => i.slug), num_items: items.reduce((t, i) => t + (i.qty || 1), 0) });
}

// Shopify-style discount links (/discount/CODE → ?discount=CODE): remembered for checkout.
try { const c = new URLSearchParams(location.search).get('discount'); if (c) localStorage.setItem('thryftly_code', c.toUpperCase()); } catch { /* ignore */ }
export const money = n => site.settings.symbol + (Number.isInteger(+n) ? n : (+n).toFixed(2));

/* ---------- cart (localStorage, can be unavailable) ---------- */
const KEY = 'thryftly_cart';
export function getCart() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function setCart(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
  updateCartCount();
}
export function addToCart(slug, size, color = '') {
  const items = getCart();
  const hit = items.find(i => i.slug === slug && i.size === size && (i.color || '') === color);
  // Cap at 5 and let the server enforce real stock.
  hit ? (hit.qty = Math.min(5, hit.qty + 1)) : items.push({ slug, size, color, qty: 1 });
  setCart(items);
  const p = site?.products.find(p => p.slug === slug), v = p?.sizes.find(v => v.label === size && (v.color || '') === color);
  if (p) track('add_to_cart', { items: [{ slug, name: p.name, size, color, price: v?.price || p.price, qty: 1 }] });
}
export function updateCartCount() {
  const n = getCart().reduce((t, i) => t + i.qty, 0);
  $$('.cart-count').forEach(c => (c.textContent = n));
  $$('.saved-count').forEach(c => (c.textContent = getSaved().length));
}

/* ---------- wishlist (this device, synced to the account when signed in) + recently viewed ---------- */
const read = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
export const getSaved = () => read('thryftly_saved');
export const isSaved = slug => getSaved().includes(slug);
export function toggleSaved(slug) {
  const list = getSaved(), on = !list.includes(slug);
  write('thryftly_saved', on ? [slug, ...list] : list.filter(s => s !== slug));
  paintSaved();
  pushSaved();
  return on;
}
function paintSaved() {
  $$('.pheart[data-slug]').forEach(b => { const on = isSaved(b.dataset.slug); b.setAttribute('aria-pressed', on); b.textContent = on ? '♥' : '♡'; });
  updateCartCount();
  window.dispatchEvent(new CustomEvent('thryftly:saved'));
}
let pushT;
function pushSaved() {
  if (!signedIn()) return;
  clearTimeout(pushT);
  pushT = setTimeout(() => accountApi('/wishlist', { method: 'PUT', body: { slugs: getSaved() } }).catch(() => {}), 500);
}
// The first time an account is used on this device, this device's hearts are added to it; after that
// the account's list is the truth (so removing on the phone removes here too). Once per tab session.
let syncing = null;
export function syncSaved(force = false) {
  if (!signedIn()) return Promise.resolve();
  try { if (!force && sessionStorage.getItem('thryftly_saved_sync')) return Promise.resolve(); } catch { /* ignore */ }
  // Overlapping calls (header + account page) share one run, so they can't undo each other's merge.
  return (syncing ??= doSync().finally(() => { syncing = null; }));
}
async function doSync() {
  try {
    const { slugs } = await accountApi('/wishlist');
    const owner = session().email, first = read('thryftly_saved_owner') !== owner;
    const list = first ? [...new Set([...getSaved(), ...slugs])] : slugs;
    write('thryftly_saved', list);
    write('thryftly_saved_owner', owner);
    if (list.length !== slugs.length) await accountApi('/wishlist', { method: 'PUT', body: { slugs: list } });
    try { sessionStorage.setItem('thryftly_saved_sync', '1'); } catch { /* ignore */ }
    paintSaved();
  } catch { /* offline or signed out: keep the device list */ }
}
export const getViewed = () => read('thryftly_viewed');
export const noteViewed = slug => write('thryftly_viewed', [slug, ...getViewed().filter(s => s !== slug)].slice(0, 12));

/* ---------- shared header + footer (every page) ---------- */
const BOLT = '<path d="M42 4 H88 L66 58 H92 L30 156 L46 90 H16 Z" transform="translate(8 8)" fill="#FFD84D" stroke="#000" stroke-width="6" stroke-linejoin="round"/><path d="M42 4 H88 L66 58 H92 L30 156 L46 90 H16 Z" fill="#FF3B3B" stroke="#000" stroke-width="6" stroke-linejoin="round"/>';
const NAV = [['/', 'DROPS'], ['/shop.html', 'SHOP'], ['/about.html', 'ABOUT'], ['/contact.html', 'CONTACT']];

export function mountChrome() {
  const here = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  const header = $('header[data-chrome]');
  if (header) header.innerHTML = `
    <a class="brand" href="/"><svg class="brand-bolt d-only" viewBox="-4 -4 112 172" aria-hidden="true">${BOLT}</svg><span class="wordmark">THRYFTLY</span></a>
    <nav class="nav-links" id="nav-links">${NAV.map(([h, l]) => `<a href="${h}"${h.replace('.html', '') === here ? ' class="on" aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div class="nav-right d-only">
      <span class="live"><span class="live-dot"></span><span data-s="liveLabel"></span></span>
      ${authOn() ? `<a class="acct-btn" href="/account.html">${signedIn() ? 'ACCOUNT' : 'SIGN IN'}</a>` : ''}
      <a class="saved-btn" href="/checkout.html" data-drawer="saved" aria-label="Saved pieces">♡ <span class="saved-count">0</span></a>
      <a class="cart-btn" href="/checkout.html" data-drawer="cart">CART [<span class="cart-count">0</span>]</a>
    </div>
    <div class="nav-mobile m-only">
      ${authOn() ? `<a class="cart-sq saved-sq acct-sq" href="/account.html" aria-label="${signedIn() ? 'Your account' : 'Sign in'}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg></a>` : ''}
      <a class="cart-sq saved-sq" href="/checkout.html" data-drawer="saved" aria-label="Saved pieces">♡</a>
      <a class="cart-sq" href="/checkout.html" data-drawer="cart" aria-label="Cart"><span class="cart-count">0</span></a>
      <button class="burger" aria-label="Menu" aria-controls="nav-links" aria-expanded="false"><span></span><span></span></button>
    </div>`;
  const footer = $('footer[data-chrome]');
  if (footer) footer.innerHTML = `
    <div class="footer-top">
      <form class="signup">
        <span class="signup-h" data-s="signupTitle"></span>
        <div class="signup-box"><input type="email" placeholder="your@email.com" aria-label="Email" required><button type="submit">SUBSCRIBE</button></div>
      </form>
      <div class="footer-cols">
        <div><a href="/shop.html">SHOP ALL</a><a href="/">DROPS</a><a href="/about.html">ABOUT</a><a href="/track.html">TRACK ORDER</a>${authOn() ? '<a href="/account.html">MY ACCOUNT</a>' : ''}</div>
        <div><a href="#" data-social="instagram" target="_blank" rel="noopener">INSTAGRAM</a><a href="#" data-social="tiktok" target="_blank" rel="noopener">TIKTOK</a><a href="#" data-social="discord" target="_blank" rel="noopener">DISCORD</a></div>
        <div><a href="/policy.html?p=shipping">SHIPPING</a><a href="/policy.html?p=returns">RETURNS</a><a href="/policy.html?p=privacy">PRIVACY</a><a href="/policy.html?p=terms">TERMS</a><a href="/contact.html">CONTACT</a></div>
      </div>
    </div>
    <div class="footer-word-wrap"><div class="footer-word" data-s="footerWord"></div></div>
    <p class="footer-credits">3D garments: <a href="https://sketchfab.com/3d-models/t-shirt-c1a3e5eb9b5445f4b7d4be82f1127eba" target="_blank" rel="noopener">“T Shirt” by funlab117</a> ·
      <a href="https://sketchfab.com/3d-models/oversized-hoodie-4f687fc4c4714de2a721e1aab2020fc8" target="_blank" rel="noopener">“Oversized hoodie” by Mug</a> ·
      <a href="https://sketchfab.com/3d-models/sweatshirt-7c442e696c96455d848d964e79e29464" target="_blank" rel="noopener">“SWEATSHIRT” by CONCEAL</a> —
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, simplified and recoloured.</p>`;

  const burger = $('.burger');
  burger?.addEventListener('click', () => burger.setAttribute('aria-expanded', $('#nav-links').classList.toggle('open')));
  $$('#nav-links a').forEach(a => a.addEventListener('click', () => { $('#nav-links').classList.remove('open'); burger?.setAttribute('aria-expanded', 'false'); }));

  const form = $('.signup');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', form), input = $('input', form);
    btn.disabled = true;
    try {
      await api('/api/subscribe', { email: input.value });
      input.value = ''; input.placeholder = "YOU'RE ON THE LIST ⚡";
    } catch (err) {
      input.setCustomValidity(err.message); input.reportValidity(); input.setCustomValidity('');
    }
    btn.disabled = false;
  });
  syncSaved();
  // Cart drawer, quick add, page transitions and the cursor ring: loaded once the header exists.
  import('./extras.js').then(m => m.init());
}

/* ---------- product card (home grid + shop page) ---------- */
const sizeRange = p => {
  const sizes = [...new Set(p.sizes.filter(z => z.available).map(z => z.label))];
  return sizes.length > 3 ? `${sizes[0]}–${sizes.at(-1)}` : sizes.join('/') || 'SOLD OUT';
};
const colorLine = p => {
  const cs = [...new Set(p.sizes.map(z => z.color).filter(Boolean))];
  return cs.length > 1 ? `${cs.length} COLOURS` : cs[0] || p.color;
};
// How a category reads on the site (the data keeps the short code).
const CAT_LABEL = { TEES: 'T-SHIRTS' };
export const catLabel = c => CAT_LABEL[c] || c;

// Every .countdown[data-target] ticks down to its own date.
export function startCountdowns() {
  const pad = n => String(n).padStart(2, '0');
  const tick = () => $$('.countdown[data-target]').forEach(el => {
    const t = Math.max(0, Math.floor((Date.parse(el.dataset.target) - Date.now()) / 1000));
    el.textContent = [Math.floor(t / 86400), Math.floor(t % 86400 / 3600), Math.floor(t % 3600 / 60), t % 60].map(pad).join(':');
  });
  tick();
  setInterval(tick, 1000);
}
// A live drop counts down to its opening, or to its end once open.
export const dropClock = d => {
  const opens = d.startsAt && Date.parse(d.startsAt) > Date.now();
  return opens ? { label: 'UNLOCKS IN', target: d.startsAt } : d.endsAt ? { label: 'ENDS IN', target: d.endsAt } : null;
};

export const productUrl = p => `/product.html?p=${encodeURIComponent(p.slug)}`;
export function productCard(p, i) {
  const soldOut = !p.sizes.some(z => z.available);
  const tag = p.unlocksAt ? '<span class="tag tag-yel">DROPS SOON</span>' : soldOut ? '<span class="tag tag-red">SOLD OUT</span>' : p.badge ? `<span class="tag tag-${p.badgeStyle === 'red' ? 'red' : 'yel'}">${esc(p.badge)}</span>` : '';
  // One slide per colour (its front photo), so shoppers can flick through colours on the card.
  const colours = [...new Set(p.sizes.map(z => z.color).filter(Boolean))].filter(c => p.colorImages?.[c]);
  const slides = colours.length > 1 ? colours.map(c => ({ c, src: p.colorImages[c] })) : p.images.front ? [{ c: colours[0] || '', src: p.images.front }] : [];
  const media = !slides.length ? '[ product shot ]' : `
      <div class="pslides">${slides.map((s, k) => `<img src="${esc(s.src)}" alt="${esc(p.name)}${s.c ? ' — ' + esc(s.c) : ''}" data-c="${esc(s.c)}" ${k ? 'loading="lazy"' : 'loading="lazy" decoding="async"'} draggable="false">`).join('')}</div>
      ${slides.length > 1 ? `<button class="pnav pprev" type="button" aria-label="Previous colour" tabindex="-1">‹</button><button class="pnav pnext" type="button" aria-label="Next colour" tabindex="-1">›</button>
      <div class="pdots">${slides.map((_, k) => `<i${k ? '' : ' class="on"'}></i>`).join('')}</div><span class="pcolour">${esc(slides[0].c)}</span>` : ''}`;
  const saved = isSaved(p.slug);
  const buyable = !soldOut && !p.unlocksAt;
  return `<div class="pwrap"><a class="pcard ${i % 2 ? 'sh-yel' : 'sh-red'}" href="${productUrl(p)}">
    <div class="pimg${slides.length ? ' has-img' : ''}">${media}${tag}
      <button class="pheart" type="button" data-slug="${esc(p.slug)}" aria-pressed="${saved}" aria-label="Save ${esc(p.name)}">${saved ? '♥' : '♡'}</button>
      ${buyable ? `<button class="pquick" type="button" data-slug="${esc(p.slug)}">+ QUICK ADD</button>` : ''}</div>
    <div class="pinfo"><span class="pname">${esc(p.name)}${p.edition ? ' ' + esc(p.edition.replace('/', '/ ')) : ''}</span>
    <div class="pmeta"><span>${esc([sizeRange(p), colorLine(p)].filter(Boolean).join(' · '))}</span><span>${money(p.price)}</span></div></div>
  </a></div>`;
}

// Card colour sliders (one handler for every card on the page, however it was rendered).
// Arrows scroll a card's photos; the scroll position picks the dot, the colour label and the
// colour the card opens the product in.
function slidesOf(el) { return el.closest('.pimg')?.querySelector('.pslides'); }
document.addEventListener('click', e => {
  const btn = e.target.closest('.pnav');
  if (!btn) return;
  e.preventDefault(); e.stopPropagation();
  const box = slidesOf(btn);
  box.scrollBy({ left: (btn.classList.contains('pnext') ? 1 : -1) * box.clientWidth, behavior: 'smooth' });
}, true);
document.addEventListener('scroll', e => {
  const box = e.target;
  if (!(box instanceof Element) || !box.classList.contains('pslides')) return;
  const k = Math.round(box.scrollLeft / box.clientWidth), img = box.children[k];
  if (!img) return;
  const pimg = box.closest('.pimg');
  pimg.querySelectorAll('.pdots i').forEach((d, j) => d.classList.toggle('on', j === k));
  const label = pimg.querySelector('.pcolour');
  if (label) label.textContent = img.dataset.c;
  const a = box.closest('a');
  const u = new URL(a.href, location.origin);
  img.dataset.c ? u.searchParams.set('c', img.dataset.c) : u.searchParams.delete('c');
  a.href = u.pathname + u.search;
}, true);

// Plain admin text → paragraphs. Blank line = new paragraph, "- " lines = list.
export function richText(t) {
  return String(t || '').trim().split(/\n\s*\n/).map(block => {
    const lines = block.split('\n');
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) return `<ul>${lines.map(l => `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`).join('')}</ul>`;
    if (/^#\s/.test(lines[0])) return `<h2>${esc(lines[0].slice(2))}</h2>${lines.length > 1 ? `<p>${lines.slice(1).map(esc).join('<br>')}</p>` : ''}`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');
}

/* ---------- settings → page ---------- */
export function bindSettings(s) {
  // Header "live" marker only exists while a drop is on.
  const drop = site?.drops?.[0];
  $$('.live').forEach(el => {
    el.hidden = !drop;
    if (!drop) return;
    const soon = drop.startsAt && Date.parse(drop.startsAt) > Date.now();
    el.innerHTML = `<span class="live-dot"></span>${esc(drop.name)} ${soon ? 'SOON' : 'LIVE'}`;
    el.onclick = () => (location.href = `/#drop-${drop.id}`);
  });
  $$('[data-s]').forEach(el => { if (s[el.dataset.s] != null) el.textContent = s[el.dataset.s]; });
  $$('[data-social]').forEach(a => {
    const u = s.socials?.[a.dataset.social];
    if (u && /^https:\/\//.test(u)) a.href = u; else a.removeAttribute('target');
  });
  updateCartCount();
}
