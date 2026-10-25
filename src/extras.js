// The bits that make shopping feel quick and branded, on every page:
//   - slide-out drawer: CART (edit, subtotal, checkout), SAVED (wishlist) and QUICK ADD
//   - card buttons: ♡ save and + QUICK ADD without leaving the grid
//   - bolt-wipe page transitions between internal pages
//   - a cursor ring that swells over anything clickable, magnetic main buttons (mouse only)
//   - search overlay with instant results, floating WhatsApp button, first-visit sign-up popup
import { $, $$, esc, cssUrl, api, loadSite, money, getCart, setCart, addToCart, getSaved, toggleSaved, productUrl, getCode, setCode, offerText, quoteCart, catLabel, track } from './shop.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const BOLT = '<path d="M42 4 H88 L66 58 H92 L30 156 L46 90 H16 Z" fill="#FFD84D" stroke="#000" stroke-width="6" stroke-linejoin="round"/>';
let site, inited = false;

export async function init() {
  if (inited) return;
  inited = true;
  site = await loadSite();
  drawer();
  cards();
  search();
  whatsapp();
  popup();
  transitions();
  cursor();
}

/* ---------------- search overlay ---------------- */
// Instant results from the catalogue already in the page (no extra requests). Enter opens Shop all with the query.
function search() {
  document.body.insertAdjacentHTML('beforeend', `
    <div class="srch" role="dialog" aria-modal="true" aria-label="Search" hidden>
      <form class="srch-bar" action="/shop.html"><input name="q" type="search" placeholder="SEARCH HOODIES, TEES, COLOURS…" autocomplete="off" aria-label="Search products"><button type="button" class="srch-x" aria-label="Close search">✕</button></form>
      <div class="srch-body"></div>
    </div>`);
  const box = $('.srch'), input = $('input', box), body = $('.srch-body', box);
  const cats = [...new Set(site.products.map(p => p.category))];
  const words = p => `${p.name} ${catLabel(p.category)} ${p.category} ${p.tag} ${p.description} ${p.sizes.map(s => s.color).join(' ')}`.toLowerCase();
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      body.innerHTML = `<span class="srch-h">BROWSE</span><div class="srch-cats">${cats.map(c => `<a class="chip" href="/shop.html?c=${encodeURIComponent(c)}">${esc(catLabel(c))}</a>`).join('')}</div>`;
      return;
    }
    const terms = q.split(/\s+/), hits = site.products.filter(p => terms.every(t => words(p).includes(t))).slice(0, 8);
    body.innerHTML = hits.length
      ? `<span class="srch-h">${hits.length} RESULT${hits.length === 1 ? '' : 'S'}</span><div class="srch-list">${hits.map(p => `<a class="srch-item" href="${productUrl(p)}"><span class="srch-img" style="background-image:${esc(cssUrl(p.images.front || Object.values(p.colorImages || {})[0]))}"></span><span><b>${esc(p.name)}</b><small>${esc(catLabel(p.category))} · ${money(p.price)}</small></span></a>`).join('')}</div>
        <a class="btn-ghost srch-all" href="/shop.html?q=${encodeURIComponent(input.value.trim())}">SEE ALL RESULTS →</a>`
      : `<p class="srch-none">NOTHING FOR “${esc(input.value.trim())}”. TRY A COLOUR OR “HOODIE”.</p>`;
  };
  let last = null;
  const show = () => { last = document.activeElement; box.hidden = false; document.documentElement.classList.add('dr-lock'); draw(); setTimeout(() => input.focus(), 30); };
  const hide = () => { box.hidden = true; document.documentElement.classList.remove('dr-lock'); last?.focus?.(); };
  $$('[data-search]').forEach(b => b.addEventListener('click', show));
  $('.srch-x', box).addEventListener('click', hide);
  box.addEventListener('click', e => { if (e.target === box) hide(); });
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !box.hidden) hide();
    // "/" opens search from anywhere that isn't a text field.
    if (e.key === '/' && box.hidden && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); show(); }
  });
  let t;
  input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(draw, 80); });
  $('.srch-bar', box).addEventListener('submit', () => track('search', {}));
}

/* ---------------- floating WhatsApp button ---------------- */
function whatsapp() {
  const s = site.settings, wa = String(s.contact?.whatsapp || '').replace(/\D/g, '');
  if (!s.whatsappButton || wa.length < 10 || location.pathname.startsWith('/checkout')) return;
  const num = wa.length === 10 ? '91' + wa : wa;
  const text = location.pathname.startsWith('/product') ? `Hi THRYFTLY! I have a question about ${document.title.split(' — ')[0]}: ${location.href}` : 'Hi THRYFTLY! I have a question.';
  document.body.insertAdjacentHTML('beforeend', `<a class="wa-fab" href="https://wa.me/${num}?text=${encodeURIComponent(text)}" target="_blank" rel="noopener" aria-label="Chat with us on WhatsApp">
    <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M16 3a13 13 0 0 0-11.2 19.6L3 29l6.6-1.7A13 13 0 1 0 16 3Zm0 23.6c-2 0-4-.6-5.7-1.6l-.4-.2-3.9 1 1-3.8-.3-.4A10.6 10.6 0 1 1 16 26.6Zm5.8-7.9c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2l-1 1.2c-.2.2-.4.2-.7.1a8.7 8.7 0 0 1-4.3-3.8c-.3-.5.3-.5.9-1.6.1-.2 0-.4 0-.5l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.1 1.1-1.1 2.7s1.2 3.2 1.3 3.4c.2.2 2.3 3.5 5.6 4.9 2.1.9 2.9 1 3.9.8.6-.1 1.9-.8 2.2-1.5.3-.8.3-1.4.2-1.5l-.9-.4Z"/></svg></a>`);
}

