import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { $, $$, esc, cssUrl, loadSite, money, bindSettings, addToCart, mountChrome, productCard, productUrl, catLabel, startCountdowns, dropClock, isSaved, toggleSaved, getViewed, noteViewed, track } from './shop.js';

gsap.registerPlugin(ScrollTrigger);

// Higher = more lag/smoothing between scroll and animation.
const SCRUB = 1.5;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isHome = !!$('.hero');
const isProduct = !!$('.pdp');

/* ---------- Extruded 3D bolt: stacked SVG layers ---------- */
const BOLT = 'M42 4 H88 L66 58 H92 L30 156 L46 90 H16 Z';
$$('.bolt3d').forEach(el => {
  const d = +el.dataset.depth;
  let html = '';
  for (let z = -d; z <= 0; z += 2) {
    const edge = z === -d || z === 0;
    const fill = edge ? '#FF3B3B' : z === -d + 2 || z === -2 ? '#000' : z === -d + 4 || z === -4 ? '#F2C93B' : '#FFD84D';
    const stroke = edge ? ' stroke="#000" stroke-width="4" stroke-linejoin="round"' : '';
    html += `<svg viewBox="-4 -4 108 168" style="transform:translateZ(${z}px)"><path d="${BOLT}" fill="${fill}"${stroke}/></svg>`;
  }
  el.innerHTML = html;
});

/* ---------- Data ---------- */
let site;
try {
  site = await loadSite();
} catch {
  document.body.insertAdjacentHTML('afterbegin', '<div class="site-error">The shop is offline right now. Try again in a minute.</div>');
  throw new Error('site data unavailable');
}
mountChrome();
bindSettings(site.settings);
const url = productUrl;
const imgStyle = u => (u ? ` style="background-image:${esc(cssUrl(u))}"` : '');

/* ---------- Home render ---------- */
if (isHome) {
  const { settings: s, products, drops } = site;
  const bySlug = Object.fromEntries(products.map(p => [p.slug, p]));
  if (s.heroImage) $('.bolt-float').innerHTML = `<img class="hero-img" src="${esc(s.heroImage)}" alt="">`;

  // Hero: a live drop takes over the kicker, button and countdown; otherwise the plain copy shows.
  const drop = drops[0];
  if (drop) {
    $$('.kicker, .m-kicker').forEach(el => (el.textContent = [drop.name, drop.tagline].filter(Boolean).join(' // ')));
    $$('.hero-cta').forEach(a => { a.textContent = `SHOP ${drop.name} →`; a.href = `#drop-${drop.id}`; });
    const clock = dropClock(drop);
    if (clock) {
      $$('.hero-count-label').forEach(el => (el.textContent = `${drop.name} ${clock.label}`));
      $$('.hero-count').forEach(el => (el.dataset.target = clock.target));
      $$('.countdown-block, .m-countdown').forEach(el => (el.hidden = false));
    }
  }

  const run = [...(drop ? [`${drop.name} — ${drop.tagline || 'OUT NOW'}`] : []), ...s.marquee].map(m => `<span>${esc(m)}</span><span class="sl">///</span>`).join('');
  $('.marquee-track').innerHTML = run + run.replace(/<span/g, '<span aria-hidden="true"');

  // Special drops: one section each.
  $('#drops').innerHTML = drops.map(d => {
    const clock = dropClock(d);
    const items = d.products.map(slug => bySlug[slug]).filter(Boolean);
    return `<section class="drop-sec" id="drop-${esc(d.id)}">
      ${d.banner ? `<div class="drop-bg" style="background-image:${esc(cssUrl(d.banner))}"></div>` : ''}
      <div class="drop-head">
        <div class="drop-title"><span class="drop-kicker">SPECIAL DROP${d.tagline ? ' // ' + esc(d.tagline) : ''}</span><h2 class="drop-name">${esc(d.name)}</h2></div>
        <div class="drop-side">${d.description ? `<p>${esc(d.description)}</p>` : ''}
          ${clock ? `<div class="drop-clock"><span>${clock.label}</span><span class="countdown" data-target="${esc(clock.target)}"></span></div>` : ''}</div>
      </div>
      <div class="grid drop-grid">${items.map(productCard).join('')}</div>
    </section>`;
  }).join('');

  // The line-up: one section per category, biggest first.
  const cats = Object.entries(products.reduce((m, p) => ((m[p.category] ||= []).push(p), m), {})).sort((a, b) => b[1].length - a[1].length);
  $('.shop-all').textContent = `SHOP ALL ${products.length} →`;
  $('.cat-secs').innerHTML = cats.map(([c, list]) => `
    <div class="cat-sec">
      <div class="cat-head"><h3 class="cat-h">${esc(catLabel(c))} <span>${list.length}</span></h3>
        <a class="cat-all" href="/shop.html?c=${encodeURIComponent(c)}">VIEW ALL ${esc(catLabel(c))} →</a></div>
      <div class="grid cat-grid">${list.filter(p => p.featured).concat(list.filter(p => !p.featured)).slice(0, 4).map(productCard).join('')}</div>
    </div>`).join('');

  const featured = products.filter(p => p.featured).slice(0, 8);
  $('.m-strip').innerHTML = featured.map((p, i) => `
    <a class="m-card${i < 2 ? (i ? ' sh-yel' : ' sh-red') : ''}" href="${url(p)}">
      <div class="m-card-img"${imgStyle(p.images.front)}></div><div class="m-card-t">${esc(p.name)} · ${money(p.price)}</div></a>`).join('');
}
startCountdowns();

