import { $, $$, esc, cssUrl } from './shop.js';
import { invoiceHtml } from './invoice.js';
import invoiceCss from './invoice.css?inline';

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
// Download rows as a CSV file (Excel-friendly).
function csv(name, rows) {
  const cell = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\n')], { type: 'text/csv' }));
  a.download = name; a.click();
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
  $('.adm-status').innerHTML = `<span class="${me.razorpay ? 'ok' : 'no'}">RAZORPAY ${me.razorpay ? 'ON' : 'OFF'}</span><span class="${me.qikink ? 'ok' : 'no'}">QIKINK ${me.qikink ? qkMode : 'OFF'}</span><span class="${me.mail ? 'ok' : 'no'}">EMAIL ${me.mail ? 'ON' : 'OFF'}</span>`;
  symbol = (await req('GET', '/settings')).symbol;
  go('overview');
}
$$('.adm-tabs button').forEach(b => b.addEventListener('click', () => go(b.dataset.tab)));
function go(tab) {
  $$('.adm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ({ overview: viewOverview, discounts: viewDiscounts, charts: viewCharts, customers: viewCustomers, products: viewProducts, drops: viewDrops, site: viewSite, pages: viewPages, messages: viewMessages, orders: viewOrders, subscribers: viewSubs, returns: viewReturns, reviews: viewReviews, waitlist: viewWaitlist })[tab]();
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
  return draw;
}

/* ---------- overview ---------- */
async function viewOverview() {
  const o = await req('GET', '/overview');
  const card = (label, value, note = '', tab = '') => `<button class="adm-stat" ${tab ? `data-go="${tab}"` : 'disabled'}><small>${label}</small><b>${value}</b>${note ? `<i>${note}</i>` : ''}</button>`;
  const m = v => esc(symbol) + Math.round(v).toLocaleString('en-IN');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">OVERVIEW</h1></div>
    <div class="adm-stats">
      ${card('SALES TODAY', m(o.today.revenue), `${o.today.orders} paid orders`, 'orders')}
      ${card('LAST 30 DAYS', m(o.month.revenue), `${o.month.orders} paid orders`, 'orders')}
      ${card('NEEDS ATTENTION', o.failed, 'paid orders that did not reach Qikink', 'orders')}
      ${card('UNREAD MESSAGES', o.unread, '', 'messages')}
      ${card('LIVE PRODUCTS', o.live, `${o.hidden} hidden`, 'products')}
      ${card('MISSING SKUs', o.noSku, 'live products with a variant that cannot be ordered', 'products')}
      ${card('DROP ALERT LIST', o.subscribers, 'emails', 'subscribers')}
      ${card('LIVE DROP', o.drop ? esc(o.drop) : 'NONE', '', 'drops')}
      ${card('EXCHANGE REQUESTS', o.returns, 'waiting for your decision', 'returns')}
      ${card('REVIEWS TO CHECK', o.reviews, 'from emails that never ordered the piece', 'reviews')}
      ${card('WAITING FOR RESTOCK', o.waiting, 'back-in-stock emails queued', 'waitlist')}
    </div>
    <h2 class="adm-h" style="font-size:16px;margin:28px 0 12px">LATEST ORDERS</h2>
    <table class="adm-table"><thead><tr><th>ORDER</th><th>WHEN</th><th>CUSTOMER</th><th>TOTAL</th><th>STATUS</th></tr></thead><tbody>
      ${o.latest.map(x => `<tr><td>${esc(x.number)}</td><td>${new Date(x.createdAt).toLocaleString()}</td><td>${esc(x.name)}</td><td>${m(x.amount)}</td><td><span class="adm-pill ${(STATUS[x.status] || [])[1] || 'grey'}">${esc((STATUS[x.status] || [x.status])[0])}</span></td></tr>`).join('') || '<tr><td colspan="5">No orders yet.</td></tr>'}
    </tbody></table>`;
  main().querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
}

/* ---------- products ---------- */
async function viewProducts() {
  const products = await req('GET', '/products');
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">PRODUCTS</h1><div style="display:flex;gap:12px"><label class="btn-ghost">IMPORT SHOPIFY CSV<input type="file" accept=".csv,text/csv" class="shopify" hidden></label><label class="btn-ghost">IMPORT QIKINK CSV<input type="file" accept=".csv,text/csv" class="csv" hidden></label><button class="btn-red new">+ NEW PRODUCT</button></div></div>
    <p class="adm-note">Qikink has no catalogue API. Moving from Shopify: export Products → CSV in Shopify and import it here. Colours, sizes, Qikink SKUs, prices and every image come across, and images are copied to this server. (Qikink's own CSV has no colours, SKUs or images, so it only creates hidden drafts.) A variant without a SKU can't be bought. Paid orders go to Qikink automatically.</p>
    <div class="adm-filter"><input class="q" type="search" placeholder="Search name, slug or SKU"><select class="cat"><option value="">All categories</option>${[...new Set(products.map(p => p.category).filter(Boolean))].sort().map(c => `<option>${esc(c)}</option>`).join('')}</select>
      <select class="st"><option value="">Any status</option><option value="live">Live</option><option value="hidden">Hidden</option><option value="nosku">Missing SKUs</option><option value="soldout">Sold out</option><option value="ring">In the ring</option></select><span class="cnt"></span></div>
    <div class="adm-bulk" hidden><b class="n"></b> SELECTED <button data-set='{"active":true}'>MAKE LIVE</button><button data-set='{"active":false}'>HIDE</button><button data-set='{"inRotation":true}'>ADD TO RING</button><button data-set='{"inRotation":false}'>REMOVE FROM RING</button><button data-set='{"featured":true}'>SHOW IN GRID</button><button data-set='{"featured":false}'>HIDE FROM GRID</button><button class="none">CLEAR</button></div>
    <table class="adm-table"><thead><tr><th><input type="checkbox" class="all" aria-label="Select all shown"></th><th></th><th>NAME</th><th>PRICE</th><th class="hide-sm">STOCK</th><th class="hide-sm">QIKINK SKUs</th><th class="hide-sm">SHOWN IN</th><th>STATUS</th><th></th></tr></thead><tbody></tbody></table>`;
  const tb = $('tbody', main()), picked = new Set();
  const shown = () => {
    const q = $('.q', main()).value.trim().toLowerCase(), cat = $('.cat', main()).value, st = $('.st', main()).value;
    return products.filter(p => {
      const stock = p.sizes.reduce((t, s) => t + s.stock, 0);
      if (q && !(p.name.toLowerCase().includes(q) || p.slug.includes(q) || p.sizes.some(s => s.sku?.toLowerCase().includes(q)))) return false;
      if (cat && p.category !== cat) return false;
      return !st || { live: p.active, hidden: !p.active, nosku: p.sizes.some(s => !s.sku), soldout: !stock, ring: p.inRotation }[st];
    });
  };
  const draw = () => {
    tb.innerHTML = '';
    const list = shown();
    $('.cnt', main()).textContent = `${list.length} OF ${products.length}`;
    $('.all', main()).checked = list.length > 0 && list.every(p => picked.has(p.id));
    for (const p of list) tb.append(row(p));
    $('.adm-bulk', main()).hidden = !picked.size;
    $('.adm-bulk .n', main()).textContent = picked.size;
  };
  const row = p => {
    const stock = p.sizes.reduce((t, s) => t + s.stock, 0);
    const skus = p.sizes.filter(s => s.sku).length;
    const tr = h(`<tr>
      <td><input type="checkbox" class="pick" ${picked.has(p.id) ? 'checked' : ''} aria-label="Select ${esc(p.name)}"></td>
      <td><div class="adm-thumb" style="background-image:${esc(cssUrl(p.images.front))}"></div></td>
      <td><b>${esc(p.name)}</b> ${esc(p.edition)}<br><small>/${esc(p.slug)}</small></td>
      <td>${esc(symbol)}${p.price}</td>
      <td class="hide-sm">${stock ? stock : '<span class="adm-pill red">SOLD OUT</span>'}</td>
      <td class="hide-sm">${skus === p.sizes.length && skus ? `<span class="adm-pill green">${skus}/${p.sizes.length}</span>` : `<span class="adm-pill yel">${skus}/${p.sizes.length}</span>`}</td>
      <td class="hide-sm">${[p.featured && 'GRID', p.inRotation && 'RING'].filter(Boolean).join(' · ') || '—'}</td>
      <td>${p.active ? '<span class="adm-pill green">LIVE</span>' : '<span class="adm-pill grey">HIDDEN</span>'}</td>
      <td><button class="adm-link">EDIT</button></td></tr>`);
    $('button', tr).addEventListener('click', () => editProduct(p));
    $('.pick', tr).addEventListener('change', e => { e.target.checked ? picked.add(p.id) : picked.delete(p.id); draw(); });
    return tr;
  };
  ['.q', '.cat', '.st'].forEach(sel => $(sel, main()).addEventListener('input', draw));
  $('.all', main()).addEventListener('change', e => { for (const p of shown()) e.target.checked ? picked.add(p.id) : picked.delete(p.id); draw(); });
  $('.adm-bulk', main()).addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('none')) { picked.clear(); return draw(); }
    const set = JSON.parse(b.dataset.set);
    try {
      const r = await req('PATCH', '/products', { ids: [...picked], set });
      for (const p of products) if (picked.has(p.id)) Object.assign(p, set);
      toast(`UPDATED ${r.changed} PRODUCTS`); draw();
    } catch (err) { toast(err.message, true); }
  });
  draw();
  $('.shopify', main()).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    toast('IMPORTING — COPYING IMAGES FROM SHOPIFY, THIS CAN TAKE A FEW MINUTES…');
    try {
      const r = await fetch('/api/admin/import/shopify', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await f.text() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      toast(`ADDED ${j.added} · UPDATED ${j.updated} · ${j.images} IMAGES COPIED${j.imagesFailed ? ` · ${j.imagesFailed} FAILED` : ''}`, !!j.imagesFailed);
      viewProducts();
    } catch (err) { toast(err.message, true); }
  });
  $('.csv', main()).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await fetch('/api/admin/import/qikink', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: await f.text() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      toast(`IMPORTED ${j.added} · ALREADY HERE ${j.skipped}`); viewProducts();
    } catch (err) { toast(err.message, true); }
  });
  $('.new', main()).addEventListener('click', () => editProduct({
    sizeChart: '', seoTitle: '', seoDescription: '', googleCategory: '',
    name: '', edition: '', price: 0, category: '', badge: '', badgeStyle: 'yellow', tag: 'REWORKED VINTAGE', color: '', fitLabel: '', description: '',
    sizes: [{ label: 'M', color: '', stock: 1, sku: '' }], specs: [], images: { front: '', back: '', detail: '', onBody: '' }, tryonImage: '', ringLabel: '',
    featured: true, inRotation: true, active: false, sort: products.length + 1,
  }));
}

