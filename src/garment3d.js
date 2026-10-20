// Turns a flat product photo into a 3D garment, automatically.
// The mockup's plain background is flood-filled away to get the garment's outline, a distance
// transform of that outline becomes a "puffed" height map, and the front/back photos are wrapped
// onto the two faces. Works for any upload; falls back (returns null) when the photo has no
// clean background to cut out.
import * as THREE from 'three';

const MASK = 384; // mask resolution (long edge): smooth silhouette, still ~20ms to compute

const loadImg = src => new Promise((ok, bad) => {
  const i = new Image();
  i.crossOrigin = 'anonymous';
  i.onload = () => ok(i); i.onerror = bad; i.src = src;
});

// Garment silhouette: everything not connected to the border by background-coloured pixels.
function silhouette(img) {
  const s = MASK / Math.max(img.width, img.height);
  const w = Math.round(img.width * s), h = Math.round(img.height * s);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  // Background colour = median of the border pixels.
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, x + (h - 1) * w);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  const med = k => border.map(i => px[i * 4 + k]).sort((a, b) => a - b)[border.length >> 1];
  const bg = [med(0), med(1), med(2)];
  const diff = i => Math.max(Math.abs(px[i * 4] - bg[0]), Math.abs(px[i * 4 + 1] - bg[1]), Math.abs(px[i * 4 + 2] - bg[2]));
  // Tolerance follows how noisy the background is: studio mockups are perfectly flat, so a white
  // tee only a few shades off the grey backdrop still separates; noisy photos get more slack.
  const noise = border.map(diff).sort((a, b) => a - b)[Math.floor(border.length * 0.98)];
  const tol = Math.max(4, Math.min(13, noise * 2.5 + 2));
  const isBg = i => px[i * 4 + 3] < 24 || diff(i) < tol;

  const mask = new Uint8Array(w * h).fill(1);
  const stack = border.filter(isBg);
  for (const i of stack) mask[i] = 0;
  while (stack.length) {
    const i = stack.pop(), x = i % w;
    for (const n of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
      if (n >= 0 && n < w * h && mask[n] && isBg(n)) { mask[n] = 0; stack.push(n); }
    }
  }

  // Keep the largest blob (drops stray specks such as watermark text).
  const label = new Int32Array(w * h).fill(-1);
  let best = -1, bestSize = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] >= 0) continue;
    let size = 0; const q = [i]; label[i] = i;
    while (q.length) {
      const j = q.pop(), x = j % w; size++;
      for (const n of [j - w, j + w, x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1]) {
        if (n >= 0 && n < w * h && mask[n] && label[n] < 0) { label[n] = i; q.push(n); }
      }
    }
    if (size > bestSize) { bestSize = size; best = i; }
  }
  let x0 = w, y0 = h, x1 = 0, y1 = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < w * h; i++) {
    mask[i] = label[i] === best ? 1 : 0;
    if (!mask[i]) continue;
    const x = i % w, y = (i / w) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2];
  }
  const coverage = bestSize / (w * h);
  // No clean cut-out: the photo is a lifestyle shot or fills the frame. Caller shows the flat view.
  if (coverage < 0.06 || coverage > 0.92) return null;
  // Flat garment mockups are mirror-symmetric; a model wearing the piece isn't. Puffing a person
  // into 3D looks wrong, so those photos stay flat.
  let both = 0, either = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const a = mask[y * w + x], b = mask[y * w + (x0 + x1 - x)];
    both += a & b; either += a | b;
  }
  if (both / either < 0.82) return null;
  return { mask, w, h, box: { x0, y0, x1, y1 }, color: new THREE.Color(r / bestSize / 255, g / bestSize / 255, b / bestSize / 255) };
}

// Two-pass chamfer distance from the outline, in mask pixels.
function distance({ mask, w, h }) {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 1e9 : 0;
  const pass = (y, x, dy, dx) => {
    const i = y * w + x;
    if (!d[i]) return;
    for (const [oy, ox, cost] of [[0, -dx, 1], [-dy, 0, 1], [-dy, -dx, 1.414], [-dy, dx, 1.414]]) {
      const ny = y + oy, nx = x + ox;
      d[i] = Math.min(d[i], ny < 0 || ny >= h || nx < 0 || nx >= w ? 1 : d[ny * w + nx] + cost);
    }
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pass(y, x, 1, 1);
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) pass(y, x, -1, -1);
  return d;
}

function photoTexture(img, sil, mirror) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  const { x0, y0, x1, y1 } = sil.box;
  // Map the plane (which spans the front silhouette's box) onto this photo's own garment box.
  const rx = (x1 - x0 + 1) / sil.w, ry = (y1 - y0 + 1) / sil.h;
  t.repeat.set(mirror ? -rx : rx, ry);
  t.offset.set(mirror ? (x1 + 1) / sil.w : x0 / sil.w, 1 - (y1 + 1) / sil.h);
  t.needsUpdate = true;
  return t;
}