/* ---------- Product render ---------- */
let product, currentShots = { front: '', back: '' };
if (isProduct) {
  const slug = new URLSearchParams(location.search).get('p');
  product = site.products.find(p => p.slug === slug) || site.products[0];
  if (!product) location.replace('/');
  const p = product;
  document.title = `${p.name}${p.edition ? ' ' + p.edition : ''} — THRYFTLY`;
  const [first, ...rest] = p.name.split(' ');
  $$('.p-name').forEach(e => (e.textContent = p.name));
  $('.p-category').textContent = p.category;
  $('.p-h1a').textContent = first;
  $('.p-h1b').textContent = rest.join(' ');
  $('.p-edition').textContent = p.edition;
  $('.p-price').textContent = money(p.price);
  $('.p-desc').textContent = p.description;
  $('.p-fit').textContent = p.fitLabel;
  if (!p.fitLabel) $('.sizes-label').textContent = 'SIZE';
  $('.p-tag').textContent = p.tag;
  $('.p-tag').hidden = !p.tag;
  const badge = $('.p-badge');
  badge.textContent = p.badge;
  badge.hidden = !p.badge;
  badge.classList.add(p.badgeStyle === 'red' ? 'tag-red' : 'tag-yel');
  $('.specs').innerHTML = p.specs.map(s => `<span>${esc(s.k)}</span><span>${esc(s.v)}</span>`).join('');
  track('view_item', { items: [{ slug: p.slug, name: p.name, price: p.price }] });

  // Size chart for this kind of garment (Admin → Size charts), in a dialog.
  if (p.sizeChart) {
    $('.sizes .sizes-label').insertAdjacentHTML('afterend', '<button type="button" class="chart-btn">SIZE CHART</button>');
    document.body.insertAdjacentHTML('beforeend', `<dialog class="chart-dlg" aria-label="Size chart"><div class="chart-head"><b>${esc(p.sizeChart.title)} — SIZE CHART</b><button type="button" class="chart-x" aria-label="Close">✕</button></div>
      ${p.sizeChart.image ? `<img src="${esc(p.sizeChart.image)}" alt="Size chart for ${esc(p.sizeChart.title)}">` : ''}${p.sizeChart.note ? `<p class="chart-note">${esc(p.sizeChart.note)}</p>` : ''}</dialog>`);
    const dlg = $('.chart-dlg');
    $('.chart-btn').addEventListener('click', () => dlg.showModal());
    $('.chart-x').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  }

  // Variants are colour × size. Colour buttons only appear when a product has colours.
  const colors = [...new Set(p.sizes.map(v => v.color).filter(Boolean))];
  // ?c=COLOUR (from a product card the shopper swiped to that colour) opens on that colour.
  const askedColor = (new URLSearchParams(location.search).get('c') || '').toUpperCase();
  let color = colors.includes(askedColor) ? askedColor : colors.find(c => p.sizes.some(v => v.color === c && v.available)) ?? colors[0] ?? '';
  let size;
  const add = $('.add-cart');
  function face(el, u, label) {
    el.style.backgroundImage = u ? cssUrl(u) : '';
    el.classList.toggle('has-img', !!u);
    el.querySelector('.tt-ph').textContent = `[ ${p.name.toLowerCase()} — ${label} ]`;
  }
  if (colors.length) $('.sizes').insertAdjacentHTML('beforebegin', '<div class="sizes colors"><span class="sizes-label">COLOUR — <span class="p-color"></span></span><div class="sizes-row colors-row"></div></div>');

  // Front + back photos for the selected colour. A colour without its own back photo gets a
  // plain back (3D) rather than another colour's print.
  const shots = () => ({
    front: p.colorImages?.[color] || p.images.front,
    back: colors.length ? p.colorBacks?.[color] || '' : p.images.back,
  });
  let shown = '';
  function showShots() {
    const { front, back } = shots();
    if (shown === front + back) return;
    shown = front + back;
    currentShots = { front, back };
    face($('.tt-front'), front, 'front');
    face($('.tt-back'), back, 'back');
    window.dispatchEvent(new CustomEvent('thryftly:shots', { detail: { front, back } }));
  }

  function drawVariants() {
    const vs = p.sizes.filter(v => (v.color || '') === color);
    if (!vs.some(v => v.label === size && v.available)) size = vs.find(v => v.available)?.label;
    if (colors.length) {
      $('.p-color').textContent = color;
      $('.colors-row').innerHTML = colors.map(c => `<button class="size${c === color ? ' on' : ''}" aria-pressed="${c === color}" ${p.sizes.some(v => v.color === c && v.available) ? '' : 'disabled'}>${esc(c)}</button>`).join('');
      $$('.colors-row .size').forEach(b => b.addEventListener('click', () => { color = b.textContent; drawVariants(); }));
    }
    $('.sizes:not(.colors) .sizes-row').innerHTML = vs.map(v =>
      `<button class="size${v.label === size ? ' on' : ''}" ${v.available ? '' : 'disabled'} aria-pressed="${v.label === size}">${esc(v.label)}</button>`).join('');
    $$('.sizes:not(.colors) .size').forEach(b => b.addEventListener('click', () => { size = b.textContent; drawVariants(); }));
    // Variants can cost more (e.g. 3XL) and each colour can have its own mockup.
    const v = vs.find(v => v.label === size);
    $('.p-price').textContent = money(v?.price || p.price);
    showShots();
    add.disabled = !size || !!p.unlocksAt;
    if (p.unlocksAt) add.textContent = `DROPS ${new Date(p.unlocksAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).toUpperCase()}`;
    else if (!size) add.textContent = 'SOLD OUT';
    else if (add.textContent === 'SOLD OUT') add.textContent = 'ADD TO CART →';
  }
  drawVariants();

  add.addEventListener('click', async () => {
    addToCart(p.slug, size, color);
    gsap.fromTo('.cart-btn', { rotationY: 0 }, { rotationY: 360, transformPerspective: 400, duration: 0.6, ease: 'power2.out' });
    (await import('./extras.js')).pulse();
    window.dispatchEvent(new CustomEvent('thryftly:drawer', { detail: 'cart' }));
  });


  // ♡ saves to the wishlist (shared with the cards and the drawer's SAVED tab).
  const fav = $('.fav');
  const showFav = () => { const on = isSaved(p.slug); fav.setAttribute('aria-pressed', on); fav.textContent = on ? '♥' : '♡'; };
  showFav();
  fav.addEventListener('click', () => { toggleSaved(p.slug); showFav(); });
  window.addEventListener('thryftly:saved', showFav);

  // Recently viewed: what this shopper looked at before (this device), newest first.
  const seen = getViewed().filter(s => s !== p.slug).map(s => site.products.find(o => o.slug === s)).filter(Boolean).slice(0, 4);
  noteViewed(p.slug);
  if (seen.length) { $('.viewed-grid').innerHTML = seen.map(productCard).join(''); $('.viewed').hidden = false; }

  $('.p-cat-link').href = `/shop.html?c=${encodeURIComponent(p.category)}`;
  const related = site.products.filter(o => o.slug !== p.slug && o.category === p.category).slice(0, 4);
  if (related.length) { $('.related-grid').innerHTML = related.map(productCard).join(''); $('.related').hidden = false; }

  $('.tryon-open').addEventListener('click', async () => (await import('./tryon.js')).openTryon(p));
}