async function editProduct(src) {
  const p = structuredClone(src);
  const charts = await req('GET', '/size-charts');
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
      <label class="adm-field">3D MODEL <small>automatic picks it from the category</small><select name="model3d"><option value="">Automatic</option><option value="tee">T-shirt</option><option value="hoodie">Hoodie</option><option value="sweatshirt">Sweatshirt</option><option value="none">No 3D model</option></select></label>
      ${f('ringLabel', 'RING PLACEHOLDER LABEL', '', 'shown when no image')}${f('sort', 'SORT ORDER', '', 'lower = first')}
      <label class="adm-field">SIZE CHART <small>automatic picks it from the category, name and description</small><select name="sizeChart"><option value="">Automatic${p.chartAuto ? ' (' + esc(charts.find(c => c.key === p.chartAuto)?.title || p.chartAuto) + ')' : ' (none)'}</option>${charts.map(c => `<option value="${esc(c.key)}">${esc(c.title)}</option>`).join('')}<option value="none">No size chart</option></select></label>
      ${f('googleCategory', 'GOOGLE PRODUCT CATEGORY', '', 'number, e.g. 212 = shirts &amp; tops')}
      ${f('seoTitle', 'SEO TITLE', '', 'Google + link previews; blank = name')}${f('seoDescription', 'SEO DESCRIPTION', '', 'blank = description')}
      <label class="adm-field full">DESCRIPTION<textarea name="description">${esc(p.description)}</textarea></label>
      ${p.qikink ? `<p class="adm-note full" style="grid-column:1/-1;margin:0">QIKINK #${esc(p.qikink.productId)} · ${esc(p.qikink.baseCode)} · ${p.qikink.colors} colours · ${p.qikink.variants} variants on Qikink · cost ${esc(symbol)}${p.qikink.cost} → margin <b class="margin"></b></p>` : ''}
      <div class="adm-field full sizes-box">VARIANTS — COLOUR · SIZE · STOCK · PRICE · WAS · QIKINK SKU <small>Leave colour empty if the product has one colour. Stock 999 = print on demand. *Price only if this variant costs more than the product price. WAS = the crossed-out price shown next to it (blank = no sale).</small>
        <div class="adm-row" style="grid-template-columns:1fr auto;margin:6px 0"><input class="gen-colors" placeholder="Colours, comma separated (e.g. Black, Bone, Red)"><button type="button" class="gen">MAKE COLOUR × SIZE ROWS</button></div>
        <div class="adm-rows"></div><button type="button" class="adm-add">+ ADD VARIANT</button></div>
      <div class="adm-field full specs-box">SPECS<div class="adm-rows"></div><button type="button" class="adm-add">+ ADD SPEC</button></div>
      <div class="adm-field full">IMAGES <small>Front shows on cards, ring and checkout. Each colour can have its own front and back photo, shown when a customer picks that colour (save and reopen after adding colours). A colour with no back photo gets a plain back in its own colour. Try-on works best with a transparent PNG cut-out. The 3D view cuts each print out of the mockups automatically; upload the original print PNG (the file you give Qikink) to make it sharper.</small><div class="adm-imgs"></div></div>
      <div class="adm-checks full adm-field"><label><input type="checkbox" name="active"> LIVE ON SITE</label><label><input type="checkbox" name="featured"> IN PRODUCT GRID</label><label><input type="checkbox" name="inRotation"> IN THE ROTATION RING</label></div>
      <div class="adm-actions">${p.id ? '<button type="button" class="adm-danger del">DELETE PRODUCT</button>' : '<span></span>'}<button class="btn-red">SAVE PRODUCT</button></div>
    </form>`;
  const form = $('.adm-form', main());
  form.badgeStyle.value = p.badgeStyle;
  form.model3d.value = p.model3d || '';
  form.sizeChart.value = p.sizeChart || '';
  ['active', 'featured', 'inRotation'].forEach(k => (form[k].checked = !!p[k]));
  const drawVariants = rows($('.sizes-box', form), p.sizes, [{ k: 'color', ph: 'Colour', w: '120px' }, { k: 'label', ph: 'Size', w: '70px' }, { k: 'stock', ph: 'Stock', w: '80px', type: 'number' }, { k: 'price', ph: 'Price*', w: '80px', type: 'number' }, { k: 'compare', ph: 'Was', w: '80px', type: 'number' }, { k: 'sku', ph: 'Qikink SKU', w: '1fr' }], () => ({ color: '', label: '', stock: 999, sku: '', price: 0, compare: 0 }));
  // Expand colours × existing sizes, keeping any SKUs already typed in.
  $('.gen', form).addEventListener('click', () => {
    const colors = $('.gen-colors', form).value.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
    const sizes = [...new Set(p.sizes.map(v => v.label))];
    if (!colors.length || !sizes.length) return toast('Add at least one size row and type the colours', true);
    const old = p.sizes.splice(0);
    for (const c of colors) for (const z of sizes) p.sizes.push(old.find(v => v.color === c && v.label === z) || { color: c, label: z, stock: old.find(v => v.label === z)?.stock ?? 999, sku: '' });
    drawVariants();
  });
  if (p.qikink) {
    const m = () => { const pr = +form.price.value, c = p.qikink.cost; $('.margin', form).textContent = `${symbol}${(pr - c).toFixed(0)} (${pr ? Math.round((pr - c) / pr * 100) : 0}%)`; };
    form.price.addEventListener('input', m); m();
  }
  rows($('.specs-box', form), p.specs, [{ k: 'k', ph: 'Label', w: '160px' }, { k: 'v', ph: 'Value', w: '1fr' }], () => ({ k: '', v: '' }));
  const imgs = $('.adm-imgs', form);
  [['front', 'FRONT'], ['back', 'BACK'], ['detail', 'DETAIL'], ['onBody', 'ON BODY']].forEach(([k, l]) => imgs.append(imgField(l, p.images[k], v => (p.images[k] = v))));
  imgs.append(imgField('TRY-ON CUT-OUT', p.tryonImage, v => (p.tryonImage = v)));
  // Optional original print files: replace the print the 3D viewer cuts out of the mockups.
  imgs.append(imgField('PRINT FILE — FRONT', p.printFront, v => (p.printFront = v)));
  imgs.append(imgField('PRINT FILE — BACK', p.printBack, v => (p.printBack = v)));
  p.colorImages ||= {};
  p.colorBacks ||= {};
  for (const c of [...new Set(p.sizes.map(v => v.color).filter(Boolean))]) {
    imgs.append(imgField(`${c} — FRONT`, p.colorImages[c], v => (p.colorImages[c] = v)));
    imgs.append(imgField(`${c} — BACK`, p.colorBacks[c], v => (p.colorBacks[c] = v)));
  }

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
      toast(saved.alerted ? `SAVED · ${saved.alerted} BACK-IN-STOCK EMAIL${saved.alerted > 1 ? 'S' : ''} SENT` : 'SAVED'); editProduct(saved);
    } catch (err) { toast(err.message, true); }
  });
}

/* ---------- drops ---------- */
const local = iso => { const d = new Date(iso); return isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
function dropState(d) {
  const now = Date.now();
  if (!d.active) return ['OFF', 'grey'];
  if (d.endsAt && Date.parse(d.endsAt) < now) return ['ENDED', 'grey'];
  if (d.startsAt && Date.parse(d.startsAt) > now) return ['COMING SOON', 'yel'];
  return ['LIVE', 'green'];
}
async function viewDrops() {
  const drops = await req('GET', '/drops');
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">DROPS</h1><button class="btn-red new">+ NEW DROP</button></div>
    <p class="adm-note">A drop is a special release. Switch one on and it gets its own section on the home page, the hero shows its name and countdown, and the header marks it live. Before its opening time its products can be seen but not bought. After its end time it disappears by itself and its products stay in the shop. With no drop on, none of this shows.</p>
    <table class="adm-table"><thead><tr><th>DROP</th><th>OPENS</th><th>ENDS</th><th>PRODUCTS</th><th>STATUS</th><th></th></tr></thead><tbody></tbody></table>
    ${drops.length ? '' : '<p class="adm-note" style="margin-top:16px">No drops yet.</p>'}`;
  for (const d of drops) {
    const [label, color] = dropState(d);
    const tr = h(`<tr><td><b>${esc(d.name)}</b><br><small>${esc(d.tagline)}</small></td><td>${d.startsAt ? new Date(d.startsAt).toLocaleString() : 'now'}</td><td>${d.endsAt ? new Date(d.endsAt).toLocaleString() : 'no end'}</td><td>${d.productIds.length}</td><td><span class="adm-pill ${color}">${label}</span></td><td><button class="adm-link">EDIT</button></td></tr>`);
    $('button', tr).addEventListener('click', () => editDrop(d));
    $('tbody', main()).append(tr);
  }
  $('.new', main()).addEventListener('click', () => editDrop({ name: '', tagline: '', description: '', banner: '', startsAt: '', endsAt: '', active: false, productIds: [] }));
}

