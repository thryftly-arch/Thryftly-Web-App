// Shop all, About, Contact, Policies and Track order. One script, switched by <body data-page>.
import { $, $$, esc, cssUrl, api, loadSite, money, bindSettings, mountChrome, productCard, richText, catLabel } from './shop.js';

const site = await loadSite();
mountChrome();
bindSettings(site.settings);
const page = document.body.dataset.page;
const msg = (form, t, err) => { const m = $('.co-msg', form); m.textContent = t; m.classList.toggle('err', !!err); };

/* ---------- shop all ---------- */
if (page === 'shop') {
  const params = new URLSearchParams(location.search);
  const list = k => (params.get(k) || '').split(',').filter(Boolean);
  const state = { c: params.get('c') || 'ALL', q: params.get('q') || '', sort: params.get('sort') || 'featured', size: list('size'), color: list('color'), price: params.get('price') || '', stock: params.get('stock') === '1' };
  // Filter options from the catalogue itself: sizes in the usual order, colours by how many pieces have them.
  const ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '4XL', '5XL', 'OS'];
  const rank = l => (ORDER.indexOf(l) + 1 || 99);
  const allSizes = [...new Set(site.products.flatMap(p => p.sizes.map(s => s.label)))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
  const colorCount = site.products.reduce((m, p) => { new Set(p.sizes.map(s => s.color).filter(Boolean)).forEach(c => (m[c] = (m[c] || 0) + 1)); return m; }, {});
  const allColors = Object.keys(colorCount).sort((a, b) => colorCount[b] - colorCount[a]).slice(0, 24);
  const prices = site.products.map(p => p.price).sort((a, b) => a - b), top = prices.at(-1) || 0;
  const step = top > 3000 ? 1000 : top > 1000 ? 500 : 50;
  const bands = [...new Set([1, 2, 3].map(k => Math.ceil(prices[Math.floor(prices.length * k / 4)] / step) * step))].filter(b => b && b < top).map(b => ['u' + b, `UNDER ${money(b)}`]);
  const inBand = (p, b) => !b || p.price <= +b.slice(1);
  const chip = (group, value, label, on) => `<button type="button" class="chip${on ? ' on' : ''}" aria-pressed="${on}" data-f="${group}" data-v="${esc(value)}">${esc(label)}</button>`;
  const counts = site.products.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
  const cats = ['ALL', ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  if (!cats.includes(state.c)) state.c = 'ALL';
  $('.shop-search').value = state.q;
  $('.shop-sort').value = state.sort;

  function render() {
    $('.chips').innerHTML = cats.map(c => `<button role="tab" class="chip${c === state.c ? ' on' : ''}" aria-selected="${c === state.c}" data-c="${esc(c)}">${esc(catLabel(c))} <span>${c === 'ALL' ? site.products.length : counts[c]}</span></button>`).join('');
    const q = state.q.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    // A variant counts if it matches every size / colour filter (and is in stock, when asked).
    const fits = p => p.sizes.some(s => (!state.size.length || state.size.includes(s.label)) && (!state.color.length || state.color.includes(s.color)) && (!state.stock || s.available));
    const filtered = state.size.length || state.color.length || state.stock || state.price;
    let list = site.products.filter(p => (state.c === 'ALL' || p.category === state.c) && terms.every(t => `${p.name} ${p.category} ${catLabel(p.category)} ${p.description} ${p.sizes.map(s => s.color).join(' ')}`.toLowerCase().includes(t)) && (!filtered || (fits(p) && inBand(p, state.price))));
    const sorts = { low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price, az: (a, b) => a.name.localeCompare(b.name), rated: (a, b) => (b.reviews?.avg || 0) - (a.reviews?.avg || 0) || (b.reviews?.count || 0) - (a.reviews?.count || 0) };
    if (sorts[state.sort]) list = [...list].sort(sorts[state.sort]);
    $('.f-size').innerHTML = allSizes.map(l => chip('size', l, l, state.size.includes(l))).join('');
    $('.f-color').innerHTML = allColors.map(c => chip('color', c, c, state.color.includes(c))).join('');
    $('.f-price').innerHTML = bands.map(([v, l]) => chip('price', v, l, state.price === v)).join('');
    $('.f-instock').checked = state.stock;
    const nf = state.size.length + state.color.length + !!state.price + state.stock;
    $('.filter-n').textContent = nf ? `(${nf})` : '';
    $('.f-clear').hidden = !nf;
    // "All" with no search: one section per category. A filter or search: one flat grid.
    const grouped = state.c === 'ALL' && !q && !filtered;
    $('.shop-grid').classList.toggle('grid', !grouped);
    $('.shop-grid').innerHTML = grouped
      ? cats.slice(1).map(c => { const g = list.filter(p => p.category === c); return g.length ? `<div class="cat-sec"><div class="cat-head"><h3 class="cat-h">${esc(catLabel(c))} <span>${g.length}</span></h3></div><div class="grid cat-grid">${g.map(productCard).join('')}</div></div>` : ''; }).join('')
      : list.map(productCard).join('');
    $('.shop-empty').hidden = list.length > 0;
    $('.shop-count').textContent = `${list.length} PIECE${list.length === 1 ? '' : 'S'}`;
    // Keep the filter in the URL so it can be shared and survives the back button.
    const u = new URLSearchParams();
    if (state.c !== 'ALL') u.set('c', state.c);
    if (state.q) u.set('q', state.q);
    if (state.sort !== 'featured') u.set('sort', state.sort);
    if (state.size.length) u.set('size', state.size.join(','));
    if (state.color.length) u.set('color', state.color.join(','));
    if (state.price) u.set('price', state.price);
    if (state.stock) u.set('stock', '1');
    history.replaceState(null, '', location.pathname + (u.size ? '?' + u : ''));
  }
  $('.chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { state.c = b.dataset.c; render(); } });
  let t;
  $('.shop-search').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 150); });
  $('.shop-sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
  $('.filter-body').addEventListener('click', e => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    const { f, v } = b.dataset;
    if (f === 'price') state.price = state.price === v ? '' : v;
    else state[f] = state[f].includes(v) ? state[f].filter(x => x !== v) : [...state[f], v];
    render();
  });
  $('.f-instock').addEventListener('change', e => { state.stock = e.target.checked; render(); });
  $('.f-clear').addEventListener('click', () => { Object.assign(state, { size: [], color: [], price: '', stock: false }); render(); });
  const ft = $('.filter-toggle');
  ft.addEventListener('click', () => ft.setAttribute('aria-expanded', $('.filters').classList.toggle('open')));
  render();
}

