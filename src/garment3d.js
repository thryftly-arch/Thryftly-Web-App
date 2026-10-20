// Turns a flat product photo into a 3D garment, automatically.
//
// 1. Cut-out: the mockup's plain background is flood-filled away to get the garment outline.
// 2. Shape: the garment is modelled the way it sits on a body, not as a pillow:
//    - the torso is a rounded cylinder sized from the measured chest width,
//    - sleeves and hood are round tubes sized from their own width (ridge of the distance field),
//    - shoulders close over the top, the hem stays open and shows the darker inside.
// 3. Look: the front/back photos wrap the two faces; studio environment light, soft self-shadows,
//    a cloth sheen and Neutral tone mapping (made for product colour accuracy).
// Returns null / false when a photo can't be cut out cleanly (model shots, busy backgrounds), and
// the page keeps its flat view.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

const MASK = 384; // mask resolution (long edge): smooth silhouette, still fast to compute
const EDGE = 4; // cut the outline this many mask px inside the photo edge (drops the photo's outline/fringe)
// Depth only starts rising this far inside the cut, so front and back always meet flat at the
// outline even where the surface is steep (otherwise the seam opens between mesh vertices).
const ZEDGE = EDGE + 2.5;

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
  if (coverage < 0.06 || coverage > 0.92) return null;
  // Flat garment mockups are mirror-symmetric; a model wearing the piece isn't. Puffing a person
  // into 3D looks wrong, so those photos stay flat.
  let both = 0, either = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const a = mask[y * w + x], m = mask[y * w + (x0 + x1 - x)];
    both += a & m; either += a | m;
  }
  if (both / either < 0.82) return null;
  return { mask, px, w, h, box: { x0, y0, x1, y1 }, color: new THREE.Color().setRGB(r / bestSize / 255, g / bestSize / 255, b / bestSize / 255, THREE.SRGBColorSpace) };
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

// Half-thickness (in mask px) of the garment at every pixel, front side.
export function depthField({ mask, w, h, box }, dist) {
  const { x0, y0, x1, y1 } = box;
  const bh = y1 - y0 + 1;
  const runAt = (y, x) => { // the horizontal run of garment pixels containing (x, y)
    if (!mask[y * w + x]) return null;
    let a = x, b = x;
    while (a > 0 && mask[y * w + a - 1]) a--;
    while (b < w - 1 && mask[y * w + b + 1]) b++;
    return [a, b];
  };

  // Chest width + centre, measured across the lower body (below the sleeves, above the hem).
  const cx = Math.round((x0 + x1) / 2), widths = [], centres = [];
  for (let y = Math.round(y0 + bh * 0.6); y <= y0 + bh * 0.92; y++) {
    const run = runAt(y, cx);
    if (run) { widths.push(run[1] - run[0] + 1); centres.push((run[0] + run[1]) / 2); }
  }
  const median = a => a.sort((p, q) => p - q)[a.length >> 1];
  const torsoW = widths.length ? median(widths) : (x1 - x0) * 0.6;
  const torsoC = centres.length ? median(centres) : cx;

  // Local tube radius: follow each pixel uphill on the distance field to its ridge (medial axis);
  // the ridge height is the half-width of the sleeve/hood/body part the pixel belongs to.
  const order = [];
  for (let i = 0; i < w * h; i++) if (mask[i]) order.push(i);
  order.sort((a, b) => dist[b] - dist[a]);
  const ridge = new Float32Array(w * h);
  for (const i of order) {
    const x = i % w;
    let up = -1, upD = dist[i];
    for (const n of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w - 1, i - w + 1, i + w - 1, i + w + 1]) {
      if (n >= 0 && n < w * h && dist[n] > upD) { upD = dist[n]; up = n; }
    }
    ridge[i] = up < 0 ? dist[i] : ridge[up];
  }

  // Distance down from the top edge of each column (rounds the shoulders and collar closed).
  const fromTop = new Float32Array(w * h);
  for (let x = 0; x < w; x++) {
    let top = -1;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      if (!mask[i]) { top = -1; continue; }
      if (top < 0) top = y;
      fromTop[i] = y - top;
    }
  }

  const z = new Float32Array(w * h);
  const shoulder = torsoW * 0.24; // how far down the shoulder curve runs before full body depth
  const BODY = 0.5, TUBE = 0.78; // half-depth as a share of half-width: a torso is ~half as deep as it is wide
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      // Body: an ellipse across this row's run, never wider than the chest.
      const [a, b] = runAt(y, x);
      const ra = a + ZEDGE, rb = b - ZEDGE, W = rb - ra;
      let zc = 0;
      if (W > 0) {
        const narrow = W <= torsoW - 2 * ZEDGE;
        const c = narrow ? (ra + rb) / 2 : torsoC, rr = narrow ? W / 2 : (torsoW - 2 * ZEDGE) / 2;
        const t = rr * rr - (x - c) * (x - c);
        if (t > 0) zc = Math.sqrt(t) * BODY * Math.sqrt(Math.min(1, Math.max(0, fromTop[i] - ZEDGE) / shoulder));
      }
      // Sleeves, hood, cuffs: round tubes.
      const d = dist[i] - ZEDGE, R = Math.max(ridge[i] - ZEDGE, 1);
      const zt = d > 0 ? Math.sqrt(Math.max(0, d * (2 * R - d))) * TUBE : 0;
      z[i] = Math.max(zc, zt);
    }
  }
  return smooth(z, mask, w, h, 4, 2);
}

