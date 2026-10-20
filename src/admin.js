import { $, $$, esc, cssUrl } from './shop.js';

/* ---------- plumbing ---------- */
async function req(method, path, body) {
  const isForm = body instanceof FormData;
  const res = await fetch('/api/admin' + path, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : {},
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/me') { showLogin(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error(j.error || 'Request failed');
  return j;
}
let toastT;
function toast(t, err) {
  const el = $('.adm-toast');
  el.textContent = t; el.classList.toggle('err', !!err); el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2600);
}
const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const main = () => $('.adm-main');
let symbol = '$';

/* ---------- auth ---------- */
function showLogin() { $('.adm-app').hidden = true; $('.adm-login').hidden = false; }
$('.adm-login').addEventListener('submit', async e => {
  e.preventDefault();
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return ($('.adm-msg').textContent = j.error || 'Sign in failed');
  e.target.password.value = '';
  boot();
});
$('.adm-logout').addEventListener('click', async () => { await fetch('/api/admin/logout', { method: 'POST' }); showLogin(); });

async function boot() {
  let me;
  try { me = await req('GET', '/me'); } catch { return showLogin(); }
  $('.adm-login').hidden = true; $('.adm-app').hidden = false;
  const qkMode = me.qikinkBase.includes('sandbox') ? 'SANDBOX' : 'LIVE';
  $('.adm-status').innerHTML = `<span class="${me.razorpay ? 'ok' : 'no'}">RAZORPAY ${me.razorpay ? 'ON' : 'OFF'}</span><span class="${me.qikink ? 'ok' : 'no'}">QIKINK ${me.qikink ? qkMode : 'OFF'}</span>`;
  symbol = (await req('GET', '/settings')).symbol;
  go('products');
}
$$('.adm-tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  $$('.adm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ products: viewProducts, site: viewSite, orders: viewOrders, subscribers: viewSubs })[tab]();
}

/* ---------- image field (click or drop to upload) ---------- */
function imgField(label, value, onChange) {
  const el = h(`<div class="adm-img"><span>${esc(label)}</span><div class="adm-img-box"><button type="button" class="up">UPLOAD</button><button type="button" class="clr">CLEAR</button></div><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>`);
  const box = $('.adm-img-box', el), file = $('input', el);
  const set = v => { value = v; box.style.backgroundImage = v ? `${cssUrl(v)}, none` : ''; onChange(v); };
  set(value);
  const upload = async f => {
    if (!f) return;
    const fd = new FormData(); fd.append('file', f);
    try { set((await req('POST', '/upload', fd)).url); toast('IMAGE UPLOADED'); } catch (e) { toast(e.message, true); }
  };
  box.addEventListener('click', e => { if (!e.target.classList.contains('clr')) file.click(); });
  $('.clr', el).addEventListener('click', e => { e.stopPropagation(); set(''); });
  file.addEventListener('change', () => upload(file.files[0]));
  box.addEventListener('dragover', e => { e.preventDefault(); box.classList.add('drag'); });
  box.addEventListener('dragleave', () => box.classList.remove('drag'));
  box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('drag'); upload(e.dataTransfer.files[0]); });
  return el;
}

/* repeatable rows (sizes, specs, marquee) */
function rows(container, items, cols, blank) {
  const list = $('.adm-rows', container);
  const draw = () => {
    list.innerHTML = '';
    items.forEach((it, i) => {
      const row = h(`<div class="adm-row" style="grid-template-columns:${cols.map(c => c.w).join(' ')} auto"></div>`);
      cols.forEach(c => {
        const inp = h(`<input placeholder="${esc(c.ph)}" ${c.type ? `type="${c.type}" min="0"` : ''}>`);
        inp.value = it[c.k] ?? '';
        inp.addEventListener('input', () => (it[c.k] = c.type === 'number' ? +inp.value : inp.value));
        row.append(inp);
      });
      const del = h('<button type="button" aria-label="Remove">✕</button>');
      del.addEventListener('click', () => { items.splice(i, 1); draw(); });
      row.append(del);
      list.append(row);
    });
  };
  $('.adm-add', container).addEventListener('click', () => { items.push(blank()); draw(); });
  draw();
}