async function editDrop(src) {
  const d = structuredClone(src);
  const products = await req('GET', '/products');
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">${d.id ? 'EDIT' : 'NEW'} DROP</h1><button class="btn-ghost back">← ALL DROPS</button></div>
    <form class="adm-form">
      <label class="adm-field">NAME <small>e.g. DROP 08</small><input name="name" value="${esc(d.name)}" required></label>
      <label class="adm-field">TAGLINE <small>shown in the hero, e.g. STATIC SEASON // 300 UNITS</small><input name="tagline" value="${esc(d.tagline)}"></label>
      <label class="adm-field">OPENS <small>empty = open now; before this, products can't be bought</small><input type="datetime-local" name="startsAt" value="${local(d.startsAt)}"></label>
      <label class="adm-field">ENDS <small>empty = runs until you switch it off</small><input type="datetime-local" name="endsAt" value="${local(d.endsAt)}"></label>
      <label class="adm-field full">DESCRIPTION<textarea name="description">${esc(d.description)}</textarea></label>
      <div class="adm-field full">BANNER IMAGE <small>optional, shown behind the drop section</small><div class="adm-imgs"></div></div>
      <div class="adm-field full">PRODUCTS IN THIS DROP <small><span class="count"></span> selected</small>
        <input class="pick-search" placeholder="Search products">
        <div class="adm-pick"></div></div>
      <div class="adm-checks full adm-field"><label><input type="checkbox" name="active"> DROP IS ON</label></div>
      <div class="adm-actions">${d.id ? '<button type="button" class="adm-danger del">DELETE DROP</button>' : '<span></span>'}<button class="btn-red">SAVE DROP</button></div>
    </form>`;
  const form = $('.adm-form', main());
  form.active.checked = !!d.active;
  $('.adm-imgs', form).append(imgField('BANNER', d.banner, v => (d.banner = v)));
  const picked = new Set(d.productIds);
  const drawPick = () => {
    const q = $('.pick-search', form).value.trim().toLowerCase();
    // Selected first, then the rest; the search filters both.
    const list = [...products].filter(p => !q || p.name.toLowerCase().includes(q)).sort((a, b) => picked.has(b.id) - picked.has(a.id));
    $('.adm-pick', form).innerHTML = list.map(p => `<label class="adm-pick-item${picked.has(p.id) ? ' on' : ''}"><input type="checkbox" value="${p.id}" ${picked.has(p.id) ? 'checked' : ''}>
      <span class="adm-thumb" style="background-image:${esc(cssUrl(p.images.front))}"></span><span>${esc(p.name)}<br><small>${esc(symbol)}${p.price}${p.active ? '' : ' · hidden'}</small></span></label>`).join('');
    $('.count', form).textContent = picked.size;
  };
  $('.adm-pick', form).addEventListener('change', e => { e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value); drawPick(); });
  $('.pick-search', form).addEventListener('input', drawPick);
  drawPick();
  $('.back', main()).addEventListener('click', viewDrops);
  $('.del', main())?.addEventListener('click', async () => { if (confirm(`Delete ${d.name}?`)) { await req('DELETE', '/drops/' + d.id); toast('DELETED'); viewDrops(); } });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { ...d, ...fd, active: form.active.checked, productIds: [...picked],
      startsAt: fd.startsAt ? new Date(fd.startsAt).toISOString() : '', endsAt: fd.endsAt ? new Date(fd.endsAt).toISOString() : '' };
    try { const saved = await req(d.id ? 'PUT' : 'POST', '/drops' + (d.id ? '/' + d.id : ''), body); toast('SAVED'); editDrop(saved); } catch (err) { toast(err.message, true); }
  });
}

/* ---------- site content ---------- */
const SITE_FIELDS = [
  ['GLOBAL', [['currency', 'CURRENCY CODE', 'INR for Razorpay India; USD needs international payments enabled'], ['symbol', 'CURRENCY SYMBOL'], ['shippingFee', 'SHIPPING FEE'], ['freeShippingOver', 'FREE SHIPPING OVER', '0 = never free']]],
  ['HERO', [['kicker', 'HERO KICKER', 'small line above the headline (a live drop replaces it)'], ['mobileKicker', 'MOBILE KICKER'], ['heroTitle', 'HEADLINE'], ['heroAccent', 'HEADLINE ACCENT'], ['heroText', 'HERO TEXT', '', 'textarea'], ['ctaLabel', 'MAIN BUTTON'], ['secondaryCta', 'SECOND BUTTON']]],
  ['SECTIONS & FOOTER', [['rotationTitle', 'RING TITLE'], ['productsTitle', 'PRODUCTS HEADING'], ['signupTitle', 'SIGN-UP TITLE'], ['footerWord', 'FOOTER WORDMARK']]],
  ['DELIVERY PROMISE', [['dispatchMin', 'PRINT + DISPATCH, MIN DAYS', 'business days', 'number'], ['dispatchMax', 'PRINT + DISPATCH, MAX DAYS', '', 'number'], ['deliveryMin', 'COURIER, MIN DAYS', 'shown as "get it by" on product pages and checkout', 'number'], ['deliveryMax', 'COURIER, MAX DAYS', '', 'number']]],
  ['EXCHANGES & REVIEWS', [['exchangeDays', 'EXCHANGE WINDOW (DAYS)', 'after delivery; 0 turns the exchange page off', 'number'], ['reviewsAutoPublish', 'PUBLISH VERIFIED REVIEWS AT ONCE', 'reviews from people who bought the piece; others wait in Reviews', 'bool']]],
  ['WHATSAPP & POPUP', [['whatsappButton', 'FLOATING WHATSAPP BUTTON', 'uses the WhatsApp number under Contact details', 'bool'], ['popupOn', 'SIGN-UP POPUP FOR NEW VISITORS', 'once per visitor; shows the welcome code after they join', 'bool'], ['popupDelay', 'POPUP DELAY (SECONDS)', '', 'number'], ['popupTitle', 'POPUP HEADLINE'], ['popupText', 'POPUP TEXT', '', 'textarea']]],
  ['INVOICES', [['legalName', 'LEGAL BUSINESS NAME', 'printed on invoices'], ['gstin', 'GSTIN', 'leave blank if not GST-registered'], ['gstRate', 'GST RATE %', 'included in prices; 0 = no tax breakdown. Check the right rate with your accountant', 'number']]],
  ['EMAILS', [['welcomeCode', 'WELCOME CODE', 'shown in the welcome emails (new account, drop list). Create it under Discounts, e.g. WELCOME10'], ['reminderCode', 'CART REMINDER CODE', 'shown in the "you left something behind" email; blank = no code']]],
  ['ANALYTICS', [['ga4Id', 'GOOGLE ANALYTICS 4 ID', 'G-XXXXXXX'], ['metaPixelId', 'META PIXEL ID', 'numbers only, from Meta Events Manager']]],
];
async function viewSite() {
  const s = await req('GET', '/settings');
  const input = ([k, label, note, kind]) => {
    let v = s[k];
    if (kind === 'datetime') { const d = new Date(v); v = isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); }
    if (kind === 'bool') return `<label class="adm-field adm-check"><input type="checkbox" name="${k}" ${v ? 'checked' : ''}> ${label}${note ? ` <small>${esc(note)}</small>` : ''}</label>`;
    const ctl = kind === 'textarea' ? `<textarea name="${k}">${esc(v)}</textarea>` : `<input name="${k}" ${kind === 'datetime' ? 'type="datetime-local"' : kind === 'number' ? 'type="number" min="0" step="any"' : ''} value="${esc(v)}">`;
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
      ${['instagram', 'discord'].map(k => `<label class="adm-field">${k.toUpperCase()}<input name="social_${k}" placeholder="https://" value="${esc(s.socials?.[k])}"></label>`).join('')}
      <h2 class="adm-field full" style="font-size:12px;color:var(--yel)">CONTACT DETAILS <small>shown on the Contact page; leave blank to hide</small></h2>
      ${[['email', 'EMAIL'], ['phone', 'PHONE'], ['whatsapp', 'WHATSAPP NUMBER'], ['hours', 'HOURS']].map(([k, l]) => `<label class="adm-field">${l}<input name="contact_${k}" value="${esc(s.contact?.[k])}"></label>`).join('')}
      <label class="adm-field full">ADDRESS<textarea name="contact_address">${esc(s.contact?.address)}</textarea></label>
      <div class="adm-actions"><button type="button" class="btn-ghost test-mail">SEND ME A TEST EMAIL</button><button class="btn-red">SAVE SITE CONTENT</button></div>
    </form>`;
  const form = $('.adm-form', main());
  $('.test-mail', form).addEventListener('click', async () => { try { toast('SENT TO ' + (await req('POST', '/test-email')).to); } catch (e) { toast(e.message, true); } });
  const marquee = s.marquee.map(t => ({ t }));
  rows($('.marquee-box', form), marquee, [{ k: 't', ph: 'Text', w: '1fr' }], () => ({ t: '' }));
  $('.adm-imgs', form).append(imgField('HERO', s.heroImage, v => (s.heroImage = v)));
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { ...s, ...fd, marquee: marquee.map(m => m.t), socials: { instagram: fd.social_instagram, tiktok: fd.social_tiktok, discord: fd.social_discord },
      contact: { email: fd.contact_email, phone: fd.contact_phone, whatsapp: fd.contact_whatsapp, hours: fd.contact_hours, address: fd.contact_address } };
    if (fd.countdownTarget) body.countdownTarget = new Date(fd.countdownTarget).toISOString();
    for (const [, fields] of SITE_FIELDS) for (const [k, , , kind] of fields) if (kind === 'bool') body[k] = form.elements[k].checked;
    try { const saved = await req('PUT', '/settings', body); symbol = saved.symbol; toast('SAVED — LIVE ON SITE'); } catch (err) { toast(err.message, true); }
  });
}

