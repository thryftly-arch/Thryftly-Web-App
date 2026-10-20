// The bits that make shopping feel quick and branded, on every page:
//   - slide-out drawer: CART (edit, subtotal, checkout), SAVED (wishlist) and QUICK ADD
//   - card buttons: ♡ save and + QUICK ADD without leaving the grid
//   - bolt-wipe page transitions between internal pages
//   - a cursor ring that swells over anything clickable, magnetic main buttons (mouse only)
import { $, $$, esc, cssUrl, loadSite, money, getCart, setCart, addToCart, getSaved, toggleSaved, productUrl } from './shop.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BOLT = '<path d="M42 4 H88 L66 58 H92 L30 156 L46 90 H16 Z" fill="#FFD84D" stroke="#000" stroke-width="6" stroke-linejoin="round"/>';
let site, inited = false;

export async function init() {
  if (inited) return;
  inited = true;
  site = await loadSite();
  drawer();
  cards();
  transitions();
  cursor();
}

/* ---------------- drawer ---------------- */
let tab = 'cart', quickSlug = null;
const bySlug = slug => site.products.find(p => p.slug === slug);
const colours = p => [...new Set(p.sizes.map(v => v.color).filter(Boolean))];
const shotFor = (p, c) => p.colorImages?.[c] || p.images.front;