/* ---------- products ---------- */
async function viewProducts() {
  const products = await req('GET', '/products');
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">PRODUCTS</h1><button class="btn-red new">+ NEW PRODUCT</button></div>
    <p class="adm-note">Qikink has no catalogue API, so each size here carries the SKU of the matching product in your Qikink “My Products” list. Paid orders are sent to Qikink with those SKUs automatically.</p>
    <table class="adm-table"><thead><tr><th></th><th>NAME</th><th>PRICE</th><th class="hide-sm">STOCK</th><th class="hide-sm">QIKINK SKUs</th><th class="hide-sm">SHOWN IN</th><th>STATUS</th><th></th></tr></thead><tbody></tbody></table>`;
  const tb = $('tbody', main());
  for (const p of products) {
    const stock = p.sizes.reduce((t, s) => t + s.stock, 0);
    const skus = p.sizes.filter(s => s.sku).length;
    const tr = h(`<tr>
      <td><div class="adm-thumb" style="background-image:${esc(cssUrl(p.images.front))}"></div></td>
      <td><b>${esc(p.name)}</b> ${esc(p.edition)}<br><small>/${esc(p.slug)}</small></td>
      <td>${esc(symbol)}${p.price}</td>
      <td class="hide-sm">${stock ? stock : '<span class="adm-pill red">SOLD OUT</span>'}</td>
      <td class="hide-sm">${skus === p.sizes.length && skus ? `<span class="adm-pill green">${skus}/${p.sizes.length}</span>` : `<span class="adm-pill yel">${skus}/${p.sizes.length}</span>`}</td>
      <td class="hide-sm">${[p.featured && 'GRID', p.inRotation && 'RING'].filter(Boolean).join(' · ') || '—'}</td>
      <td>${p.active ? '<span class="adm-pill green">LIVE</span>' : '<span class="adm-pill grey">HIDDEN</span>'}</td>
      <td><button class="adm-link">EDIT</button></td></tr>`);
    $('button', tr).addEventListener('click', () => editProduct(p));
    tb.append(tr);
  }
  $('.new', main()).addEventListener('click', () => editProduct({
    name: '', edition: '', price: 0, category: '', badge: '', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: '', fitLabel: '', description: '',
    sizes: [{ label: 'M', stock: 1, sku: '' }], specs: [], images: { front: '', back: '', detail: '', onBody: '' }, tryonImage: '', ringLabel: '',
    featured: true, inRotation: true, active: false, sort: products.length + 1,
  }));
}

function editProduct(src) {
  const p = structuredClone(src);
  const f = (k, label, extra = '', note = '') => `<label class="adm-field ${extra}">${label}${note ? ` <small>${note}</small>` : ''}<input name="${k}" value="${esc(p[k])}"></label>`;
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">${p.id ? 'EDIT' : 'NEW'} PRODUCT</h1><button class="btn-ghost back">← ALL PRODUCTS</button></div>
    <form class="adm-form">
      ${f('name', 'NAME')}${f('slug', 'URL SLUG', '', 'blank = from name')}
      ${f('price', `PRICE (${esc(symbol)})`)}${f('edition', 'EDITION', '', 'e.g. /07')}
      ${f('category', 'CATEGORY')}${f('color', 'COLOUR')}
      ${f('fitLabel', 'FIT LABEL', '', 'e.g. FITS LIKE XL')}${f('tag', 'TAG')}
      ${f('badge', 'BADGE', '', 'e.g. 1 OF 1, LAST ONE')}
      <label class="adm-field">BADGE COLOUR<select name="badgeStyle"><option value="yellow">Yellow</option><option value="red">Red</option></select></label>
      ${f('ringLabel', 'RING PLACEHOLDER LABEL', '', 'shown when no image')}${f('sort', 'SORT ORDER', '', 'lower = first')}
      <label class="adm-field full">DESCRIPTION<textarea name="description">${esc(p.description)}</textarea></label>
      <div class="adm-field full sizes-box">SIZES · STOCK · QIKINK SKU<div class="adm-rows"></div><button type="button" class="adm-add">+ ADD SIZE</button></div>
      <div class="adm-field full specs-box">SPECS<div class="adm-rows"></div><button type="button" class="adm-add">+ ADD SPEC</button></div>
      <div class="adm-field full">IMAGES <small>Front shows on cards, ring and checkout. Try-on works best with a transparent PNG cut-out of the garment.</small><div class="adm-imgs"></div></div>
      <div class="adm-checks full adm-field"><label><input type="checkbox" name="active"> LIVE ON SITE</label><label><input type="checkbox" name="featured"> IN PRODUCT GRID</label><label><input type="checkbox" name="inRotation"> IN THE ROTATION RING</label></div>
      <div class="adm-actions">${p.id ? '<button type="button" class="adm-danger del">DELETE PRODUCT</button>' : '<span></span>'}<button class="btn-red">SAVE PRODUCT</button></div>
    </form>`;
  const form = $('.adm-form', main());
  form.badgeStyle.value = p.badgeStyle;
  ['active', 'featured', 'inRotation'].forEach(k => (form[k].checked = !!p[k]));
  rows($('.sizes-box', form), p.sizes, [{ k: 'label', ph: 'Size', w: '90px' }, { k: 'stock', ph: 'Stock', w: '90px', type: 'number' }, { k: 'sku', ph: 'Qikink SKU', w: '1fr' }], () => ({ label: '', stock: 1, sku: '' }));
  rows($('.specs-box', form), p.specs, [{ k: 'k', ph: 'Label', w: '160px' }, { k: 'v', ph: 'Value', w: '1fr' }], () => ({ k: '', v: '' }));
  const imgs = $('.adm-imgs', form);
  [['front', 'FRONT'], ['back', 'BACK'], ['detail', 'DETAIL'], ['onBody', 'ON BODY']].forEach(([k, l]) => imgs.append(imgField(l, p.images[k], v => (p.images[k] = v))));
  imgs.append(imgField('TRY-ON CUT-OUT', p.tryonImage, v => (p.tryonImage = v)));

  $('.back', main()).addEventListener('click', viewProducts);
  $('.del', main())?.addEventListener('click', async () => {
    if (!confirm(`Delete ${p.name}? This can't be undone.`)) return;
    await req('DELETE', '/products/' + p.id); toast('DELETED'); viewProducts();
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { ...p, ...fd, price: +fd.price, sort: +fd.sort, active: form.active.checked, featured: form.featured.checked, inRotation: form.inRotation.checked };
    try {
      const saved = await req(p.id ? 'PUT' : 'POST', '/products' + (p.id ? '/' + p.id : ''), body);
      toast('SAVED'); editProduct(saved);
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------- site content ---------- */
const SITE_FIELDS = [
  ['GLOBAL', [['currency', 'CURRENCY CODE', 'INR for Razorpay India; USD needs international payments enabled'], ['symbol', 'CURRENCY SYMBOL'], ['shippingFee', 'SHIPPING FEE'], ['freeShippingOver', 'FREE SHIPPING OVER', '0 = never free']]],
  ['HEADER & HERO', [['liveLabel', 'LIVE LABEL'], ['dropLabel', 'DROP NAME'], ['kicker', 'HERO KICKER'], ['mobileKicker', 'MOBILE KICKER'], ['heroTitle', 'HEADLINE'], ['heroAccent', 'HEADLINE ACCENT'], ['heroText', 'HERO TEXT', '', 'textarea'], ['ctaLabel', 'MAIN BUTTON'], ['secondaryCta', 'SECOND BUTTON'], ['countdownLabel', 'COUNTDOWN LABEL'], ['countdownTarget', 'NEXT DROP DATE & TIME', '', 'datetime']]],
  ['SECTIONS & FOOTER', [['rotationTitle', 'RING TITLE'], ['signupTitle', 'SIGN-UP TITLE'], ['footerWord', 'FOOTER WORDMARK']]],
];
async function viewSite() {
  const s = await req('GET', '/settings');
  const input = ([k, label, note, kind]) => {
    let v = s[k];
    if (kind === 'datetime') { const d = new Date(v); v = isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }
    const ctl = kind === 'textarea' ? `<textarea name="${k}">${esc(v)}</textarea>` : `<input name="${k}" ${kind === 'datetime' ? 'type="datetime-local"' : ''} value="${esc(v)}">`;
    return `<label class="adm-field">${label}${note ? ` <small>${esc(note)}</small>` : ''}${ctl}</label>`;
  };
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">SITE CONTENT</h1></div>
    <form class="adm-form">
      ${SITE_FIELDS.map(([g, fields]) => `<h2 class="adm-field full" style="font-size:12px;color:var(--yel)">${g}</h2>${fields.map(input).join('')}`).join('')}
      <div class="adm-field full marquee-box">MARQUEE ITEMS<div class="adm-rows"></div><button type="button" class="adm-add">+ ADD ITEM</button></div>
      <h2 class="adm-field full" style="font-size:12px;color:var(--yel)">GRAPHICS</h2>
      <div class="adm-field full">HERO GRAPHIC <small>Replaces the 3D bolt. Leave empty to keep the bolt. Transparent PNG recommended.</small><div class="adm-imgs"></div></div>
      <h2 class="adm-field full" style="font-size:12px;color:var(--yel)">SOCIAL LINKS</h2>
      ${['instagram', 'tiktok', 'discord'].map(k => `<label class="adm-field">${k.toUpperCase()}<input name="social_${k}" placeholder="https://" value="${esc(s.socials?.[k])}"></label>`).join('')}
      <div class="adm-actions"><span></span><button class="btn-red">SAVE SITE CONTENT</button></div>
    </form>`;
  const form = $('.adm-form', main());
  const marquee = s.marquee.map(t => ({ t }));
  rows($('.marquee-box', form), marquee, [{ k: 't', ph: 'Text', w: '1fr' }], () => ({ t: '' }));
  $('.adm-imgs', form).append(imgField('HERO', s.heroImage, v => (s.heroImage = v)));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { ...s, ...fd, marquee: marquee.map(m => m.t), socials: { instagram: fd.social_instagram, tiktok: fd.social_tiktok, discord: fd.social_discord } };
    if (fd.countdownTarget) body.countdownTarget = new Date(fd.countdownTarget).toISOString();
    try { const saved = await req('PUT', '/settings', body); symbol = saved.symbol; toast('SAVED — LIVE ON SITE'); } catch (err) { toast(err.message, true); }
  });
}

/* ---------- orders ---------- */
const STATUS = { created: ['AWAITING PAYMENT', 'grey'], paid: ['PAID', 'yel'], sent_to_qikink: ['SENT TO QIKINK', 'green'], fulfillment_failed: ['FULFILMENT FAILED', 'red'] };
async function viewOrders() {
  const orders = await req('GET', '/orders');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">ORDERS</h1><button class="btn-ghost qk">CHECK QIKINK</button></div>
    <p class="adm-note">Paid orders go to Qikink automatically. If one fails (missing SKU, Qikink down), fix the cause and press RETRY. “Awaiting payment” orders are abandoned checkouts.</p>
    <div class="list">${orders.length ? '' : '<p class="adm-note">No orders yet.</p>'}</div><pre class="adm-note qk-out"></pre>`;
  const list = $('.list', main());
  for (const o of orders) {
    const [label, color] = STATUS[o.status] || [o.status, 'grey'];
    const c = o.customer;
    const el = h(`<details class="adm-order"><summary><span>${esc(o.number)}</span><span>${new Date(o.createdAt).toLocaleString()}</span><span>${esc(c.name)} · ${esc(c.city)}</span><span>${esc(symbol)}${o.amount}</span><span class="adm-pill ${color}">${label}</span></summary>
      <div class="adm-order-body">
        <div>${o.items.map(i => `${i.qty} × ${esc(i.name)} (${esc(i.size)}) — ${esc(symbol)}${i.price} <small>${i.sku ? 'SKU ' + esc(i.sku) : '<span class="red">NO SKU</span>'}</small>`).join('<br>')}
          <br>Shipping: ${esc(symbol)}${o.shipping}${o.oversold ? '<br><span class="red">OVERSOLD — refund one buyer in Razorpay</span>' : ''}
          ${o.paymentId ? `<br>Payment: ${esc(o.paymentId)}` : ''}${o.fulfillmentError ? `<br><span class="red">${esc(o.fulfillmentError)}</span>` : ''}
          ${o.status === 'fulfillment_failed' ? '<br><br><button class="btn-red retry">RETRY SEND TO QIKINK</button>' : ''}</div>
        <div>${esc(c.name)}<br>${esc(c.address1)}${c.address2 ? '<br>' + esc(c.address2) : ''}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.zip)}<br>${esc(c.phone)} · ${esc(c.email)}
          ${o.qikink ? `<pre>${esc(JSON.stringify(o.qikink, null, 1))}</pre>` : ''}</div>
      </div></details>`);
    $('.retry', el)?.addEventListener('click', async () => {
      try { const r = await req('POST', `/orders/${o.id}/fulfill`); toast(r.status === 'sent_to_qikink' ? 'SENT TO QIKINK' : r.fulfillmentError, r.status !== 'sent_to_qikink'); viewOrders(); } catch (e) { toast(e.message, true); }
    });
    list.append(el);
  }
  $('.qk', main()).addEventListener('click', async () => {
    try { $('.qk-out', main()).textContent = 'Orders on Qikink:\n' + JSON.stringify(await req('GET', '/qikink/orders'), null, 2); } catch (e) { toast(e.message, true); }
  });
}

/* ---------- subscribers ---------- */
async function viewSubs() {
  const subs = await req('GET', '/subscribers');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">DROP ALERT LIST</h1><button class="btn-ghost csv">DOWNLOAD CSV</button></div>
    <table class="adm-table"><thead><tr><th>EMAIL</th><th>SIGNED UP</th></tr></thead><tbody>${subs.map(s => `<tr><td>${esc(s.email)}</td><td>${new Date(s.at).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="2">Nobody yet.</td></tr>'}</tbody></table>`;
  $('.csv', main()).addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['email,signed_up\n' + subs.map(s => `${s.email},${s.at}`).join('\n')], { type: 'text/csv' }));
    a.download = 'thryftly-subscribers.csv'; a.click();
  });
}

boot();