/* ---------- pages ---------- */
const PAGE_LABELS = { about: 'ABOUT', faq: 'FAQ', shipping: 'SHIPPING POLICY', returns: 'RETURNS & REFUNDS', privacy: 'PRIVACY POLICY', terms: 'TERMS OF SERVICE' };
async function viewPages() {
  const pages = await req('GET', '/pages');
  main().innerHTML = `
    <div class="adm-bar"><h1 class="adm-h">PAGES</h1></div>
    <p class="adm-note">Plain text. A blank line starts a new paragraph, lines starting with "- " become a list, and a line starting with "# " becomes a heading. The policies are starting drafts: replace everything in [brackets], or paste your old Shopify policies (Shopify Settings → Policies). Razorpay checks these pages before activating live payments.</p>
    <form class="adm-form">
      ${Object.entries(PAGE_LABELS).map(([k, l]) => `
        <h2 class="adm-field full" style="font-size:12px;color:var(--yel)">${l} <a class="adm-link" href="${k === 'about' ? '/about.html' : '/policy.html?p=' + k}" target="_blank">VIEW →</a></h2>
        <label class="adm-field full">TITLE<input name="${k}_title" value="${esc(pages[k]?.title)}"></label>
        <label class="adm-field full">TEXT<textarea name="${k}_body" style="min-height:220px">${esc(pages[k]?.body)}</textarea></label>`).join('')}
      <div class="adm-actions"><span></span><button class="btn-red">SAVE PAGES</button></div>
    </form>`;
  $('.adm-form', main()).addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const body = Object.fromEntries(Object.keys(PAGE_LABELS).map(k => [k, { title: fd[k + '_title'], body: fd[k + '_body'] }]));
    try { await req('PUT', '/pages', body); toast('SAVED — LIVE ON SITE'); } catch (err) { toast(err.message, true); }
  });
}