// Masked box blur (repeated ≈ gaussian): softens the seams between body, sleeve and shoulder
// shapes so the cloth reads as one draped piece instead of stepped bands.
function smooth(src, mask, w, h, r, passes) {
  let a = src, b = new Float32Array(w * h);
  for (let p = 0; p < passes; p++) {
    for (const horizontal of [true, false]) {
      for (let o = 0; o < (horizontal ? h : w); o++) {
        for (let k = 0; k < (horizontal ? w : h); k++) {
          const i = horizontal ? o * w + k : k * w + o;
          if (!mask[i]) { b[i] = 0; continue; }
          let sum = 0, n = 0;
          for (let t = -r; t <= r; t++) {
            const kk = k + t;
            if (kk < 0 || kk >= (horizontal ? w : h)) continue;
            const j = horizontal ? o * w + kk : kk * w + o;
            if (mask[j]) { sum += a[j]; n++; }
          }
          b[i] = sum / n;
        }
      }
      [a, b] = [b, a];
    }
  }
  // Blurring lifts the rim off zero; blend back to the exact shape near the rim so the side seam stays closed.
  for (let i = 0; i < w * h; i++) { const t = Math.min(1, src[i] / 12); a[i] = src[i] * (1 - t) + a[i] * t; }
  return a;
}

function photoTexture(img, sil, mirror) {
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const { x0, y0, x1, y1 } = sil.box;
  // Map the plane (which spans the front silhouette's box) onto this photo's own garment box.
  const rx = (x1 - x0 + 1) / sil.w, ry = (y1 - y0 + 1) / sil.h;
  t.repeat.set(mirror ? -rx : rx, ry);
  t.offset.set(mirror ? (x1 + 1) / sil.w : x0 / sil.w, 1 - (y1 + 1) / sil.h);
  t.needsUpdate = true;
  return t;
}

// Cloth: matte, a little sheen, the photo kept readable through emissive, and the inside of the
// garment (seen through the hem) darker than the outside.
function clothMaterial({ map, color, alphaMap, sheenColor, sideColor }) {
  const m = new THREE.MeshPhysicalMaterial({
    map, color: map ? 0xffffff : color, alphaMap, alphaTest: 0.5, side: THREE.DoubleSide,
    roughness: 0.92, metalness: 0, sheen: 0.45, sheenRoughness: 0.75, sheenColor,
    emissive: map ? 0xffffff : color, emissiveMap: map || null, emissiveIntensity: 0.3,
  });
  // Where the surface turns sideways the photo would be stretched (and its darker outline
  // smeared), so the sides take the fabric's own colour instead.
  m.onBeforeCompile = sh => {
    sh.uniforms.sideColor = { value: sideColor };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float rim;\nvarying float vRim;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRim = rim;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 sideColor;\nvarying float vRim;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n  float side = smoothstep(0.45, 0.9, vRim);\n  diffuseColor.rgb = mix(diffuseColor.rgb, sideColor, side);\n  if (!gl_FrontFacing) diffuseColor.rgb *= mix(0.32, 1.0, side);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance = mix(totalEmissiveRadiance, sideColor * 0.3, side);\n  if (!gl_FrontFacing) totalEmissiveRadiance *= mix(0.15, 1.0, side);');
  };
  return m;
}