function drawer() {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="dr-scrim"></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label="Cart" aria-hidden="true">
      <div class="dr-head">
        <div class="dr-tabs" role="tablist">
          <button role="tab" data-tab="cart">CART [<span class="cart-count">0</span>]</button>
          <button role="tab" data-tab="saved">SAVED [<span class="saved-count">0</span>]</button>
        </div>
        <button class="dr-close" aria-label="Close">✕</button>
      </div>
      <div class="dr-body"></div>
      <div class="dr-foot"></div>
    </aside>`);
  const d = $('.drawer');
  $('.dr-scrim').addEventListener('click', close);
  $('.dr-close', d).addEventListener('click', close);
  addEventListener('keydown', e => { if (e.key === 'Escape' && d.classList.contains('open')) close(); });
  $$('.dr-tabs button', d).forEach(b => b.addEventListener('click', () => open(b.dataset.tab)));
  // Header buttons open the drawer instead of leaving the page (checkout keeps its own cart).
  if (!location.pathname.startsWith('/checkout')) {
    $$('[data-drawer]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); open(a.dataset.drawer); }));
  }
  window.addEventListener('thryftly:drawer', e => open(e.detail || 'cart'));
  window.addEventListener('thryftly:saved', () => d.classList.contains('open') && render());
  d.addEventListener('click', onDrawerClick);
  setCart(getCart()); // refresh both counts
}

export function open(which = 'cart', slug) {
  tab = which;
  if (slug) quickSlug = slug;
  render();
  const d = $('.drawer');
  d.classList.add('open');
  d.setAttribute('aria-hidden', 'false');
  $('.dr-scrim').classList.add('open');
  document.documentElement.classList.add('dr-lock');
  setTimeout(() => $('.dr-close', d).focus({ preventScroll: true }), 50);
}
function close() {
  const d = $('.drawer');
  d.classList.remove('open');
  d.setAttribute('aria-hidden', 'true');
  $('.dr-scrim').classList.remove('open');
  document.documentElement.classList.remove('dr-lock');
}

function render() {
  const d = $('.drawer');
  $$('.dr-tabs button', d).forEach(b => b.classList.toggle('on', b.dataset.tab === tab || (tab === 'quick' && b.dataset.tab === 'cart')));
  const body = $('.dr-body', d), foot = $('.dr-foot', d);
  if (tab === 'quick') return renderQuick(body, foot);
  if (tab === 'saved') {
    const items = getSaved().map(bySlug).filter(Boolean);
    body.innerHTML = items.length ? items.map(p => `
      <div class="dr-line">
        <a class="dr-thumb" href="${productUrl(p)}" style="background-image:${esc(cssUrl(p.images.front))}"></a>
        <div><a class="dr-name" href="${productUrl(p)}">${esc(p.name)}</a><div class="dr-meta">${money(p.price)}</div>
          <div class="dr-acts"><button class="dr-btn" data-quick="${esc(p.slug)}">+ ADD TO CART</button><button class="dr-link" data-unsave="${esc(p.slug)}">REMOVE</button></div></div>
      </div>`).join('') : `<p class="dr-empty">NOTHING SAVED YET.<br>TAP ♡ ON ANY PIECE TO KEEP IT HERE.</p>`;
    foot.innerHTML = `<a class="btn-ghost dr-wide" href="/shop.html">KEEP BROWSING</a>`;
    return;
  }
  const items = getCart().filter(i => bySlug(i.slug));
  let subtotal = 0;
  body.innerHTML = items.length ? items.map((i, n) => {
    const p = bySlug(i.slug), v = p.sizes.find(v => v.label === i.size && (v.color || '') === (i.color || ''));
    const line = (v?.price || p.price) * i.qty;
    subtotal += line;
    return `<div class="dr-line">
      <a class="dr-thumb" href="${productUrl(p)}&c=${encodeURIComponent(i.color || '')}" style="background-image:${esc(cssUrl(shotFor(p, i.color)))}"></a>
      <div><a class="dr-name" href="${productUrl(p)}">${esc(p.name)}</a>
        <div class="dr-meta">${esc([i.color, i.size].filter(Boolean).join(' / '))}</div>
        <div class="dr-acts"><span class="dr-qty"><button data-q="${n}" data-d="-1" aria-label="Less">−</button>${i.qty}<button data-q="${n}" data-d="1" aria-label="More">+</button></span>
          <button class="dr-link" data-rm="${n}">REMOVE</button></div></div>
      <div class="dr-price">${money(line)}</div>
    </div>`;
  }).join('') : `<p class="dr-empty">YOUR CART IS EMPTY.<br>NOTHING CHARGED UP YET ⚡</p>`;
  const free = +site.settings.freeShippingOver || 0;
  const bar = free && items.length ? (() => {
    const left = Math.max(0, free - subtotal), pct = Math.min(100, subtotal / free * 100);
    return `<div class="dr-ship"><span>${left ? `${money(left)} AWAY FROM FREE SHIPPING` : 'FREE SHIPPING UNLOCKED ⚡'}</span><i style="--p:${pct}%"></i></div>`;
  })() : '';
  foot.innerHTML = items.length
    ? `${bar}<div class="dr-total"><span>SUBTOTAL</span><span>${money(subtotal)}</span></div><a class="btn-red dr-wide" href="/checkout.html">CHECKOUT →</a>`
    : `<a class="btn-red dr-wide" href="/shop.html">SHOP THE DROP →</a>`;
}

let qColor = '', qSize = '';
function renderQuick(body, foot) {
  const p = bySlug(quickSlug);
  if (!p) { tab = 'cart'; return render(); }
  const cs = colours(p);
  if (!cs.includes(qColor)) qColor = cs.find(c => p.sizes.some(v => v.color === c && v.available)) || cs[0] || '';
  const vs = p.sizes.filter(v => (v.color || '') === qColor);
  if (!vs.some(v => v.label === qSize && v.available)) qSize = vs.find(v => v.available)?.label || '';
  const v = vs.find(v => v.label === qSize);
  body.innerHTML = `
    <div class="dr-quick">
      <div class="dr-qimg" style="background-image:${esc(cssUrl(shotFor(p, qColor)))}"></div>
      <a class="dr-qname" href="${productUrl(p)}&c=${encodeURIComponent(qColor)}">${esc(p.name)}</a>
      <div class="dr-qprice">${money(v?.price || p.price)}</div>
      ${cs.length ? `<span class="sizes-label">COLOUR — ${esc(qColor)}</span><div class="sizes-row">${cs.map(c => `<button class="size${c === qColor ? ' on' : ''}" data-qc="${esc(c)}" ${p.sizes.some(v => v.color === c && v.available) ? '' : 'disabled'}>${esc(c)}</button>`).join('')}</div>` : ''}
      <span class="sizes-label">SIZE</span>
      <div class="sizes-row">${vs.map(v => `<button class="size${v.label === qSize ? ' on' : ''}" data-qs="${esc(v.label)}" ${v.available ? '' : 'disabled'}>${esc(v.label)}</button>`).join('')}</div>
    </div>`;
  foot.innerHTML = `<button class="btn-red dr-wide dr-add" ${qSize ? '' : 'disabled'}>${qSize ? 'ADD TO CART →' : 'SOLD OUT'}</button>
    <a class="btn-ghost dr-wide" href="${productUrl(p)}&c=${encodeURIComponent(qColor)}">SEE FULL DETAILS</a>`;
}

function onDrawerClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const items = getCart().filter(i => bySlug(i.slug));
  if (b.dataset.q) { const it = items[b.dataset.q]; it.qty = Math.min(5, Math.max(1, it.qty + +b.dataset.d)); setCart(items); render(); }
  else if (b.dataset.rm) { items.splice(+b.dataset.rm, 1); setCart(items); render(); }
  else if (b.dataset.unsave) { toggleSaved(b.dataset.unsave); render(); }
  else if (b.dataset.quick) open('quick', b.dataset.quick);
  else if (b.dataset.qc) { qColor = b.dataset.qc; render(); }
  else if (b.dataset.qs) { qSize = b.dataset.qs; render(); }
  else if (b.classList.contains('dr-add')) {
    addToCart(quickSlug, qSize, qColor);
    pulse();
    open('cart');
  }
}

// Little charge-up on the cart buttons whenever something lands in the cart.
export function pulse() {
  $$('.cart-btn, .cart-sq:not(.saved-sq)').forEach(el => { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); });
}

/* ---------------- card buttons (♡ and quick add) ---------------- */
function cards() {
  document.addEventListener('click', e => {
    const heart = e.target.closest('.pheart');
    const quick = e.target.closest('.pquick');
    if (!heart && !quick) return;
    e.preventDefault(); e.stopPropagation(); // they sit inside the card link
    if (heart) {
      const on = toggleSaved(heart.dataset.slug);
      heart.classList.remove('pop'); void heart.offsetWidth; heart.classList.add('pop');
      if (on) $$('.saved-btn, .saved-sq').forEach(el => { el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); });
    } else {
      // Start the quick add on the colour the card is showing.
      const shown = quick.closest('.pimg')?.querySelector('.pcolour')?.textContent;
      qColor = shown || ''; qSize = '';
      open('quick', quick.dataset.slug);
    }
  }, true);
}

/* ---------------- bolt-wipe page transitions ---------------- */
function transitions() {
  if (reduced) return;
  document.body.insertAdjacentHTML('beforeend', `<div class="wipe" aria-hidden="true"><svg viewBox="-4 -4 112 172">${BOLT}</svg></div>`);
  const wipe = $('.wipe');
  // Arriving from a wipe: start covered, then sweep away.
  let came = false;
  try { came = sessionStorage.getItem('thryftly_wipe') === '1'; sessionStorage.removeItem('thryftly_wipe'); } catch { /* ignore */ }
  if (came) {
    wipe.classList.add('cover');
    // Timers, not rAF: rAF never fires in a background tab and would leave the page covered.
    setTimeout(() => { wipe.classList.remove('cover'); wipe.classList.add('leave'); }, 40);
    setTimeout(() => wipe.classList.remove('leave'), 750);
  }
  addEventListener('pageshow', e => { if (e.persisted) wipe.className = 'wipe'; });
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target === '_blank' || a.hasAttribute('download')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || (u.pathname === location.pathname && u.search === location.search)) return;
    if (u.pathname.startsWith('/admin') || u.pathname.startsWith('/api') || u.pathname.startsWith('/uploads')) return;
    e.preventDefault();
    try { sessionStorage.setItem('thryftly_wipe', '1'); } catch { /* ignore */ }
    wipe.classList.add('enter');
    setTimeout(() => (location.href = u.href), 380);
  });
}

/* ---------------- cursor ring + magnetic buttons ---------------- */
function cursor() {
  if (reduced || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.body.insertAdjacentHTML('beforeend', '<div class="cur" aria-hidden="true"></div>');
  const ring = $('.cur');
  let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY;
    ring.classList.add('on');
    const hot = e.target.closest('a, button, [role="tab"], .ring-stage, .s2-card, input, select, textarea');
    ring.classList.toggle('hot', !!hot && !e.target.closest('input, select, textarea'));
    ring.classList.toggle('hide', !!e.target.closest('input, select, textarea'));
  });
  document.addEventListener('pointerleave', () => ring.classList.remove('on'));
  (function frame() {
    rx += (x - rx) * 0.2; ry += (y - ry) * 0.2;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(frame);
  })();
  // Main call-to-action buttons lean toward the pointer.
  document.addEventListener('pointermove', e => {
    const b = e.target.closest('.btn-red, .cart-btn');
    $$('.btn-red.mag, .cart-btn.mag').forEach(o => { if (o !== b) { o.classList.remove('mag'); o.style.translate = ''; } });
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.classList.add('mag');
    b.style.translate = `${((e.clientX - r.left) / r.width - 0.5) * 8}px ${((e.clientY - r.top) / r.height - 0.5) * 6}px`;
  });
}
