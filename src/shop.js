// Shared storefront helpers: API, cart, formatting, safe rendering.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Admin-provided URLs are already restricted server-side; this keeps them inert inside CSS url().
export const cssUrl = u => (u ? `url("${encodeURI(u).replace(/"/g, '%22')}")` : '');

export async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

let site;
export const loadSite = async () => (site ??= await api('/api/site'));
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
}
export function updateCartCount() {
  const n = getCart().reduce((t, i) => t + i.qty, 0);
  $$('.cart-count').forEach(c => (c.textContent = n));
}

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
      <a class="cart-btn" href="/checkout.html">CART [<span class="cart-count">0</span>]</a>
    </div>
    <div class="nav-mobile m-only">
      <a class="cart-sq" href="/checkout.html" aria-label="Cart"><span class="cart-count">0</span></a>
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
        <div><a href="/shop.html">SHOP ALL</a><a href="/">DROPS</a><a href="/about.html">ABOUT</a><a href="/track.html">TRACK ORDER</a></div>
        <div><a href="#" data-social="instagram" target="_blank" rel="noopener">INSTAGRAM</a><a href="#" data-social="tiktok" target="_blank" rel="noopener">TIKTOK</a><a href="#" data-social="discord" target="_blank" rel="noopener">DISCORD</a></div>
        <div><a href="/policy.html?p=shipping">SHIPPING</a><a href="/policy.html?p=returns">RETURNS</a><a href="/policy.html?p=privacy">PRIVACY</a><a href="/policy.html?p=terms">TERMS</a><a href="/contact.html">CONTACT</a></div>
      </div>
    </div>
    <div class="footer-word-wrap"><div class="footer-word" data-s="footerWord"></div></div>`;

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
  const img = p.images.front ? `<img src="${esc(p.images.front)}" alt="${esc(p.name)}" loading="lazy" decoding="async">` : '[ product shot ]';
  return `<div class="pwrap"><a class="pcard ${i % 2 ? 'sh-yel' : 'sh-red'}" href="${productUrl(p)}">
    <div class="pimg${p.images.front ? ' has-img' : ''}">${img}${tag}</div>
    <div class="pinfo"><span class="pname">${esc(p.name)}${p.edition ? ' ' + esc(p.edition.replace('/', '/ ')) : ''}</span>
    <div class="pmeta"><span>${esc([sizeRange(p), colorLine(p)].filter(Boolean).join(' · '))}</span><span>${money(p.price)}</span></div></div>
  </a></div>`;
}

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