/* ---------------- first-visit sign-up popup ---------------- */
// Once per visitor (remembered on this device), after the delay set in admin, never on checkout or account.
function popup() {
  const s = site.settings;
  if (!s.popupOn || /^\/(checkout|account|admin|exchange|invoice)/.test(location.pathname)) return;
  try { if (localStorage.getItem('thryftly_popup')) return; } catch { return; }
  const seen = () => { try { localStorage.setItem('thryftly_popup', String(Date.now())); } catch { /* ignore */ } };
  setTimeout(() => {
    if ($('.drawer.open') || !$('.srch')?.hidden) return; // busy: try on a later page
    document.body.insertAdjacentHTML('beforeend', `<dialog class="pop" aria-label="Join the drop list">
      <button type="button" class="pop-x" aria-label="Close">✕</button>
      <span class="kicker">THE DROP LIST</span>
      <h2 class="pop-h">${esc(s.popupTitle)}</h2><p class="pop-p">${esc(s.popupText)}</p>
      <form class="pop-form"><input type="email" name="email" placeholder="your@email.com" aria-label="Email" required><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="btn-red">JOIN →</button></form>
      <p class="co-msg" aria-live="polite"></p></dialog>`);
    const d = $('.pop');
    d.showModal(); seen();
    const close = () => { d.close(); d.remove(); };
    $('.pop-x', d).addEventListener('click', close);
    d.addEventListener('click', e => { if (e.target === d) close(); });
    $('.pop-form', d).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target, btn = $('button', f);
      btn.disabled = true;
      try {
        await api('/api/subscribe', { email: f.email.value, website: f.website.value });
        track('sign_up', {});
        f.hidden = true;
        $('.co-msg', d).innerHTML = s.welcomeCode ? `YOU'RE IN ⚡ YOUR CODE: <b class="pop-code">${esc(s.welcomeCode)}</b> (ALSO IN YOUR INBOX)` : "YOU'RE ON THE LIST ⚡";
        if (s.welcomeCode) setCode(s.welcomeCode);
      } catch (err) { $('.co-msg', d).textContent = err.message; $('.co-msg', d).classList.add('err'); btn.disabled = false; }
    });
  }, Math.max(2, +s.popupDelay || 8) * 1000);
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
  // A code applied from the offer strip opens the cart so the shopper sees it work.
  window.addEventListener('thryftly:code', () => { if (d.classList.contains('open')) render(); else if (getCode() && getCart().length && !location.pathname.startsWith('/checkout')) open('cart'); });
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
  const code = getCode(), offers = site.offers || [];
  foot.innerHTML = items.length
    ? `${bar}
      ${offers.length ? `<div class="dr-offers">${offers.map(o => `<button class="dr-offer${o.code === code ? ' on' : ''}" data-code="${esc(o.code)}"><b>${esc(o.code)}</b><span>${esc(offerText(o))}</span></button>`).join('')}</div>` : ''}
      <form class="dr-code"><input name="code" placeholder="Discount code" value="${esc(code)}" autocomplete="off" aria-label="Discount code"><button class="dr-btn">${code ? 'CHANGE' : 'APPLY'}</button></form>
      <p class="dr-msg" aria-live="polite"></p>
      <div class="dr-sum"><span>SUBTOTAL</span><span>${money(subtotal)}</span></div>
      <a class="btn-red dr-wide" href="/checkout.html">CHECKOUT →</a>`
    : `<a class="btn-red dr-wide" href="/shop.html">SHOP THE DROP →</a>`;
  if (items.length) priceIt(items, code);
}

// The server prices the cart (discount, shipping), so the drawer shows exactly what checkout will.
let quoteSeq = 0;
async function priceIt(items, code) {
  const seq = ++quoteSeq, foot = $('.drawer .dr-foot');
  try {
    const q = await quoteCart(items, code);
    if (seq !== quoteSeq) return;
    if (q.discountError) { setCode(''); $('.dr-msg', foot).textContent = q.discountError; $('.dr-msg', foot).classList.add('err'); }
    $('.dr-sum', foot).innerHTML = `<span>SUBTOTAL</span><span>${money(q.subtotal)}</span>
      ${q.discount ? `<span class="dr-disc">${esc(q.discount.code)}${q.discount.freeShipping ? ' (FREE SHIPPING)' : ''} <button class="dr-x" data-uncode aria-label="Remove code">✕</button></span><span class="dr-disc">${q.discount.amount ? '−' + money(q.discount.amount) : '✓'}</span>` : ''}
      <span>SHIPPING</span><span>${q.shipping ? money(q.shipping) : 'FREE'}</span>
      <span class="tot">TOTAL</span><span class="tot">${money(q.amount)}</span>`;
    if (q.discount?.amount) { $('.dr-msg', foot).textContent = `YOU SAVE ${money(q.discount.amount)} ⚡`; $('.dr-msg', foot).classList.remove('err'); }
  } catch (e) {
    if (seq === quoteSeq) $('.dr-msg', foot).textContent = e.message;
  }
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
  if (b.dataset.code) { setCode(b.dataset.code === getCode() ? '' : b.dataset.code); return render(); }
  if ('uncode' in b.dataset) { setCode(''); return render(); }
  if (b.closest('.dr-code')) { e.preventDefault(); setCode($('.dr-code input').value.trim()); return render(); }
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