/* ---------- Drag-to-spin helper (ring + turntable) ---------- */
// Returns a live state object; angle = auto spin + drag + scroll offset.
function spinner(stage, target, { speed, base = '', sens = 0.4, apply }) {
  apply ||= a => (target.style.transform = `${base} rotateY(${a}deg)`);
  const s = { auto: 0, drag: 0, scroll: 0, paused: false };
  let lastX = null, moved = 0, last = performance.now();
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    lastX = e.clientX; moved = 0;
  });
  stage.addEventListener('pointermove', e => {
    if (lastX === null) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX; moved += Math.abs(dx);
    s.drag += dx * sens;
    // capture only once it's a real drag, so plain clicks still reach links
    if (moved > 5 && !stage.hasPointerCapture(e.pointerId)) {
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
    }
  });
  const end = () => { lastX = null; stage.classList.remove('dragging'); };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  // A drag shouldn't also open the card link underneath.
  stage.addEventListener('click', e => { if (moved > 5) e.preventDefault(); }, true);
  (function frame(now) {
    if (!s.paused && lastX === null && !reduced) s.auto += speed * (now - last) / 1000;
    last = now;
    apply(s.auto + s.drag + s.scroll);
    requestAnimationFrame(frame);
  })(last);
  return s;
}

/* ---------- Home: the ring (3D carousel) ---------- */
// Turns piece by piece: auto-advances, drags freely and snaps to the nearest piece, arrows and
// keys step through. The front card is lit, the rest fall back into the dark.
const ringEl = $('.ring');
if (ringEl) {
  const list = site.products.filter(p => p.inRotation);
  const n = list.length;
  const step = 360 / Math.max(n, 1);
  // Radius from the actual card width (bigger on desktop than on phones): wide enough that
  // neighbours don't overlap, and the whole ring is pulled back by it so the front card sits at
  // its true size.
  let r = 0;
  const sizeRing = () => {
    const w = ringEl.offsetWidth || 330;
    r = Math.max(w * 1.7, Math.round(n * (w + 50) / (2 * Math.PI)));
    ringEl.style.setProperty('--r', r + 'px');
  };
  sizeRing();
  addEventListener('resize', sizeRing);
  const colours = p => new Set(p.sizes.map(z => z.color).filter(Boolean)).size;
  ringEl.innerHTML = list.map((p, i) => `
    <a class="ring-card" href="${url(p)}" style="--a:${step * i}deg" draggable="false" aria-label="${esc(p.name)}">
      <div class="ring-img${p.images.front ? ' has-img' : ''}"${imgStyle(p.images.front)}>[ ${esc(p.ringLabel || p.name.toLowerCase())} ]</div>
      <div class="ring-t"><span>${esc(p.name)}</span><span class="yel">${money(p.price)}</span></div>
    </a>`).join('');
  const cards = $$('.ring-card', ringEl);
  const st = { angle: 0 };
  let index = 0, dragging = null, moved = 0, hover = false, tween;

  function info() {
    const p = list[index];
    if (!p) return;
    $('.ring-idx').textContent = `${String(index + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;
    $('.ring-name').textContent = p.name;
    $('.ring-name').href = url(p);
    $('.ring-meta').textContent = [money(p.price), colours(p) > 1 ? `${colours(p)} COLOURS` : '', catLabel(p.category)].filter(Boolean).join(' · ');
  }
  function go(i, dur = 0.9) {
    index = ((i % n) + n) % n;
    let to = -index * step;
    to += 360 * Math.round((st.angle - to) / 360); // the short way round
    tween?.kill();
    tween = gsap.to(st, { angle: to, duration: reduced ? 0 : dur, ease: 'power3.out' });
    info();
  }

  (function frame() {
    ringEl.style.transform = `translateZ(${-r}px) rotateX(-6deg) rotateY(${st.angle}deg)`;
    cards.forEach((c, i) => {
      const rel = ((st.angle + i * step) % 360 + 540) % 360 - 180; // card's angle from the front
      const f = (Math.cos(rel * Math.PI / 180) + 1) / 2;
      c.style.opacity = (0.15 + 0.85 * f ** 1.5).toFixed(3);
      c.style.filter = `brightness(${(0.35 + 0.65 * f).toFixed(3)})`;
      c.classList.toggle('front', Math.abs(rel) < step / 2);
    });
    requestAnimationFrame(frame);
  })();

  const stage = $('.ring-stage');
  stage.addEventListener('pointerdown', e => { dragging = e.clientX; moved = 0; tween?.kill(); });
  stage.addEventListener('pointermove', e => {
    if (dragging === null) return;
    const dx = e.clientX - dragging;
    dragging = e.clientX; moved += Math.abs(dx);
    st.angle += dx * 0.3;
    if (moved > 5 && !stage.hasPointerCapture(e.pointerId)) { stage.setPointerCapture(e.pointerId); stage.classList.add('dragging'); }
  });
  const release = () => { if (dragging === null) return; dragging = null; stage.classList.remove('dragging'); go(Math.round(-st.angle / step), 0.6); };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  // Clicking a side card brings it to the front; clicking the front card opens it.
  stage.addEventListener('click', e => {
    const c = e.target.closest('.ring-card');
    if (moved > 5 || (c && !c.classList.contains('front'))) { e.preventDefault(); if (c && moved <= 5) go(cards.indexOf(c)); }
  }, true);
  $('.ring-prev').addEventListener('click', () => go(index - 1));
  $('.ring-next').addEventListener('click', () => go(index + 1));
  $('.rotation').addEventListener('keydown', e => { if (e.key === 'ArrowLeft') go(index - 1); if (e.key === 'ArrowRight') go(index + 1); });
  $('.rotation').addEventListener('pointerenter', () => (hover = true));
  $('.rotation').addEventListener('pointerleave', () => (hover = false));
  // Auto-advance only while visible and not being handled.
  let inView = false;
  new IntersectionObserver(([e]) => (inView = e.isIntersecting)).observe(stage);
  if (!reduced) setInterval(() => { if (inView && !hover && dragging === null && !document.hidden) go(index + 1); }, 3200);
  info();
}

/* ---------- Product viewer ---------- */
// The 3D garment viewer (garmentModel.js / garment3d.js) is switched off: prints distort when
// wrapped onto the models. Set USE_3D = true to bring it back; nothing else needs changing.
const USE_3D = false;
const viewer = $('.viewer');

/* 2D: framed photo card with tilt, swipe, zoom and a card-flip on colour change. */
if (viewer && !USE_3D) {
  viewer.classList.add('is-2d');
  $('.viewer-tl').innerHTML = '<span class="v2-idx"></span><br><span class="red">● <span class="v2-label"></span></span>';
  $('.viewer-tr').textContent = 'DRAG · CLICK TO ZOOM';
  const { mountViewer } = await import('./viewer2d.js');
  const thumbs = $('.thumbs');
  const v2 = mountViewer($('.stage2d'), {
    onChange: (i, v) => {
      $('.v2-idx').textContent = `VIEW ${String(i + 1).padStart(2, '0')} / ${String(views.length).padStart(2, '0')}`;
      $('.v2-label').textContent = v?.label || '';
      $$('.thumb', thumbs).forEach((t, k) => t.classList.toggle('on', k === i));
    },
  });
  let views = [];
  const p = product;
  const viewsFor = ({ front, back }) => [
    ['FRONT', front], ['BACK', back], ['DETAIL', p.images.detail], ['ON BODY', p.images.onBody],
  ].filter(([, src]) => src).filter(([, src], i, all) => all.findIndex(([, s2]) => s2 === src) === i).map(([label, src]) => ({ label, src }));
  const show = async (shots, first) => {
    views = viewsFor(shots);
    thumbs.innerHTML = views.map((v, i) => `<button class="thumb thumb-img" style="background-image:${esc(cssUrl(v.src))}" aria-label="${v.label}"><span>${v.label}</span></button>`).join('');
    $$('.thumb', thumbs).forEach((t, i) => t.addEventListener('click', () => v2.go(i)));
    await v2.setViews(views, { flip: !first });
    if (first) {
      const want = new URLSearchParams(location.search).get('view');
      if (want === 'back') v2.go(Math.max(0, views.findIndex(v => v.label === 'BACK')));
    }
  };
  window.addEventListener('thryftly:shots', e => show(e.detail));
  show(currentShots, true);
  if (!reduced) gsap.from('.details > *', { rotationX: -15, y: 24, opacity: 0, transformPerspective: 1200, transformOrigin: '50% 0%', stagger: 0.08, duration: 0.9, ease: 'power3.out' });
}

/* 3D (off, see USE_3D). */
if (viewer && USE_3D) {
  let g3d = null, gm = null;
  const tt = spinner(viewer, $('.turntable'), {
    speed: 30,
    apply: a => { $('.turntable').style.transform = `rotateY(${a}deg)`; g3d?.setAngle(a); gm?.setAngle(a); },
  });
  // ?view=front / ?view=back opens the viewer standing still on that side (handy for sharing).
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'front' || view === 'back') { tt.paused = true; tt.auto = view === 'back' ? 180 : 0; }
  const photo = $('.viewer-photo');
  $$('.thumb').forEach(b => b.addEventListener('click', () => {
    $$('.thumb').forEach(x => x.classList.toggle('on', x === b));
    // DETAIL / ON BODY are flat photos shown over the model; FRONT / BACK turn the model.
    const flat = b.dataset.img === 'detail' || b.dataset.img === 'onBody' ? product.images[b.dataset.img] : '';
    photo.hidden = !flat;
    if (flat) photo.src = flat;
    tt.paused = true;
    const cur = tt.auto + tt.drag + tt.scroll;
    const delta = ((+b.dataset.angle - cur) % 360 + 540) % 360 - 180; // shortest way round
    gsap.to(tt, { auto: tt.auto + delta, duration: reduced ? 0 : 0.9, ease: 'power3.inOut' });
  }));
  viewer.addEventListener('pointerdown', e => { if (!e.target.closest('button')) { tt.paused = false; photo.hidden = true; } });

  // Best available view: a real 3D garment model dressed with this colour's fabric and print,
  // else the photo turned into 3D, else the flat photo card.
  let pending = Promise.resolve();
  const rebuild = ({ front, back }) => (pending = pending.then(async () => {
    viewer.classList.remove('is-3d', 'is-model');
    if (!front) return;
    try {
      const { modelFor, mountModel } = await import('./garmentModel.js');
      const type = modelFor(product);
      if (type) {
        gm ||= await mountModel($('.g3d-model'));
        if (gm && await gm.build({ type, front, back, prints: { front: product.printFront, back: product.printBack } })) return viewer.classList.add('is-model');
      }
      g3d ||= await (await import('./garment3d.js')).mountGarment($('.g3d'));
      viewer.classList.toggle('is-3d', !!(g3d && await g3d.build(front, back)));
    } catch (e) { console.warn('3D view unavailable', e); }
  }));
  window.addEventListener('thryftly:shots', e => rebuild(e.detail));
  rebuild(currentShots);

  if (!reduced) {
    gsap.from('.details > *', { rotationX: -15, y: 24, opacity: 0, transformPerspective: 1200, transformOrigin: '50% 0%', stagger: 0.08, duration: 0.9, ease: 'power3.out' });
    gsap.from('.turntable-stage, .g3d, .g3d-model', { scale: 0.9, opacity: 0, duration: 1.2, ease: 'power3.out' });
    gsap.to(tt, { scroll: 180, ease: 'none', scrollTrigger: { trigger: viewer, start: 'top top', end: 'bottom top', scrub: SCRUB } });
  }
}

/* ---------- Home: 3D scroll scenes ---------- */
if (isHome && !reduced) {
  const mm = gsap.matchMedia();

  mm.add({ desk: '(min-width: 769px)', mob: '(max-width: 768px)' }, ({ conditions: { desk } }) => {
    // Hero: copy tips back into the grid, bolt flies toward the camera.
    const hero = gsap.timeline({ scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: SCRUB } });
    hero
      .to('.stage-inner', { rotationY: -12, rotationX: 6, z: 80, y: 60, ease: 'none' }, 0)
      .to('.hero-outline', { z: -160, y: 50, opacity: 0.4, ease: 'none' }, 0)
      .fromTo('.hero-floor', { transformPerspective: desk ? 500 : 300, rotationX: desk ? 62 : 60 }, { rotationX: desk ? 68 : 65, ease: 'none' }, 0);
    if (desk) hero.to('.hero-copy', { rotationX: 10, z: -60, y: -30, opacity: 0.5, transformOrigin: '0% 0%', ease: 'none' }, 0);
    else gsap.from('.m-card', { rotationY: -20, x: 30, opacity: 0, transformPerspective: 1000, stagger: 0.1, duration: 0.9, ease: 'power3.out', delay: 0.2 });

    // Marquee swings up off the page like a hinged banner.
    gsap.from('.marquee', { rotationX: -20, transformPerspective: 1200, transformOrigin: '50% 0%', ease: 'none',
      scrollTrigger: { trigger: '.marquee', start: 'top bottom', end: 'top 60%', scrub: SCRUB } });

    gsap.from('.sec-h2', { rotationY: 20, x: -24, opacity: 0, transformPerspective: 1200, transformOrigin: '0% 50%', ease: 'none',
      scrollTrigger: { trigger: '.rotation', start: 'top 85%', end: 'top 35%', scrub: SCRUB } });
    gsap.from('.ring-stage', { scale: 0.85, y: 40, ease: 'none',
      scrollTrigger: { trigger: '.rotation', start: 'top 80%', end: 'top 20%', scrub: SCRUB } });
    $$('.cat-h, .drop-name').forEach(h => gsap.from(h, { rotationY: 20, x: -24, opacity: 0, transformPerspective: 1200, transformOrigin: '0% 50%', ease: 'none',
      scrollTrigger: { trigger: h, start: 'top 92%', end: 'top 60%', scrub: SCRUB } }));

    // Product cards rise and flip up out of the floor.
    $$('.pwrap').forEach((w, i) => {
      gsap.from(w, { rotationX: -18, y: 70, z: -40, opacity: 0, transformOrigin: '50% 100%', ease: 'none',
        scrollTrigger: { trigger: w, start: `top bottom-=${desk ? (i % 4) * 30 : 0}`, end: 'top 65%', scrub: SCRUB } });
    });

    gsap.from('.footer-top', { rotationX: 10, y: 30, opacity: 0, transformPerspective: 1200, ease: 'none',
      scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'top 55%', scrub: SCRUB } });
    gsap.from('.footer-word', { rotationX: -35, y: 30, opacity: 0, ease: 'none',
      scrollTrigger: { trigger: '.footer-word-wrap', start: 'top bottom', end: 'bottom bottom', scrub: SCRUB } });
  });
}