export async function mountGarment(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 0.05, 4.4);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3a40, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(-2, 2.5, 3); scene.add(key);
  const back = new THREE.DirectionalLight(0xffffff, 1.1); back.position.set(2, 2.5, -3); scene.add(back);
  const rim = new THREE.DirectionalLight(0xff3b3b, 0.6); rim.position.set(3, 0, 0); scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  // Soft contact shadow.
  const sc = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const sx = sc.getContext('2d'), grad = sx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = grad; sx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.08;
  scene.add(shadow);

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole garment in frame on narrow screens too.
    camera.position.z = Math.max(4.4, 4.4 * 0.9 / camera.aspect);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let angle = 0, alive = true, built = [];
  (function loop() {
    if (!alive) return;
    group.rotation.y = THREE.MathUtils.degToRad(angle);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  async function build(frontUrl, backUrl) {
    const front = await loadImg(frontUrl);
    const sil = silhouette(front);
    if (!sil) return false;
    const backImg = backUrl ? await loadImg(backUrl).catch(() => null) : null;
    const backSil = backImg && silhouette(backImg);

    const { w, h, box } = sil;
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const dist = distance(sil);
    const R = Math.min(bw, bh) * 0.18; // puff radius: how far in from the edge the fabric reaches full depth
    const EDGE = 4; // cut the outline this many mask px inside the photo edge, dropping background fringe
    const height = 2.1, width = height * bw / bh;
    const depth = 0.19; // half-thickness at full puff, in world units (garment is 2.1 tall)

    const geo = new THREE.PlaneGeometry(width, height, Math.min(bw, 240), Math.min(bh, 300));
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    // Bilinear lookup so the surface (and the seam where front meets back) has no pixel steps.
    const at = (x, y) => dist[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    const sample = (fx, fy) => {
      const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
      return (at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty) + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty;
    };
    for (let i = 0; i < pos.count; i++) {
      const fx = box.x0 + uv.getX(i) * (bw - 1), fy = box.y0 + (1 - uv.getY(i)) * (bh - 1);
      // Rounded "pillow" profile that reaches z=0 exactly where the outline is cut, so the
      // front and back faces meet with no gap.
      const d = Math.min(Math.max(sample(fx, fy) - EDGE, 0), R) / R;
      // Each face dips slightly past the middle at the rim, so front and back overlap there and the
      // seam never shows a hairline gap from the side.
      pos.setZ(i, depth * Math.sqrt(1 - (1 - d) * (1 - d)) - 0.012);
    }
    geo.computeVertexNormals();
    const backGeo = geo.clone();
    const bp = backGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) bp.setZ(i, -bp.getZ(i));
    backGeo.computeVertexNormals();

    // Alpha mask: the silhouette, cropped by the same texture transform as the front photo.
    const mc = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const mctx = mc.getContext('2d'), md = mctx.createImageData(w, h);
    // Alpha from the distance field (not the hard mask): linear filtering + alphaTest then gives a
    // smooth, anti-aliased-looking contour instead of stair steps.
    for (let i = 0; i < w * h; i++) { const v = Math.max(0, Math.min(255, (dist[i] - EDGE + 0.5) * 255)); md.data.set([v, v, v, 255], i * 4); }
    mctx.putImageData(md, 0, 0);
    const alpha = new THREE.CanvasTexture(mc);
    alpha.repeat.set(bw / w, bh / h);
    alpha.offset.set(box.x0 / w, 1 - (box.y1 + 1) / h);

    const common = { roughness: 1, metalness: 0, alphaMap: alpha, alphaTest: 0.5 };
    const frontMat = new THREE.MeshStandardMaterial({ ...common, map: photoTexture(front, sil, false) });
    // No usable back photo: a plain back in the garment's own colour, never another colour's print.
    const backMat = new THREE.MeshStandardMaterial({ ...common, side: THREE.BackSide, ...(backSil ? { map: photoTexture(backImg, backSil, true) } : { color: sil.color }) });

    for (const o of built) { o.geometry.dispose(); o.material.map?.dispose(); o.material.alphaMap?.dispose(); o.material.dispose(); group.remove(o); }
    built = [new THREE.Mesh(geo, frontMat), new THREE.Mesh(backGeo, backMat)];
    group.add(...built);
    shadow.scale.x = width / 1.8;
    return true;
  }

  return {
    build,
    setAngle: deg => (angle = deg),
    dispose() { alive = false; ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