/* ---------- about + policies ---------- */
if (page === 'about' || page === 'policy') {
  const key = page === 'about' ? 'about' : new URLSearchParams(location.search).get('p');
  const doc = site.pages[key] || site.pages.shipping;
  $('.page-title').textContent = doc.title;
  $('.page-body').innerHTML = richText(doc.body);
  document.title = `${doc.title} — THRYFTLY`;
  $$('.policy-tabs a').forEach(a => a.classList.toggle('on', a.dataset.p === (site.pages[key] ? key : 'shipping')));
}

/* ---------- contact ---------- */
if (page === 'contact') {
  const c = site.settings.contact || {};
  const wa = c.whatsapp.replace(/\D/g, '');
  const rows = [
    c.email && ['EMAIL', `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`],
    c.phone && ['PHONE', `<a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>`],
    wa && ['WHATSAPP', `<a href="https://wa.me/${wa}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a>`],
    c.hours && ['HOURS', esc(c.hours)],
    c.address && ['ADDRESS', esc(c.address).replace(/\n/g, '<br>')],
  ].filter(Boolean);
  $('.contact-list').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const form = $('.contact-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true;
    try {
      await api('/api/contact', Object.fromEntries(new FormData(form)));
      form.reset();
      msg(form, "SENT. WE'LL GET BACK TO YOU SOON ⚡");
    } catch (err) { msg(form, err.message, true); }
    btn.disabled = false;
  });
}

