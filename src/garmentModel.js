// Real 3D garments (CC BY models in /public/models, see credits in the footer) dressed with each
// product's own fabric colour and print, taken automatically from its flat mockup photos:
//   - fabric colour = median colour of the garment in the mockup
//   - print = the pixels that clearly differ from that fabric (in hue, or strongly in brightness),
//     cut out with soft alpha, then projected onto the chest/back of the model, scaled from the
//     torso width so it sits where it does on the real piece.
// Admins can upload the original print file to replace the automatic cut-out.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { silhouette, distance, loadImg } from './garment3d.js';

/* ---------------- print + fabric from a mockup photo ---------------- */
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const median = a => a.sort((p, q) => p - q)[a.length >> 1];

// Torso width + centre and the hem line (in the photo), used to place the print on the model.
function torsoOf({ mask, w, box }) {
  const { x0, y0, x1, y1 } = box, bh = y1 - y0 + 1, cx = Math.round((x0 + x1) / 2);
  const widths = [], centres = [];
  for (let y = Math.round(y0 + bh * 0.62); y <= y0 + bh * 0.9; y++) {
    if (!mask[y * w + cx]) continue;
    let a = cx, b = cx;
    while (a > 0 && mask[y * w + a - 1]) a--;
    while (b < w - 1 && mask[y * w + b + 1]) b++;
    widths.push(b - a + 1); centres.push((a + b) / 2);
  }
  return { width: widths.length ? median(widths) : (x1 - x0) * 0.6, centre: centres.length ? median(centres) : cx, hem: y1 };
}

const cache = new Map();
export async function analysePhoto(url) {
  if (cache.has(url)) return cache.get(url);
  const job = (async () => {
    const img = await loadImg(url);
    const sil = silhouette(img);
    if (!sil) return null; // model photo or busy background
    const { mask, px, w, h } = sil;
    const dist = distance(sil);
    // Fabric = median of the garment away from its edge shading.
    const ch = [[], [], []];
    for (let i = 0; i < w * h; i++) if (dist[i] > 8) for (let k = 0; k < 3; k++) ch[k].push(px[i * 4 + k]);
    const fabric = ch.map(median);
    const fl = lum(...fabric);
    // How strongly a pixel reads as "print" rather than fabric in light or shadow.
    const fn = Math.hypot(...fabric) || 1;
    const score = (r, g, b) => {
      const t = (r * fabric[0] + g * fabric[1] + b * fabric[2]) / (fn * fn); // shading factor
      const chroma = Math.hypot(r - fabric[0] * t, g - fabric[1] * t, b - fabric[2] * t);
      const dl = Math.abs(lum(r, g, b) - fl);
      // Colourless contrast only counts when it's ink-strong: fold and hood shadows on white fabric
      // are ~80-100 levels darker, real black/white ink is 150+.
      return Math.max(chroma / 42, dl > 115 ? dl / 150 : 0);
    };
    // Print area at mask resolution: keep sizeable blobs only (drops seams, labels, specks).
    const pm = new Uint8Array(w * h);
    let area = 0;
    for (let i = 0; i < w * h; i++) {
      if (mask[i] && dist[i] > 9 && score(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > 0.75) pm[i] = 1;
      area += mask[i];
    }
    // Blobs of print pixels; the print is the biggest one plus whatever sits close to it.
    // Far-away bits (drawcords, rib bands, labels) are dropped so they don't stretch the print.
    const seen = new Uint8Array(w * h), blobs = [];
    for (let i = 0; i < w * h; i++) {
      if (!pm[i] || seen[i]) continue;
      const q = [i], px_ = []; seen[i] = 1;
      let bx0 = w, by0 = h, bx1 = 0, by1 = 0, depth = 0;
      while (q.length) {
        const j = q.pop(); px_.push(j); depth += dist[j];
        const x = j % w, y = (j / w) | 0;
        bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        for (const n of [j - w, j + w, x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, j - w - 1, j - w + 1, j + w - 1, j + w + 1]) {
          if (n >= 0 && n < w * h && pm[n] && !seen[n]) { seen[n] = 1; q.push(n); }
        }
      }
      // Skip blobs that hug the outline: that's the photo's edge halo/shadow, not print.
      if (px_.length >= area * 0.0004 && depth / px_.length > 14) blobs.push({ px: px_, x0: bx0, y0: by0, x1: bx1, y1: by1 });
    }
    const torso = torsoOf(sil);
    const result = { fabric: new THREE.Color().setRGB(fabric[0] / 255, fabric[1] / 255, fabric[2] / 255, THREE.SRGBColorSpace), torso, print: null };
    if (!blobs.length) return result; // plain garment
    // Rank by size and by how central the blob sits on the torso: prints live on the chest/back,
    // highlights and rib shading sit at the cuffs, hem and sides.
    const { y0: gy0, y1: gy1 } = sil.box;
    const rank = b => {
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const across = (cx - torso.centre) / (torso.width / 2), down = (cy - gy0) / (gy1 - gy0);
      return Math.sqrt(b.px.length) * Math.exp(-across * across * 1.5) * (down > 0.9 ? 0.15 : 1);
    };
    blobs.sort((p, q) => rank(q) - rank(p));
    const near = torso.width * 0.12;
    let x0 = blobs[0].x0, y0 = blobs[0].y0, x1 = blobs[0].x1, y1 = blobs[0].y1;
    const kept = [blobs[0]];
    for (let grew = true; grew;) {
      grew = false;
      for (const b of blobs) {
        if (kept.includes(b) || b.x1 < x0 - near || b.x0 > x1 + near || b.y1 < y0 - near || b.y0 > y1 + near) continue;
        kept.push(b); grew = true;
        x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
      }
    }
    // Pixels allowed into the cut-out: the kept blobs, grown by 2px so soft edges survive.
    const keep = new Uint8Array(w * h);
    for (const b of kept) for (const j of b.px) {
      const x = j % w, y = (j / w) | 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) keep[yy * w + xx] = 1;
      }
    }

    // Cut the print out at full photo resolution with soft alpha.
    const pad = 3, s = img.width / w;
    const bx0 = Math.max(0, x0 - pad), by0 = Math.max(0, y0 - pad), bx1 = Math.min(w - 1, x1 + pad), by1 = Math.min(h - 1, y1 + pad);
    const cw = Math.round((bx1 - bx0 + 1) * s), chh = Math.round((by1 - by0 + 1) * s);
    const c = Object.assign(document.createElement('canvas'), { width: cw, height: chh });
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, bx0 * s, by0 * s, cw, chh, 0, 0, cw, chh);
    const d = ctx.getImageData(0, 0, cw, chh);
    for (let i = 0; i < cw * chh; i++) {
      const mx = Math.min(w - 1, Math.floor(bx0 + (i % cw) / s)), my = Math.min(h - 1, Math.floor(by0 + Math.floor(i / cw) / s));
      const inside = keep[my * w + mx] && mask[my * w + mx] && dist[my * w + mx] > 6;
      const v = inside ? score(d.data[i * 4], d.data[i * 4 + 1], d.data[i * 4 + 2]) : 0;
      d.data[i * 4 + 3] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.45) / 0.45)));
    }
    ctx.putImageData(d, 0, 0);
    result.print = { canvas: c, x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1 };
    return result;
  })().catch(() => null);
  cache.set(url, job);
  return job;
}

