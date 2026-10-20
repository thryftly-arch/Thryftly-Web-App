import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { $, $$, esc, cssUrl, loadSite, money, bindSettings, addToCart, mountChrome, productCard, productUrl } from './shop.js';

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

/* ---------- Countdown ---------- */
const cds = $$('.countdown');
if (cds.length) {
  const target = Date.parse(site.settings.countdownTarget) || 0;
  const p = n => String(n).padStart(2, '0');
  const tick = () => {
    const t = Math.max(0, Math.floor((target - Date.now()) / 1000));
    const s = [Math.floor(t / 86400), Math.floor(t % 86400 / 3600), Math.floor(t % 3600 / 60), t % 60].map(p).join(':');
    cds.forEach(c => (c.textContent = s));
  };
  tick();
  setInterval(tick, 1000);
}

/* ---------- Home render ---------- */
if (isHome) {
  const { settings: s, products } = site;
  if (s.heroImage) $('.bolt-float').innerHTML = `<img class="hero-img" src="${esc(s.heroImage)}" alt="">`;

  const run = s.marquee.map(m => `<span>${esc(m)}</span><span class="sl">///</span>`).join('');
  $('.marquee-track').innerHTML = run + run.replace(/<span/g, '<span aria-hidden="true"');

  const ring = products.filter(p => p.inRotation);
  const r = Math.max(420, Math.round(ring.length * 260 / (2 * Math.PI)));
  $('.ring').style.setProperty('--r', r + 'px');
  $('.ring-count').textContent = String(ring.length).padStart(2, '0');
  $('.ring').innerHTML = ring.map((p, i) => `
    <a class="ring-card ${i % 2 ? 'b-red' : 'b-yel'}" href="${url(p)}" style="--a:${(360 / ring.length) * i}deg" draggable="false">
      <div class="ring-img${p.images.front ? ' has-img' : ''}"${imgStyle(p.images.front)}>[ ${esc(p.ringLabel || p.name.toLowerCase())} ]</div>
      <div class="ring-t"><span>${esc(p.name)}</span><span class="yel">${money(p.price)}</span></div>
    </a>`).join('');

  const featured = products.filter(p => p.featured).slice(0, 8);
  $('#shop').innerHTML = featured.map(productCard).join('');
  $('.shop-all').textContent = `SHOP ALL ${products.length} PIECES →`;

  $('.m-strip').innerHTML = featured.map((p, i) => `
    <a class="m-card${i < 2 ? (i ? ' sh-yel' : ' sh-red') : ''}" href="${url(p)}">
      <div class="m-card-img"${imgStyle(p.images.front)}></div><div class="m-card-t">${esc(p.name)} · ${money(p.price)}</div></a>`).join('');

}

/* ---------- Product render ---------- */
let product;
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

  // Variants are colour × size. Colour buttons only appear when a product has colours.
  const colors = [...new Set(p.sizes.map(v => v.color).filter(Boolean))];
  let color = colors.find(c => p.sizes.some(v => v.color === c && v.available)) ?? colors[0] ?? '';
  let size;
  const add = $('.add-cart');
  if (colors.length) $('.sizes').insertAdjacentHTML('beforebegin', '<div class="sizes colors"><span class="sizes-label">COLOUR — <span class="p-color"></span></span><div class="sizes-row colors-row"></div></div>');

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
    const shot = p.colorImages?.[color];
    if (shot || colors.length) { const f = $('.tt-front'); f.style.backgroundImage = cssUrl(shot || p.images.front); f.classList.toggle('has-img', !!(shot || p.images.front)); }
    add.disabled = !size;
    if (!size) add.textContent = 'SOLD OUT';
    else if (add.textContent === 'SOLD OUT') add.textContent = 'ADD TO CART →';
  }
  drawVariants();

  add.addEventListener('click', () => {
    if (add.dataset.added) return void (location.href = '/checkout.html');
    addToCart(p.slug, size, color);
    add.textContent = 'ADDED — VIEW CART →';
    add.dataset.added = '1';
    gsap.fromTo('.cart-btn', { rotationY: 0 }, { rotationY: 360, transformPerspective: 400, duration: 0.6, ease: 'power2.out' });
  });

  const face = (el, u, label) => {
    el.style.backgroundImage = u ? cssUrl(u) : '';
    el.classList.toggle('has-img', !!u);
    el.querySelector('.tt-ph').textContent = `[ 3D model / ${p.name.toLowerCase()} — ${label} ]`;
  };
  face($('.tt-front'), p.images.front, 'front');
  face($('.tt-back'), p.images.back, 'back');

  $('.fav').addEventListener('click', e => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.textContent = on ? '♥' : '♡';
  });

  $('.p-cat-link').href = `/shop.html?c=${encodeURIComponent(p.category)}`;
  const related = site.products.filter(o => o.slug !== p.slug && o.category === p.category).slice(0, 4);
  if (related.length) { $('.related-grid').innerHTML = related.map(productCard).join(''); $('.related').hidden = false; }

  $('.tryon-open').addEventListener('click', async () => (await import('./tryon.js')).openTryon(p));
}

/* ---------- Drag-to-spin helper (ring + turntable) ---------- */
// Returns a live state object; angle = auto spin + drag + scroll offset.
function spinner(stage, target, { speed, base = '', sens = 0.4 }) {
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
    target.style.transform = `${base} rotateY(${s.auto + s.drag + s.scroll}deg)`;
    requestAnimationFrame(frame);
  })(last);
  return s;
}

/* ---------- Home: rotation ring ---------- */
const ringStage = $('.ring-stage');
if (ringStage) {
  const ring = spinner(ringStage, $('.ring'), { speed: -12, base: 'rotateX(-8deg)' });
  if (!reduced) {
    // Pin the section and wind the ring with the scroll.
    gsap.to(ring, {
      scroll: -120, ease: 'none',
      scrollTrigger: { trigger: '.rotation', start: 'top top', end: '+=60%', pin: true, scrub: SCRUB },
    });
  }
}

/* ---------- Product: turntable viewer ---------- */
const viewer = $('.viewer');
if (viewer) {
  const tt = spinner(viewer, $('.turntable'), { speed: 30 });
  $$('.thumb').forEach(b => b.addEventListener('click', () => {
    $$('.thumb').forEach(x => x.classList.toggle('on', x === b));
    // DETAIL / ON BODY swap their photo onto the front face
    const sel = $('.colors-row .size.on')?.textContent;
    const u = b.dataset.img === 'front' ? product.colorImages?.[sel] || product.images.front : product.images[b.dataset.img];
    if (b.dataset.angle === '0') {
      const front = $('.tt-front');
      front.style.backgroundImage = cssUrl(u || product.images.front);
      front.classList.toggle('has-img', !!(u || product.images.front));
    }
    tt.paused = true;
    const cur = tt.auto + tt.drag + tt.scroll;
    const delta = ((+b.dataset.angle - cur) % 360 + 540) % 360 - 180; // shortest way round
    gsap.to(tt, { auto: tt.auto + delta, duration: reduced ? 0 : 0.9, ease: 'power3.inOut' });
  }));
  viewer.addEventListener('pointerdown', e => { if (!e.target.closest('button')) tt.paused = false; });

  if (!reduced) {
    gsap.from('.details > *', { rotationX: -15, y: 24, opacity: 0, transformPerspective: 1200, transformOrigin: '50% 0%', stagger: 0.08, duration: 0.9, ease: 'power3.out' });
    gsap.from('.turntable-stage', { rotationX: 12, scale: 0.9, opacity: 0, duration: 1.2, ease: 'power3.out' });
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