/* ---------- messages ---------- */
async function viewMessages() {
  const msgs = await req('GET', '/messages');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">MESSAGES</h1></div>
    <p class="adm-note">From the Contact page. Reply by email: the address is a link.</p><div class="list">${msgs.length ? '' : '<p class="adm-note">No messages yet.</p>'}</div>`;
  for (const m of msgs) {
    const el = h(`<details class="adm-order"${m.read ? '' : ' open'}><summary><span>${m.read ? '' : '<span class="adm-pill yel">NEW</span> '}${esc(m.name)}</span><span>${new Date(m.at).toLocaleString()}</span><span>${esc(m.message.slice(0, 60))}…</span><span>${esc(m.order)}</span><span></span></summary>
      <div class="adm-order-body"><div style="white-space:pre-wrap">${esc(m.message)}</div>
      <div><a class="adm-link" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message to THRYFTLY')}">${esc(m.email)}</a>${m.order ? `<br>Order: ${esc(m.order)}` : ''}<br><br>
      <button class="btn-ghost read">${m.read ? 'MARK UNREAD' : 'MARK READ'}</button> <button class="adm-danger del">DELETE</button></div></div></details>`);
    $('.read', el).addEventListener('click', async () => { await req('PUT', '/messages/' + m.id, { read: !m.read }); viewMessages(); });
    $('.del', el).addEventListener('click', async () => { if (confirm('Delete this message?')) { await req('DELETE', '/messages/' + m.id); viewMessages(); } });
    $('.list', main()).append(el);
  }
}

/* ---------- orders ---------- */
const STATUS = { created: ['AWAITING PAYMENT', 'grey'], paid: ['PAID', 'yel'], sent_to_qikink: ['SENT TO QIKINK', 'green'], fulfillment_failed: ['FULFILMENT FAILED', 'red'], refunded: ['REFUNDED', 'grey'] };
async function viewOrders() {
  const orders = await req('GET', '/orders');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">ORDERS</h1><div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn-ghost export">EXPORT CSV</button><button class="btn-ghost sync">SYNC QIKINK STATUS</button><button class="btn-ghost qk">RAW QIKINK ORDERS</button></div></div>
    <p class="adm-note">Paid orders go to Qikink automatically. If one fails (missing SKU, Qikink down), fix the cause and press RETRY. “Awaiting payment” orders are abandoned checkouts.</p>
    <div class="adm-filter"><input class="q" type="search" placeholder="Search order number, name, email or phone"><select class="st"><option value="">Any status</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select><span class="cnt"></span></div>
    <div class="list">${orders.length ? '' : '<p class="adm-note">No orders yet.</p>'}</div><pre class="adm-note qk-out"></pre>`;
  const list = $('.list', main());
  const filter = () => {
    const q = $('.q', main()).value.trim().toLowerCase(), st = $('.st', main()).value;
    let n = 0;
    for (const el of list.querySelectorAll('.adm-order')) {
      const o = el._order;
      const hit = (!st || o.status === st) && (!q || [o.number, o.customer.name, o.customer.email, o.customer.phone].some(v => String(v).toLowerCase().includes(q)));
      el.hidden = !hit; n += hit;
    }
    $('.cnt', main()).textContent = `${n} OF ${orders.length}`;
  };
  ['.q', '.st'].forEach(sel => $(sel, main()).addEventListener('input', filter));
  for (const o of orders) {
    const [label, color] = STATUS[o.status] || [o.status, 'grey'];
    const c = o.customer;
    const el = h(`<details class="adm-order"><summary><span>${esc(o.number)}</span><span>${new Date(o.createdAt).toLocaleString()}</span><span>${esc(c.name)} · ${esc(c.city)}</span><span>${esc(symbol)}${o.amount}</span><span class="adm-pill ${color}">${o.qikinkStatus ? esc(o.qikinkStatus.toUpperCase()) : label}</span></summary>
      <div class="adm-order-body">
        <div>${o.items.map(i => `${i.qty} × ${esc(i.name)} (${esc([i.color, i.size].filter(Boolean).join(' / '))}) — ${esc(symbol)}${i.price} <small>${i.sku ? 'SKU ' + esc(i.sku) : '<span class="red">NO SKU</span>'}</small>`).join('<br>')}
          <br>Shipping: ${esc(symbol)}${o.shipping}${o.oversold ? '<br><span class="red">OVERSOLD — refund one buyer in Razorpay</span>' : ''}
          ${o.paymentId ? `<br>Payment: ${esc(o.paymentId)}` : ''}${o.qikink?.order_id ? `<br>Qikink order: ${esc(o.qikink.order_id)}` : ''}
          ${o.tracking ? `<br>Tracking: <a class="adm-link" href="${esc(o.tracking.url)}" target="_blank" rel="noopener">${esc(o.tracking.courier || 'courier')} ${esc(o.tracking.awb)}</a>` : ''}${o.fulfillmentError ? `<br><span class="red">${esc(o.fulfillmentError)}</span>` : ''}
          ${o.discount ? `<br>Discount: ${esc(o.discount.code)} (−${esc(symbol)}${o.discount.amount})` : ''}${o.refund ? `<br>Refunded ${esc(symbol)}${o.refund.amount} on ${new Date(o.refund.at).toLocaleDateString()}` : ''}
          ${o.status === 'fulfillment_failed' ? '<br><br><button class="btn-red retry">RETRY SEND TO QIKINK</button>' : ''}
          ${o.paidAt ? '<br><br><button class="btn-ghost inv">PRINT INVOICE</button>' : ''}
          ${o.paymentId && o.status !== 'refunded' ? '<br><br><button class="adm-danger refund">CANCEL &amp; REFUND</button>' : ''}</div>
        <div>${esc(c.name)}<br>${esc(c.address1)}${c.address2 ? '<br>' + esc(c.address2) : ''}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.zip)}<br>${esc(c.phone)} · ${esc(c.email)}
          ${o.qikink ? `<pre>${esc(JSON.stringify(o.qikink, null, 1))}</pre>` : ''}</div>
      </div></details>`);
    $('.refund', el)?.addEventListener('click', async () => {
      if (!confirm(`Refund ${symbol}${o.amount} to ${o.customer.name} through Razorpay and email them?${o.status === 'sent_to_qikink' ? '\n\nQikink already has this order: cancel it in the Qikink dashboard too.' : ''}`)) return;
      try { await req('POST', `/orders/${o.id}/refund`); toast('REFUNDED · CUSTOMER EMAILED'); viewOrders(); } catch (e) { toast(e.message, true); }
    });
    $('.inv', el)?.addEventListener('click', () => printInvoice(o));
    $('.retry', el)?.addEventListener('click', async () => {
      try { const r = await req('POST', `/orders/${o.id}/fulfill`); toast(r.status === 'sent_to_qikink' ? 'SENT TO QIKINK' : r.fulfillmentError, r.status !== 'sent_to_qikink'); viewOrders(); } catch (e) { toast(e.message, true); }
    });
    el._order = o;
    list.append(el);
  }
  filter();
  $('.export', main()).addEventListener('click', () => csv('thryftly-orders.csv', [
    ['order', 'date', 'status', 'name', 'email', 'phone', 'address', 'city', 'state', 'pin', 'items', 'subtotal', 'discount code', 'discount', 'shipping', 'total', 'payment id', 'qikink order', 'tracking'],
    ...orders.map(o => [o.number, o.createdAt, o.qikinkStatus || o.status, o.customer.name, o.customer.email, o.customer.phone, [o.customer.address1, o.customer.address2].filter(Boolean).join(', '), o.customer.city, o.customer.state, o.customer.zip,
      o.items.map(i => `${i.qty}x ${i.name} (${[i.color, i.size].filter(Boolean).join('/')})`).join('; '), o.subtotal, o.discount?.code || '', o.discount?.amount || 0, o.shipping, o.amount, o.paymentId || '', o.qikink?.order_id || '', o.tracking?.url || '']),
  ]));
  $('.sync', main()).addEventListener('click', async () => {
    try { const r = await req('POST', '/orders/sync'); toast(`SYNCED ${r.synced} ORDERS`); viewOrders(); } catch (e) { toast(e.message, true); }
  });
  $('.qk', main()).addEventListener('click', async () => {
    try { $('.qk-out', main()).textContent = 'Orders on Qikink:\n' + JSON.stringify(await req('GET', '/qikink/orders'), null, 2); } catch (e) { toast(e.message, true); }
  });
}

