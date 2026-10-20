// Product photo viewer: a framed photo card that feels physical without touching the artwork.
//   - cursor tilt (a few degrees of perspective) with a light sheen that follows the pointer
//   - swipe / drag / arrows / keys between views, sliding with an eased snap
//   - click (or tap) to zoom 2.4x and pan with the pointer to inspect the print
//   - switching colour flips the card over onto the new colour's photos
import gsap from 'gsap';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountViewer(stage, { onChange } = {}) {
  stage.innerHTML = `
    <div class="s2-card">
      <div class="s2-track"></div>
      <div class="s2-sheen"></div>
    </div>
    <button class="s2-nav s2-prev" aria-label="Previous view">←</button>
    <button class="s2-nav s2-next" aria-label="Next view">→</button>`;
  const card = stage.querySelector('.s2-card'), track = stage.querySelector('.s2-track'), sheen = stage.querySelector('.s2-sheen');
  let views = [], index = 0, zoomed = false, drag = null;

  const slides = () => [...track.children];
  function place(i, animate = true) {
    index = Math.max(0, Math.min(views.length - 1, i));
    gsap.to(track, { xPercent: -100 * index, duration: animate && !reduced ? 0.7 : 0, ease: 'expo.out' });
    stage.querySelector('.s2-prev').hidden = index === 0;
    stage.querySelector('.s2-next').hidden = index >= views.length - 1;
    onChange?.(index, views[index]);
  }

  function fill(list) {
    views = list;
    track.innerHTML = list.map((v, i) => `<figure class="s2-slide"><img src="${v.src}" alt="${v.label}" ${i ? 'loading="lazy"' : ''} draggable="false"></figure>`).join('');
  }

  function unzoom() {
    if (!zoomed) return;
    zoomed = false;
    card.classList.remove('zoomed');
    const img = slides()[index]?.querySelector('img');
    if (img) gsap.to(img, { scale: 1, x: 0, y: 0, duration: 0.45, ease: 'power3.out' });
  }

  // Views for a colour: on first show slide straight in; on a colour change flip the card over.
  async function setViews(list, { keep = true, flip = true } = {}) {
    unzoom();
    const label = views[index]?.label;
    const next = keep ? Math.max(0, list.findIndex(v => v.label === label)) : 0;
    if (!views.length || !flip || reduced) { fill(list); place(next, false); return; }
    await gsap.to(card, { rotationY: 90, duration: 0.22, ease: 'power2.in' });
    fill(list); place(next, false);
    gsap.fromTo(card, { rotationY: -90 }, { rotationY: 0, duration: 0.5, ease: 'back.out(1.6)' });
  }

  // Tilt + sheen follow the pointer (desktop); zoomed, the pointer pans the photo instead.
  stage.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    if (zoomed) {
      const img = slides()[index].querySelector('img');
      gsap.to(img, { x: (0.5 - px) * r.width * 1.4, y: (0.5 - py) * r.height * 1.4, duration: 0.3, ease: 'power2.out' });
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx));
      gsap.set(track, { xPercent: -100 * index + (dx / r.width) * 100 });
      return;
    }
    if (e.pointerType !== 'mouse' || reduced) return;
    gsap.to(card, { rotationY: (px - 0.5) * 10, rotationX: (0.5 - py) * 8, duration: 0.6, ease: 'power3.out' });
    sheen.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,.28), rgba(255,255,255,0) 45%)`;
    sheen.style.opacity = 1;
  });
  stage.addEventListener('pointerleave', () => {
    if (!zoomed) gsap.to(card, { rotationX: 0, rotationY: 0, duration: 0.9, ease: 'elastic.out(1, 0.5)' });
    sheen.style.opacity = 0;
  });

  // Drag / swipe between views; a click without movement toggles zoom.
  card.addEventListener('pointerdown', e => {
    if (zoomed) return;
    drag = { x: e.clientX, moved: 0 };
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointerup', e => {
    if (!drag) {
      unzoom();
      return;
    }
    const { moved, x } = drag;
    drag = null;
    if (moved > 30) return place(index + (e.clientX < x ? 1 : -1));
    place(index);
    if (moved < 6) {
      zoomed = true;
      card.classList.add('zoomed');
      gsap.to(card, { rotationX: 0, rotationY: 0, duration: 0.3 });
      gsap.to(slides()[index].querySelector('img'), { scale: 2.4, duration: 0.5, ease: 'power3.out' });
    }
  });
  card.addEventListener('pointercancel', () => { drag = null; place(index); });
  stage.querySelector('.s2-prev').addEventListener('click', () => { unzoom(); place(index - 1); });
  stage.querySelector('.s2-next').addEventListener('click', () => { unzoom(); place(index + 1); });
  stage.tabIndex = 0;
  stage.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { unzoom(); place(index - 1); }
    if (e.key === 'ArrowRight') { unzoom(); place(index + 1); }
    if (e.key === 'Escape') unzoom();
  });

  if (!reduced) gsap.from(card, { y: 40, opacity: 0, rotationX: 12, duration: 1.1, ease: 'power3.out' });
  return { setViews, go: i => { unzoom(); place(i); }, get index() { return index; } };
}
