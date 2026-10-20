// Virtual try-on: the garment cut-out is composited over the customer's photo in a
// canvas (all on-device), then the local Ollama vision model gives styling/fit notes.
import { $, api } from './shop.js';

const dlg = $('.tryon');
const cv = $('.tryon-canvas');
const ctx = cv.getContext('2d');
const out = $('.tryon-out');
const drop = $('.tryon-drop');
const file = drop.querySelector('input');
const askBtn = $('.tr-ask');

let photo = null, garment = null, product = null;
const g = { x: 360, y: 400, scale: 0.8, rot: 0, alpha: 0.92 };

const loadImg = src => new Promise((ok, bad) => {
  const i = new Image();
  i.crossOrigin = 'anonymous';
  i.onload = () => ok(i); i.onerror = bad; i.src = src;
});

function draw() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (photo) {
    // cover-fit the photo into the 3:4 canvas
    const s = Math.max(cv.width / photo.width, cv.height / photo.height);
    ctx.drawImage(photo, (cv.width - photo.width * s) / 2, (cv.height - photo.height * s) / 2, photo.width * s, photo.height * s);
  }
  if (photo && garment) {
    const w = cv.width * g.scale, h = w * garment.height / garment.width;
    ctx.save();
    ctx.globalAlpha = g.alpha;
    ctx.translate(g.x, g.y);
    ctx.rotate(g.rot * Math.PI / 180);
    ctx.drawImage(garment, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

const msg = (text, err) => { out.innerHTML = ''; const s = document.createElement('span'); if (err) s.className = 'err'; s.textContent = text; out.append(s); };

file.addEventListener('change', async () => {
  const f = file.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  photo = await loadImg(url);
  URL.revokeObjectURL(url);
  drop.classList.add('hidden');
  Object.assign(g, { x: cv.width / 2, y: cv.height * 0.55 });
  draw();
  refreshAsk();
});

// drag the garment
let drag = null;
const pt = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
cv.addEventListener('pointerdown', e => { drag = { ...pt(e), gx: g.x, gy: g.y }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', e => { if (!drag) return; const p = pt(e); g.x = drag.gx + p.x - drag.x; g.y = drag.gy + p.y - drag.y; draw(); });
cv.addEventListener('pointerup', () => (drag = null));
cv.addEventListener('wheel', e => { e.preventDefault(); g.scale = Math.min(2, Math.max(0.2, g.scale - e.deltaY * 0.001)); $('.tr-scale').value = g.scale * 100; draw(); }, { passive: false });

$('.tr-scale').addEventListener('input', e => { g.scale = e.target.value / 100; draw(); });
$('.tr-rot').addEventListener('input', e => { g.rot = +e.target.value; draw(); });
$('.tr-alpha').addEventListener('input', e => { g.alpha = e.target.value / 100; draw(); });
$('.tr-new').addEventListener('click', () => file.click());
$('.tryon-close').addEventListener('click', () => dlg.close());
$('.tr-save').addEventListener('click', () => {
  if (!photo) return;
  const a = document.createElement('a');
  a.download = `thryftly-${product.slug}-tryon.jpg`;
  a.href = cv.toDataURL('image/jpeg', 0.9);
  a.click();
});

let ai = { ready: false };
function refreshAsk() {
  askBtn.disabled = !photo || !garment || !ai.ready;
  askBtn.title = ai.ready ? '' : 'AI stylist offline';
}

askBtn.addEventListener('click', async () => {
  askBtn.disabled = true;
  msg('STYLIST IS LOOKING… (a local model can take 10–60s)');
  try {
    let image;
    try { image = cv.toDataURL('image/jpeg', 0.85); } catch { throw new Error('This product image can’t be analysed (hosted on another site).'); }
    const { text } = await api('/api/tryon', { slug: product.slug, image });
    msg(text);
  } catch (e) {
    msg(e.message, true);
  }
  refreshAsk();
});

export async function openTryon(p) {
  if (product !== p) {
    product = p;
    garment = null;
    const src = p.tryonImage || p.images.front;
    if (src) { try { garment = await loadImg(src); } catch { garment = null; } }
  }
  dlg.showModal();
  draw();
  if (!garment) msg('This piece has no try-on image yet.', true);
  else msg('Upload a photo, then drag and resize the piece to line it up with your shoulders.');
  ai = await api('/api/tryon/status').catch(() => ({ ready: false }));
  if (garment && !ai.ready) msg(`Preview works on-device. The AI stylist is ${ai.up ? 'still being installed' : 'offline'} right now, so feedback is unavailable.`);
  refreshAsk();
}