/* ---------- discounts ---------- */
const DTYPE = { percent: '% OFF', flat: 'OFF', freeship: 'FREE SHIPPING' };
const dLabel = d => d.type === 'percent' ? `${d.value}% OFF` : d.type === 'flat' ? `${symbol}${d.value} OFF` : 'FREE SHIPPING';
async function viewDiscounts() {
  const list = await req('GET', '/discounts');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">DISCOUNTS</h1><button class="btn-red new">+ NEW CODE</button></div>
    <p class="adm-note">Codes customers type at checkout. Share a link that fills the code in for them: <b>yoursite/discount/CODE</b> (old Shopify discount links keep working). Put a code in the welcome and cart-reminder emails under Site content → Emails.</p>
    <table class="adm-table"><thead><tr><th>CODE</th><th>GIVES</th><th class="hide-sm">MIN ORDER</th><th>USED</th><th class="hide-sm">ENDS</th><th>STATUS</th><th></th></tr></thead><tbody>
    ${list.map((d, i) => `<tr><td><b>${esc(d.code)}</b>${d.note ? `<br><small>${esc(d.note)}</small>` : ''}</td><td>${esc(dLabel(d))}${d.categories?.length ? `<br><small>on ${esc(d.categories.join(', ').toLowerCase())}</small>` : ''}</td><td class="hide-sm">${d.minOrder ? esc(symbol) + d.minOrder : '—'}</td><td>${d.used || 0}${d.limit ? ' / ' + d.limit : ''}</td><td class="hide-sm">${d.endsAt ? new Date(d.endsAt).toLocaleDateString() : '—'}</td>
      <td>${d.active && !(d.endsAt && Date.parse(d.endsAt) < Date.now()) ? '<span class="adm-pill green">ON</span>' : '<span class="adm-pill grey">OFF</span>'}${d.advertise ? ' <span class="adm-pill yel">ON SITE</span>' : ''}</td><td><button class="adm-link" data-i="${i}">EDIT</button></td></tr>`).join('') || '<tr><td colspan="7">No codes yet.</td></tr>'}</tbody></table>`;
  main().querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => editDiscount(list[b.dataset.i])));
  $('.new', main()).addEventListener('click', () => editDiscount({ code: '', type: 'percent', value: 10, minOrder: 0, limit: 0, oncePerCustomer: true, startsAt: '', endsAt: '', active: true, note: '', advertise: true, headline: '' }));
}
async function editDiscount(src) {
  const d = structuredClone(src);
  d.categories ||= [];
  const cats = [...new Set((await req('GET', '/products')).map(p => p.category).filter(Boolean))].sort();
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">${d.id ? 'EDIT' : 'NEW'} CODE</h1><button class="btn-ghost back">← ALL CODES</button></div>
    <form class="adm-form">
      <label class="adm-field">CODE <small>letters and numbers, e.g. WELCOME10</small><input name="code" value="${esc(d.code)}" required></label>
      <label class="adm-field">TYPE<select name="type"><option value="percent">Percentage off</option><option value="flat">Fixed amount off</option><option value="freeship">Free shipping</option></select></label>
      <label class="adm-field">VALUE <small>% or ${esc(symbol)}; ignored for free shipping</small><input name="value" type="number" min="0" value="${d.value}"></label>
      <label class="adm-field">MINIMUM ORDER (${esc(symbol)}) <small>0 = none</small><input name="minOrder" type="number" min="0" value="${d.minOrder}"></label>
      <label class="adm-field">TOTAL USES <small>0 = unlimited; used ${d.used || 0} so far</small><input name="limit" type="number" min="0" value="${d.limit}"></label>
      <label class="adm-field">NOTE <small>only you see this</small><input name="note" value="${esc(d.note)}"></label>
      <label class="adm-field full">ADVERT TEXT <small>shown in the offer strip, cart and checkout when "show on the site" is ticked; blank = written for you, e.g. "10% OFF EVERYTHING"</small><input name="headline" maxlength="80" value="${esc(d.headline || '')}"></label>
      <label class="adm-field">STARTS <small>empty = now</small><input name="startsAt" type="datetime-local" value="${local(d.startsAt)}"></label>
      <label class="adm-field">ENDS <small>empty = never</small><input name="endsAt" type="datetime-local" value="${local(d.endsAt)}"></label>
      <div class="adm-checks full adm-field">ONLY ON THESE CATEGORIES <small>none ticked = the whole order</small>${cats.map(c => `<label><input type="checkbox" class="dcat" value="${esc(c)}" ${d.categories.includes(c) ? 'checked' : ''}> ${esc(c)}</label>`).join('')}</div>
      <div class="adm-checks full adm-field"><label><input type="checkbox" name="active"> CODE IS ON</label><label><input type="checkbox" name="oncePerCustomer"> ONCE PER CUSTOMER (by email)</label><label><input type="checkbox" name="advertise"> SHOW ON THE SITE (offer strip, cart, checkout)</label></div>
      <div class="adm-actions">${d.id ? '<button type="button" class="adm-danger del">DELETE CODE</button>' : '<span></span>'}<button class="btn-red">SAVE CODE</button></div>
    </form>`;
  const form = $('.adm-form', main());
  form.type.value = d.type; form.active.checked = !!d.active; form.oncePerCustomer.checked = !!d.oncePerCustomer; form.advertise.checked = !!d.advertise;
  $('.back', main()).addEventListener('click', viewDiscounts);
  $('.del', main())?.addEventListener('click', async () => { if (confirm(`Delete ${d.code}?`)) { await req('DELETE', '/discounts/' + d.id); toast('DELETED'); viewDiscounts(); } });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(form));
    const body = { ...d, ...fd, active: form.active.checked, oncePerCustomer: form.oncePerCustomer.checked, advertise: form.advertise.checked, categories: [...form.querySelectorAll('.dcat:checked')].map(i => i.value),
      startsAt: fd.startsAt ? new Date(fd.startsAt).toISOString() : '', endsAt: fd.endsAt ? new Date(fd.endsAt).toISOString() : '' };
    try { const saved = await req(d.id ? 'PUT' : 'POST', '/discounts' + (d.id ? '/' + d.id : ''), body); toast('SAVED'); editDiscount(saved); } catch (err) { toast(err.message, true); }
  });
}