/* ---------- track order ---------- */
if (page === 'track') {
  const form = $('.track-form');
  const p = new URLSearchParams(location.search);
  if (p.get('n')) form.number.value = p.get('n');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', form);
    btn.disabled = true; msg(form, 'LOOKING…'); $('.track-out').innerHTML = '';
    try {
      const creds = Object.fromEntries(new FormData(form));
      const o = await api('/api/track', creds);
      msg(form, '');
      // The invoice page reads the order with the same number + email (kept on this device for 30 minutes, not in the URL).
      try { localStorage.setItem('thryftly_invoice', JSON.stringify({ ...creds, at: Date.now() })); localStorage.setItem('thryftly_email', creds.email); } catch { /* ignore */ }
      const RX = { requested: 'RECEIVED', approved: 'APPROVED', rejected: 'NOT ACCEPTED', completed: 'DONE' };
      $('.track-out').innerHTML = `
        ${steps(o)}
        <div class="co-sum"><span>ORDER</span><span>${esc(o.number)}</span><span>PLACED</span><span>${new Date(o.placed).toLocaleDateString('en-IN')}</span>
        <span>TOTAL</span><span>${money(o.amount)}</span><span class="tot">STATUS</span><span class="tot">${esc(o.status)}</span></div>
        <ul class="track-items">${o.items.map(i => `<li>${i.qty} × ${esc(i.name)} (${esc([i.color, i.size].filter(Boolean).join(' / '))})</li>`).join('')}</ul>
        ${o.tracking ? `<a class="btn-red" href="${esc(o.tracking.url)}" target="_blank" rel="noopener">TRACK WITH ${esc((o.tracking.courier || 'COURIER').trim().toUpperCase())} →</a>` : '<p class="prose">A tracking link appears here once your order ships.</p>'}
        ${o.returns.length ? `<h2 style="margin-top:8px">EXCHANGES & RETURNS</h2><ul class="track-items">${o.returns.map(r => `<li>${esc(r.number)} · ${r.type === 'return' ? 'RETURN' : 'EXCHANGE'} · <b class="yel">${RX[r.status] || esc(r.status)}</b>${r.reply ? `<br><small>${esc(r.reply)}</small>` : ''}</li>`).join('')}</ul>` : ''}
        <div class="track-acts">${o.paid ? '<a class="btn-ghost" href="/invoice.html" target="_blank">INVOICE ↗</a>' : ''}${o.paid && site.settings.exchangeDays && o.status !== 'CANCELLED & REFUNDED' ? `<a class="btn-ghost" href="/exchange.html?n=${encodeURIComponent(o.number)}">EXCHANGE / RETURN</a>` : ''}</div>`;
    } catch (err) { msg(form, err.message, true); }
    btn.disabled = false;
  });
}

// Order progress: paid → printing → shipped → delivered, from what we know about the order.
function steps(o) {
  if (!o.paid || o.refund) return '';
  const st = o.status.toLowerCase();
  const at = o.deliveredAt || /deliver/.test(st) && !/undeliver/.test(st) ? 3 : o.tracking || /ship|transit|dispatch|out for/.test(st) ? 2 : /production|print|process|sent/.test(st) ? 1 : 0;
  return `<ol class="steps">${['CONFIRMED', 'PRINTING', 'SHIPPED', 'DELIVERED'].map((l, i) => `<li class="${i <= at ? 'on' : ''}">${l}</li>`).join('')}</ol>`;
}