/* ---------------- the 3D models ---------------- */
const draco = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setDRACOLoader(draco);
const models = {};
const loadModel = type => (models[type] ||= loader.loadAsync(`/models/${type}.glb`).then(g => {
  let geo = null;
  g.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; });
  geo.computeBoundingBox();
  // Torso width on the model, measured just above the hem like on the photo.
  const p = geo.attributes.position, bb = geo.boundingBox, H = bb.max.y - bb.min.y;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), z = p.getZ(i);
    if (y > bb.min.y + H * 0.12 && y < bb.min.y + H * 0.3 && Math.abs(z) < 0.5) { lo = Math.min(lo, p.getX(i)); hi = Math.max(hi, p.getX(i)); }
  }
  return { geo, torsoW: hi - lo, torsoC: (hi + lo) / 2, hemY: bb.min.y };
}));

// Which model a product uses: admin override, else its category / name.
export function modelFor(product) {
  if (product.model3d === 'none') return null;
  if (product.model3d) return product.model3d;
  const n = `${product.category} ${product.name}`;
  if (/zip|jacket|varsity|cap|pant|jogger/i.test(n)) return null;
  if (/hood/i.test(n)) return 'hoodie';
  if (/sweatshirt|crew/i.test(n)) return 'sweatshirt';
  if (/tee|t-shirt|tshirt|shirt/i.test(n)) return 'tee';
  return null;
}