export async function mountGarment(host) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
  const target = new THREE.Vector3(0, -0.04, 0);

  const key = new THREE.DirectionalLight(0xffffff, 1.7);
  key.position.set(-2.2, 3.2, 3.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.6;
  key.shadow.camera.right = key.shadow.camera.top = 1.6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.025;
  key.shadow.radius = 5;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45); fill.position.set(2.6, 1, 2.2); scene.add(fill);
  const backKey = new THREE.DirectionalLight(0xffffff, 1.1); backKey.position.set(1.5, 2.5, -3.2); scene.add(backKey);
  const rim = new THREE.DirectionalLight(0xff3b3b, 0.55); rim.position.set(3.5, 0.4, -0.5); scene.add(rim);

  const group = new THREE.Group();
  scene.add(group);

  // Floor: a real shadow from the key light plus a soft contact blur.
  const floorY = -1.1;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = floorY;
  ground.receiveShadow = true;
  scene.add(ground);
  const sc = Object.assign(document.createElement('canvas'), { width: 128, height: 128 });
  const sx = sc.getContext('2d'), grad = sx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,.6)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  sx.fillStyle = grad; sx.fillRect(0, 0, 128, 128);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.55), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = floorY + 0.002;
  scene.add(blob);

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole garment in frame on narrow screens too.
    const z = Math.max(5.9, 5.9 * 0.85 / camera.aspect);
    camera.position.set(0, 0.5 * z / 5.9, z);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let angle = 0, alive = true, built = [];
  const clock = new THREE.Clock();
  (function loop() {
    if (!alive) return;
    group.rotation.y = THREE.MathUtils.degToRad(angle);
    group.position.y = Math.sin(clock.getElapsedTime() * 1.3) * 0.018; // a slight hanging sway
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
    const zf = depthField(sil, dist);
    const height = 2.1, width = height * bw / bh, unit = height / bh;

    const geo = new THREE.PlaneGeometry(width, height, Math.min(bw, 256), Math.min(bh, 320));
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    // Bilinear lookup so the surface (and the seam where front meets back) has no pixel steps.
    const at = (x, y) => zf[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    const sample = (fx, fy) => {
      const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y;
      return (at(x, y) * (1 - tx) + at(x + 1, y) * tx) * (1 - ty) + (at(x, y + 1) * (1 - tx) + at(x + 1, y + 1) * tx) * ty;
    };
    for (let i = 0; i < pos.count; i++) {
      const fx = box.x0 + uv.getX(i) * (bw - 1), fy = box.y0 + (1 - uv.getY(i)) * (bh - 1);
      // A hair past the middle at the rim so front and back always overlap at the side seams.
      pos.setZ(i, sample(fx, fy) * unit - 0.006);
    }
    geo.computeVertexNormals();
    // At the side seams, point the normals straight outward (in the garment's plane) so front and
    // back shade as one continuous surface instead of meeting in a crease.
    const nrm0 = geo.attributes.normal;
    const dS = (x, y) => dist[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
    for (let i = 0; i < nrm0.count; i++) {
      const fx = box.x0 + uv.getX(i) * (bw - 1), fy = box.y0 + (1 - uv.getY(i)) * (bh - 1);
      const wgt = 1 - Math.min(1, Math.max(0, (dS(fx, fy) - ZEDGE) / 7));
      if (wgt <= 0) continue;
      const gx = dS(fx + 1.5, fy) - dS(fx - 1.5, fy), gy = dS(fx, fy + 1.5) - dS(fx, fy - 1.5);
      const len = Math.hypot(gx, gy) || 1;
      const n = new THREE.Vector3(nrm0.getX(i), nrm0.getY(i), nrm0.getZ(i)).lerp(new THREE.Vector3(-gx / len, gy / len, 0), wgt).normalize();
      nrm0.setXYZ(i, n.x, n.y, n.z);
    }
    // How sideways each vertex faces (0 = towards the camera, 1 = edge-on): drives the side colour.
    const nrm = geo.attributes.normal, rim = new Float32Array(nrm.count);
    // Also anything within a few px of the outline: that's where the photo's dark edge shading sits.
    const dAt = (x, y) => dist[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))];
    for (let i = 0; i < nrm.count; i++) {
      const near = 1 - Math.min(1, Math.max(0, (dAt(box.x0 + uv.getX(i) * (bw - 1), box.y0 + (1 - uv.getY(i)) * (bh - 1)) - ZEDGE) / 2.5));
      rim[i] = Math.max(1 - Math.abs(nrm.getZ(i)), near);
    }
    geo.setAttribute('rim', new THREE.BufferAttribute(rim, 1));
    // Back half: mirrored in depth, triangles flipped so its outside faces outward.
    const backGeo = geo.clone();
    const bp = backGeo.attributes.position, idx = backGeo.index.array;
    for (let i = 0; i < bp.count; i++) bp.setZ(i, -bp.getZ(i));
    for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    // Mirror the front's normals (not recomputed) so both halves agree exactly along the seam.
    const bn = backGeo.attributes.normal;
    for (let i = 0; i < bn.count; i++) bn.setZ(i, -bn.getZ(i));

    // Alpha from the distance field (not the hard mask): linear filtering + alphaTest gives a
    // clean contour instead of stair steps.
    const mc = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const mctx = mc.getContext('2d'), md = mctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = Math.max(0, Math.min(255, (dist[i] - EDGE + 0.5) * 255)); md.data.set([v, v, v, 255], i * 4); }
    mctx.putImageData(md, 0, 0);
    const alpha = new THREE.CanvasTexture(mc);
    alpha.repeat.set(bw / w, bh / h);
    alpha.offset.set(box.x0 / w, 1 - (box.y1 + 1) / h);

    const sheenColor = sil.color.clone().lerp(new THREE.Color(0xffffff), 0.45);
    // Fabric colour: average of a band just inside the outline (past the photo's edge shading,
    // before any print in the middle).
    // Median per channel so a print reaching the edge doesn't tint it.
    const band = [[], [], []];
    for (let i = 0; i < w * h; i++) if (dist[i] > EDGE + 8 && dist[i] < EDGE + 24) for (let k = 0; k < 3; k++) band[k].push(sil.px[i * 4 + k]);
    const mid = a => a.sort((p, q) => p - q)[a.length >> 1] / 255;
    const sideColor = band[0].length ? new THREE.Color().setRGB(mid(band[0]), mid(band[1]), mid(band[2]), THREE.SRGBColorSpace) : sil.color;
    const frontMat = clothMaterial({ map: photoTexture(front, sil, false), alphaMap: alpha, sheenColor, sideColor });
    // No usable back photo: a plain back in the garment's own colour, never another colour's print.
    const backMat = clothMaterial({ map: backSil ? photoTexture(backImg, backSil, true) : null, color: sideColor, alphaMap: alpha, sheenColor, sideColor });
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: alpha, alphaTest: 0.5, side: THREE.DoubleSide });

    for (const o of built) { o.geometry.dispose(); o.material.map?.dispose(); o.material.dispose(); group.remove(o); }
    built = [new THREE.Mesh(geo, frontMat), new THREE.Mesh(backGeo, backMat)];
    // Casts onto the floor only: self-shadowing makes the crossing at the side seams show as a dark line.
    for (const m of built) { m.castShadow = true; m.receiveShadow = false; m.customDepthMaterial = depthMat; }
    group.add(...built);
    group.position.x = 0;
    blob.scale.x = width / 1.8;
    // Stand the garment on the floor.
    group.children.forEach(m => (m.position.y = floorY + height / 2 + 0.04));
    target.y = floorY + height / 2 - 0.02;
    resize();
    return true;
  }

  return {
    build,
    setAngle: deg => (angle = deg),
    dispose() { alive = false; ro.disconnect(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