/* ---------- exchanges & returns ---------- */
if (page === 'exchange') {
  const s = site.settings;
  const days = +s.exchangeDays || 0;
  $('.ex-days').textContent = days ? `${days} DAYS` : '';
  $('.ex-policy').innerHTML = richText(site.pages.returns?.body || '');
  const find = $('.ex-find'), out = $('.ex-out');
  const p = new URLSearchParams(location.search);
  if (p.get('n')) find.number.value = p.get('n');
  try { find.email.value ||= localStorage.getItem('thryftly_email') || ''; } catch { /* ignore */ }
  if (!days) { find.hidden = true; out.innerHTML = '<p class="prose">Exchanges are handled by email for now: <a href="/contact.html">contact us</a> with your order number.</p>'; }
  let creds, order;
  find.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('button', find);
    btn.disabled = true; msg(find, 'LOOKING…'); out.innerHTML = '';
    try {
      creds = Object.fromEntries(new FormData(find));
      order = await api('/api/returns/lookup', creds);
      try { localStorage.setItem('thryftly_email', creds.email); } catch { /* ignore */ }
      msg(find, '');
      draw();
    } catch (err) { msg(find, err.message, true); }
    btn.disabled = false;
  });
  const RX = { requested: 'RECEIVED — WE REPLY WITHIN 2 WORKING DAYS', approved: 'APPROVED', rejected: 'NOT ACCEPTED', completed: 'DONE' };
  function draw() {
    const o = order, open = o.items.filter(i => i.left > 0);
    const past = o.requests.length ? `<div class="ex-past"><h2>YOUR REQUESTS</h2>${o.requests.map(r => `<p>${esc(r.number)} · ${r.type === 'return' ? 'RETURN' : 'EXCHANGE'} · <b class="yel">${RX[r.status] || esc(r.status)}</b>${r.reply ? `<br><small>${esc(r.reply)}</small>` : ''}</p>`).join('')}</div>` : '';
    if (!o.open || !open.length) { out.innerHTML = past + `<p class="prose">${esc(o.open ? 'Every piece in this order already has a request.' : o.why)}</p>`; return; }
    const reasons = o.reasons.map(r => `<option>${esc(r)}</option>`).join('');
    out.innerHTML = past + `<form class="co-form ex-form">
      <h2>ORDER ${esc(o.number)} <small>· OPEN UNTIL ${new Date(o.until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }).toUpperCase()}</small></h2>
      <div class="acct-tabs ex-type" role="tablist"><button type="button" data-t="exchange" class="on" aria-selected="true">EXCHANGE SIZE</button><button type="button" data-t="return" aria-selected="false">RETURN (DAMAGED / WRONG)</button></div>
      ${open.map(i => `<div class="ex-item" data-i="${i.index}">
        <label class="ex-pick"><input type="checkbox" name="pick"> <span class="ex-thumb" style="background-image:${esc(cssUrl(i.image))}"></span>
          <span><b>${esc(i.name)}</b><small>${esc([i.color, i.size].filter(Boolean).join(' / '))} · ×${i.left}</small></span></label>
        <div class="ex-opts" hidden>
          ${i.left > 1 ? `<select name="qty" aria-label="How many">${Array.from({ length: i.left }, (_, k) => `<option>${k + 1}</option>`).join('')}</select>` : '<input type="hidden" name="qty" value="1">'}
          <select name="reason" aria-label="Reason"><option value="">Why?</option>${reasons}</select>
          <select name="want" class="ex-want" aria-label="New size"><option value="">New size</option>${i.sizes.map(z => `<option>${esc(z)}</option>`).join('')}</select>
          ${i.sizes.length ? '' : '<small class="ex-nosize">No other size in stock right now: we will contact you.</small>'}
        </div></div>`).join('')}
      <textarea name="note" rows="3" maxlength="1000" placeholder="Anything else? (For damage, reply to our email with a photo.)"></textarea>
      <button class="btn-red">SEND REQUEST →</button>
      <p class="co-msg" aria-live="polite"></p></form>`;
    const f = $('.ex-form'); let type = 'exchange';
    $$('.ex-type button', f).forEach(b => b.addEventListener('click', () => {
      type = b.dataset.t;
      $$('.ex-type button', f).forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      $$('.ex-want, .ex-nosize', f).forEach(x => (x.hidden = type !== 'exchange'));
      $$('select[name=reason]', f).forEach(sel => { [...sel.options].forEach(op => (op.hidden = type === 'return' && op.value && !o.returnReasons.includes(op.value))); if (type === 'return' && sel.value && !o.returnReasons.includes(sel.value)) sel.value = ''; });
    }));
    $$('.ex-item', f).forEach(row => $('input[name=pick]', row).addEventListener('change', e => ($('.ex-opts', row).hidden = !e.target.checked)));
    f.addEventListener('submit', async e => {
      e.preventDefault();
      const items = $$('.ex-item', f).filter(r => $('input[name=pick]', r).checked).map(r => ({ index: +r.dataset.i, qty: +$('[name=qty]', r).value, reason: $('[name=reason]', r).value, want: type === 'exchange' ? ($('[name=want]', r).options.length > 1 ? $('[name=want]', r).value : 'ANY') : '' }));
      const btn = $('button.btn-red', f);
      btn.disabled = true;
      try {
        const r = await api('/api/returns', { ...creds, type, items, note: f.note.value });
        out.innerHTML = `<div class="co-form"><h2>REQUEST ${esc(r.number)} SENT ⚡</h2><p class="prose">We've emailed you a copy and will reply within 2 working days. Keep the piece unworn with its tags until then.</p><a class="btn-ghost" href="/track.html?n=${encodeURIComponent(o.number)}">BACK TO ORDER</a></div>`;
      } catch (err) { msg(f, err.message, true); btn.disabled = false; }
    });
  }
  if (find.number.value && find.email.value) find.requestSubmit();
}