// Cloth with two projected prints. Projection is along the garment's depth axis in model space,
// gated by facing so the front print never bleeds onto the back.
function clothMaterial() {
  const uniforms = {
    frontMap: { value: null }, frontRect: { value: new THREE.Vector4(0, 0, 1, 1) }, hasFront: { value: 0 },
    backMap: { value: null }, backRect: { value: new THREE.Vector4(0, 0, 1, 1) }, hasBack: { value: 0 },
  };
  const m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, sheen: 0.35, sheenRoughness: 0.8, sheenColor: 0xffffff, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = position;\n  vObjNormal = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vObjPos;
varying vec3 vObjNormal;
uniform sampler2D frontMap; uniform vec4 frontRect; uniform float hasFront;
uniform sampler2D backMap; uniform vec4 backRect; uniform float hasBack;
vec4 decal(sampler2D map, vec4 rect, float mirror) {
  vec2 uv = vec2((vObjPos.x - rect.x) / rect.z * mirror + 0.5, (vObjPos.y - rect.y) / rect.w + 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
  return texture2D(map, uv);
}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  float facing = normalize(vObjNormal).z;
  if (gl_FrontFacing && hasFront > 0.5 && vObjPos.z > 0.0) {
    vec4 p = decal(frontMap, frontRect, 1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, p.rgb, p.a * smoothstep(0.05, 0.35, facing));
  }
  if (gl_FrontFacing && hasBack > 0.5 && vObjPos.z < 0.0) {
    vec4 p = decal(backMap, backRect, -1.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, p.rgb, p.a * smoothstep(0.05, 0.35, -facing));
  }
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.4;`);
  };
  m.userData.u = uniforms;
  return m;
}

const printTexture = canvas => {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

// Where a print from the photo lands on the model: same offset from the torso centre and hem,
// scaled by torso width.
function rectFor(print, photo, model) {
  const s = model.torsoW / photo.torso.width;
  const cx = ((print.x0 + print.x1) / 2 - photo.torso.centre) * s + model.torsoC;
  const cy = model.hemY + (photo.torso.hem - (print.y0 + print.y1) / 2) * s;
  return new THREE.Vector4(cx, cy, (print.x1 - print.x0) * s, (print.y1 - print.y0) * s);
}

export async function mountModel(host) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.append(renderer.domElement);

  // Studio like the reference: dark set, big soft key from the front-left, fill, and a rim.
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  const key = new THREE.DirectionalLight(0xfff6ec, 2.8);
  key.position.set(-2.4, 3, 3.2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6 });
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(2.8, 0.6, 2.2); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.4); rim.position.set(1.5, 2.2, -3.4); scene.add(rim);
  const kick = new THREE.DirectionalLight(0xff3b3b, 0.35); kick.position.set(-3, 0.2, -1.5); scene.add(kick);

  const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  const group = new THREE.Group();
  scene.add(group);
  const material = clothMaterial();
  const mesh = new THREE.Mesh(undefined, material);
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ opacity: 0.35 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  let width = 1.7;
  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit 2.0 units of height (and the model's width) with a little air.
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const dist = Math.max(1.2 / Math.tan(fov / 2), (width / 2 + 0.15) / (Math.tan(fov / 2) * camera.aspect));
    camera.position.set(0, 0.35, dist);
    camera.lookAt(0, -0.02, 0);
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let angle = 0, alive = true;
  const clock = new THREE.Clock();
  (function loop() {
    if (!alive) return;
    group.rotation.y = THREE.MathUtils.degToRad(angle);
    group.position.y = Math.sin(clock.getElapsedTime() * 1.2) * 0.015;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })();

  // type: 'tee' | 'hoodie' | 'sweatshirt'; front/back: mockup URLs; prints: optional uploaded
  // print files { front, back } that replace the automatic cut-outs.
  async function build({ type, front, back, prints = {} }) {
    const [model, f, b] = await Promise.all([loadModel(type), analysePhoto(front), back ? analysePhoto(back) : null]);
    if (!f) return false;
    mesh.geometry = model.geo;
    width = model.geo.boundingBox.max.x - model.geo.boundingBox.min.x;
    ground.position.y = model.hemY - 0.02;
    material.color.copy(f.fabric);
    // Sheen in the fabric's own tint: a white sheen would put a grey haze over dark colours.
    material.sheenColor.copy(f.fabric).multiplyScalar(1.4);
    const u = material.userData.u;
    for (const [side, photo, upload] of [['front', f, prints.front], ['back', b, prints.back]]) {
      const key = side === 'front' ? 'Front' : 'Back';
      u[side + 'Map'].value?.dispose();
      u['has' + key].value = 0;
      let print = photo?.print;
      if (upload && photo) { // an uploaded print file keeps the auto placement, just a sharper image
        const img = await loadImg(upload).catch(() => null);
        if (img && print) print = { ...print, canvas: Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }) }, print.canvas.getContext('2d').drawImage(img, 0, 0);
      }
      if (!print) continue;
      u[side + 'Map'].value = printTexture(print.canvas);
      u[side + 'Rect'].value = rectFor(print, photo, model);
      u['has' + key].value = 1;
    }
    resize();
    return true;
  }

  return { build, setAngle: d => (angle = d), dispose() { alive = false; ro.disconnect(); pmrem.dispose(); renderer.dispose(); renderer.domElement.remove(); } };
}