/* ---------- size charts ---------- */
async function viewCharts() {
  const list = await req('GET', '/size-charts');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">SIZE CHARTS</h1><button class="btn-red new">+ NEW CHART</button></div>
    <p class="adm-note">One chart per kind of garment. Products get theirs automatically from their category, name and description (hoodie fit, tee fabric…); override one on the product page if needed. A product page shows a SIZE CHART button once its chart has an image or measurements. Qikink's size charts for each blank are in the Qikink catalogue: screenshot or export them and upload here.</p>
    <table class="adm-table"><thead><tr><th></th><th>CHART</th><th>PRODUCTS</th><th>STATUS</th><th></th></tr></thead><tbody>
    ${list.map((c, i) => `<tr><td><div class="adm-thumb" style="background-image:${esc(cssUrl(c.image))}"></div></td><td><b>${esc(c.title)}</b><br><small>${esc(c.key)}</small></td><td>${c.products}</td>
      <td>${c.image || c.note || c.table ? '<span class="adm-pill green">SHOWN</span>' : '<span class="adm-pill yel">EMPTY</span>'}</td><td><button class="adm-link" data-i="${i}">EDIT</button></td></tr>`).join('') || '<tr><td colspan="5">No size charts yet.</td></tr>'}</tbody></table>`;
  main().querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => editChart(list[b.dataset.i])));
  $('.new', main()).addEventListener('click', () => editChart({ key: '', title: '', image: '', table: 'SIZE, CHEST, LENGTH', note: '*All measurements are in inches.' }));
}
function editChart(src) {
  const c = structuredClone(src);
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">${c.id ? 'EDIT' : 'NEW'} SIZE CHART</h1><button class="btn-ghost back">← ALL CHARTS</button></div>
    <form class="adm-form">
      <label class="adm-field">NAME <small>e.g. OVERSIZED HOODIE</small><input name="title" value="${esc(c.title)}" required></label>
      <label class="adm-field">KEY <small>what products point at; blank = from the name</small><input name="key" value="${esc(c.key)}"></label>
      <label class="adm-field full">MEASUREMENTS TABLE <small>one row per line, cells split by commas, headings first, e.g. "SIZE, CHEST, LENGTH" then "S, 40, 27"</small><textarea name="table" style="min-height:200px;font-family:var(--mono)">${esc(c.table || '')}</textarea></label>
      <div class="adm-field full">CHART IMAGE <small>optional, e.g. a how-to-measure picture</small><div class="adm-imgs"></div></div>
      <label class="adm-field full">MEASUREMENTS / NOTES <small>optional text under the image, e.g. "Chest 44 / 46 / 48 in. Model is 6ft wearing L."</small><textarea name="note">${esc(c.note)}</textarea></label>
      <div class="adm-actions">${c.id ? '<button type="button" class="adm-danger del">DELETE CHART</button>' : '<span></span>'}<button class="btn-red">SAVE CHART</button></div>
    </form>`;
  const form = $('.adm-form', main());
  $('.adm-imgs', form).append(imgField('SIZE CHART', c.image, v => (c.image = v)));
  $('.back', main()).addEventListener('click', viewCharts);
  $('.del', main())?.addEventListener('click', async () => { if (confirm(`Delete ${c.title}? Products using it stop showing a size chart.`)) { await req('DELETE', '/size-charts/' + c.id); toast('DELETED'); viewCharts(); } });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const body = { ...c, ...Object.fromEntries(new FormData(form)), image: c.image };
    try { const saved = await req(c.id ? 'PUT' : 'POST', '/size-charts' + (c.id ? '/' + c.id : ''), body); toast('SAVED'); editChart(saved); } catch (err) { toast(err.message, true); }
  });
}

/* ---------- customers ---------- */
async function viewCustomers() {
  const list = await req('GET', '/customers');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">CUSTOMERS</h1><button class="btn-ghost export">EXPORT CSV</button></div>
    <p class="adm-note">Everyone who has paid for an order, made an account or joined the drop list.</p>
    <div class="adm-filter"><input class="q" type="search" placeholder="Search name, email, phone or city"><select class="st"><option value="">Everyone</option><option value="buyers">Has ordered</option><option value="account">Has an account</option><option value="subscribed">On the drop list</option></select><span class="cnt"></span></div>
    <table class="adm-table"><thead><tr><th>CUSTOMER</th><th class="hide-sm">CITY</th><th>ORDERS</th><th>SPENT</th><th class="hide-sm">LAST ORDER</th><th class="hide-sm"></th></tr></thead><tbody></tbody></table>`;
  const draw = () => {
    const q = $('.q', main()).value.trim().toLowerCase(), st = $('.st', main()).value;
    const shown = list.filter(c => (!q || [c.name, c.email, c.phone, c.city].some(v => String(v).toLowerCase().includes(q))) && (!st || (st === 'buyers' ? c.orders > 0 : c[st])));
    $('.cnt', main()).textContent = `${shown.length} OF ${list.length}`;
    $('tbody', main()).innerHTML = shown.map(c => `<tr><td><b>${esc(c.name || '—')}</b><br><a class="adm-link" href="mailto:${esc(c.email)}">${esc(c.email)}</a>${c.phone ? `<br><small>${esc(c.phone)}</small>` : ''}</td>
      <td class="hide-sm">${esc(c.city)}</td><td>${c.orders}</td><td>${esc(symbol)}${Math.round(c.spent).toLocaleString('en-IN')}</td><td class="hide-sm">${c.last ? new Date(c.last).toLocaleDateString() : '—'}</td>
      <td class="hide-sm">${c.account ? '<span class="adm-pill green">ACCOUNT</span> ' : ''}${c.subscribed ? '<span class="adm-pill yel">DROP LIST</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="6">Nobody yet.</td></tr>';
  };
  ['.q', '.st'].forEach(sel => $(sel, main()).addEventListener('input', draw));
  draw();
  $('.export', main()).addEventListener('click', () => csv('thryftly-customers.csv', [['name', 'email', 'phone', 'city', 'orders', 'spent', 'last order', 'account', 'drop list'], ...list.map(c => [c.name, c.email, c.phone, c.city, c.orders, c.spent, c.last, c.account ? 'yes' : 'no', c.subscribed ? 'yes' : 'no'])]));
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

/* ---------- invoice (same layout the customer gets) ---------- */
let settingsCache = null;
async function printInvoice(o) {
  settingsCache ||= await req('GET', '/settings');
  const w = window.open('', '_blank');
  if (!w) return toast('Allow pop-ups to print invoices', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.number)}</title><style>${invoiceCss}</style></head><body><div class="inv-bar"><button class="inv-print" onclick="print()">PRINT / SAVE AS PDF</button></div><main class="inv">${invoiceHtml({ ...o, placed: o.createdAt }, settingsCache)}</main></body></html>`);
  w.document.close();
}

/* ---------- exchanges & returns ---------- */
const RSTATUS = { requested: ['NEW', 'yel'], approved: ['APPROVED', 'green'], rejected: ['REJECTED', 'grey'], completed: ['DONE', 'grey'] };
async function viewReturns() {
  const list = await req('GET', '/returns');
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">EXCHANGES & RETURNS</h1></div>
    <p class="adm-note">Requests from the exchange page. Approve or reject: the customer gets an email with your message. Arrange the pickup or the replacement order in Qikink, then mark it DONE (refunds go through Orders → CANCEL &amp; REFUND).</p>
    <div class="adm-filter"><select class="st"><option value="">Any status</option>${Object.entries(RSTATUS).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select><span class="cnt"></span></div>
    <div class="list">${list.length ? '' : '<p class="adm-note">No requests yet.</p>'}</div>`;
  for (const r of list) {
    const [label, color] = RSTATUS[r.status] || [r.status, 'grey'];
    const el = h(`<details class="adm-order"${r.status === 'requested' ? ' open' : ''}><summary><span>${esc(r.number)}</span><span>${new Date(r.at).toLocaleString()}</span><span>${esc(r.name)} · order ${esc(r.orderNumber)}</span><span>${r.type === 'return' ? 'RETURN' : 'EXCHANGE'}</span><span class="adm-pill ${color}">${label}</span></summary>
      <div class="adm-order-body">
        <div>${r.items.map(i => `${i.qty} × ${esc(i.name)} (${esc([i.color, i.size].filter(Boolean).join(' / '))})${i.want ? ` → <b>${esc(i.want)}</b>` : ''}<br><small>${esc(i.reason)}</small>`).join('<br>')}
          ${r.note ? `<br><br><i>“${esc(r.note)}”</i>` : ''}<br><br><a class="adm-link" href="mailto:${esc(r.email)}?subject=${encodeURIComponent(`Your request ${r.number}`)}">${esc(r.email)}</a></div>
        <div class="adm-form" style="padding:0">
          <label class="adm-field full">MESSAGE TO CUSTOMER <small>included in the email (pickup date, next steps, reason)</small><textarea class="reply">${esc(r.reply || '')}</textarea></label>
          <label class="adm-field full">PRIVATE NOTE<input class="internal" value="${esc(r.internal || '')}"></label>
          <div class="adm-actions" style="justify-content:flex-start;flex-wrap:wrap">${['approved', 'rejected', 'completed'].map(st => `<button type="button" class="${st === 'rejected' ? 'adm-danger' : 'btn-ghost'}" data-st="${st}">${st === 'approved' ? 'APPROVE' : st === 'rejected' ? 'REJECT' : 'MARK DONE'}</button>`).join('')}<button type="button" class="btn-ghost" data-st="">SAVE NOTES</button></div>
        </div></div></details>`);
    el.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', async () => {
      try {
        const out = await req('PUT', '/returns/' + r.id, { ...(b.dataset.st && { status: b.dataset.st }), reply: $('.reply', el).value, internal: $('.internal', el).value });
        toast(out.mailed ? 'SAVED · CUSTOMER EMAILED' : 'SAVED'); viewReturns();
      } catch (e) { toast(e.message, true); }
    }));
    el._r = r;
    $('.list', main()).append(el);
  }
  const filter = () => { const st = $('.st', main()).value; let n = 0; main().querySelectorAll('.adm-order').forEach(el => { el.hidden = !!st && el._r.status !== st; n += !el.hidden; }); $('.cnt', main()).textContent = `${n} OF ${list.length}`; };
  $('.st', main()).addEventListener('input', filter); filter();
}

/* ---------- reviews ---------- */
async function viewReviews() {
  const list = await req('GET', '/reviews');
  const STAT = { published: ['LIVE', 'green'], pending: ['TO CHECK', 'yel'], hidden: ['HIDDEN', 'grey'] };
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">REVIEWS</h1><button class="btn-ghost export">EXPORT CSV</button></div>
    <p class="adm-note">Reviews from people who bought the piece (same email) are marked VERIFIED and go live straight away when that's switched on in Site content. Everything else waits here.</p>
    <div class="adm-filter"><select class="st"><option value="">All</option>${Object.entries(STAT).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('')}</select><span class="cnt"></span></div>
    <div class="list">${list.length ? '' : '<p class="adm-note">No reviews yet. Delivered-order emails ask customers for one.</p>'}</div>`;
  for (const r of list) {
    const [label, color] = STAT[r.status] || [r.status, 'grey'];
    const el = h(`<details class="adm-order"${r.status === 'pending' ? ' open' : ''}><summary><span>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span><span>${esc(r.product)}</span><span>${esc(r.name)}${r.verified ? ' · ✓' : ''}</span><span>${new Date(r.at).toLocaleDateString()}</span><span class="adm-pill ${color}">${label}</span></summary>
      <div class="adm-order-body"><div>${r.title ? `<b>${esc(r.title)}</b><br>` : ''}<span style="white-space:pre-wrap">${esc(r.body)}</span><br><br><small>${esc(r.email)} · ${r.verified ? 'VERIFIED BUYER' : 'no matching order'}${r.size ? ' · size ' + esc(r.size) : ''}${r.fit ? ' · fit: ' + esc(r.fit) : ''}</small></div>
        <div class="adm-form" style="padding:0"><label class="adm-field full">PUBLIC REPLY <small>optional, shown under the review</small><textarea class="reply">${esc(r.reply || '')}</textarea></label>
          <div class="adm-actions" style="justify-content:flex-start;flex-wrap:wrap"><button type="button" class="btn-ghost" data-st="published">PUBLISH</button><button type="button" class="btn-ghost" data-st="hidden">HIDE</button><button type="button" class="btn-ghost" data-st="">SAVE REPLY</button><button type="button" class="adm-danger del">DELETE</button></div></div></div></details>`);
    el.querySelectorAll('[data-st]').forEach(b => b.addEventListener('click', async () => {
      try { await req('PUT', '/reviews/' + r.id, { ...(b.dataset.st && { status: b.dataset.st }), reply: $('.reply', el).value }); toast('SAVED — LIVE ON SITE'); viewReviews(); } catch (e) { toast(e.message, true); }
    }));
    $('.del', el).addEventListener('click', async () => { if (confirm('Delete this review for good?')) { await req('DELETE', '/reviews/' + r.id); viewReviews(); } });
    el._r = r;
    $('.list', main()).append(el);
  }
  const filter = () => { const st = $('.st', main()).value; let n = 0; main().querySelectorAll('.adm-order').forEach(el => { el.hidden = !!st && el._r.status !== st; n += !el.hidden; }); $('.cnt', main()).textContent = `${n} OF ${list.length}`; };
  $('.st', main()).addEventListener('input', filter); filter();
  $('.export', main()).addEventListener('click', () => csv('thryftly-reviews.csv', [['product', 'rating', 'title', 'review', 'name', 'email', 'verified', 'status', 'date'], ...list.map(r => [r.product, r.rating, r.title, r.body, r.name, r.email, r.verified ? 'yes' : 'no', r.status, r.at])]));
}

/* ---------- back-in-stock waiting list ---------- */
async function viewWaitlist() {
  const list = await req('GET', '/restock');
  const waiting = list.filter(r => !r.notifiedAt);
  // Most-wanted variants first: a good hint for what to restock or reprint.
  const demand = Object.values(waiting.reduce((m, r) => { const k = `${r.productId}|${r.color}|${r.size}`; (m[k] ||= { name: r.name, variant: [r.color, r.size].filter(Boolean).join(' / '), n: 0 }).n++; return m; }, {})).sort((a, b) => b.n - a.n);
  main().innerHTML = `<div class="adm-bar"><h1 class="adm-h">BACK-IN-STOCK WAITLIST</h1><div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn-ghost export">EXPORT CSV</button><button class="btn-red send">SEND DUE EMAILS NOW</button></div></div>
    <p class="adm-note">Shoppers who tapped NOTIFY ME on a sold-out size. When you raise its stock (or add its SKU) in Products, they get one email straight away. The hourly job also catches anything missed.</p>
    <h2 class="adm-h" style="font-size:16px;margin:12px 0">MOST WANTED</h2>
    <table class="adm-table"><thead><tr><th>PRODUCT</th><th>COLOUR / SIZE</th><th>WAITING</th></tr></thead><tbody>${demand.map(d => `<tr><td>${esc(d.name)}</td><td>${esc(d.variant)}</td><td><b>${d.n}</b></td></tr>`).join('') || '<tr><td colspan="3">Nobody waiting.</td></tr>'}</tbody></table>
    <h2 class="adm-h" style="font-size:16px;margin:28px 0 12px">EVERY REQUEST</h2>
    <table class="adm-table"><thead><tr><th>EMAIL</th><th>PRODUCT</th><th class="hide-sm">ASKED</th><th>STATUS</th><th></th></tr></thead><tbody>${list.map(r => `<tr><td>${esc(r.email)}</td><td>${esc(r.name)}<br><small>${esc([r.color, r.size].filter(Boolean).join(' / '))}</small></td><td class="hide-sm">${new Date(r.at).toLocaleDateString()}</td><td>${r.notifiedAt ? `<span class="adm-pill green">EMAILED</span>` : '<span class="adm-pill yel">WAITING</span>'}</td><td><button class="adm-link" data-del="${esc(r.id)}">REMOVE</button></td></tr>`).join('') || '<tr><td colspan="5">No requests yet.</td></tr>'}</tbody></table>`;
  main().querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => { await req('DELETE', '/restock/' + b.dataset.del); viewWaitlist(); }));
  $('.send', main()).addEventListener('click', async () => { try { toast(`SENT ${(await req('POST', '/restock/send')).sent} EMAILS`); viewWaitlist(); } catch (e) { toast(e.message, true); } });
  $('.export', main()).addEventListener('click', () => csv('thryftly-waitlist.csv', [['email', 'product', 'colour', 'size', 'asked', 'emailed'], ...list.map(r => [r.email, r.name, r.color, r.size, r.at, r.notifiedAt || ''])]));
}

boot();
