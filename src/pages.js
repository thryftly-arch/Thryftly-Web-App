// Shop all, About, Contact, Policies and Track order. One script, switched by <body data-page>.
import { $, $$, esc, api, loadSite, money, bindSettings, mountChrome, productCard, richText, catLabel } from './shop.js';

const site = await loadSite();
mountChrome();
bindSettings(site.settings);
const page = document.body.dataset.page;
const msg = (form, t, err) => { const m = $('.co-msg', form); m.textContent = t; m.classList.toggle('err', !!err); };

/* ---------- shop all ---------- */
if (page === 'shop') {
  const params = new URLSearchParams(location.search);
  const state = { c: params.get('c') || 'ALL', q: params.get('q') || '', sort: params.get('sort') || 'featured' };
  const counts = site.products.reduce((m, p) => (m[p.category] = (m[p.category] || 0) + 1, m), {});
  const cats = ['ALL', ...Object.keys(counts).sort((a, b) => counts[b] - counts[a])];
  if (!cats.includes(state.c)) state.c = 'ALL';
  $('.shop-search').value = state.q;
  $('.shop-sort').value = state.sort;

  function render() {
    $('.chips').innerHTML = cats.map(c => `<button role="tab" class="chip${c === state.c ? ' on' : ''}" aria-selected="${c === state.c}" data-c="${esc(c)}">${esc(catLabel(c))} <span>${c === 'ALL' ? site.products.length : counts[c]}</span></button>`).join('');
    const q = state.q.trim().toLowerCase();
    let list = site.products.filter(p => (state.c === 'ALL' || p.category === state.c) && (!q || `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(q)));
    const sorts = { low: (a, b) => a.price - b.price, high: (a, b) => b.price - a.price, az: (a, b) => a.name.localeCompare(b.name) };
    if (sorts[state.sort]) list = [...list].sort(sorts[state.sort]);
    // "All" with no search: one section per category. A filter or search: one flat grid.
    const grouped = state.c === 'ALL' && !q;
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
    history.replaceState(null, '', location.pathname + (u.size ? '?' + u : ''));
  }
  $('.chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { state.c = b.dataset.c; render(); } });
  let t;
  $('.shop-search').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; render(); }, 150); });
  $('.shop-sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
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
      const o = await api('/api/track', Object.fromEntries(new FormData(form)));
      msg(form, '');
      $('.track-out').innerHTML = `
        <div class="co-sum"><span>ORDER</span><span>${esc(o.number)}</span><span>PLACED</span><span>${new Date(o.placed).toLocaleDateString()}</span>
        <span>TOTAL</span><span>${money(o.amount)}</span><span class="tot">STATUS</span><span class="tot">${esc(o.status)}</span></div>
        <ul class="track-items">${o.items.map(i => `<li>${i.qty} × ${esc(i.name)} (${esc([i.color, i.size].filter(Boolean).join(' / '))})</li>`).join('')}</ul>
        ${o.tracking ? `<a class="btn-red" href="${esc(o.tracking.url)}" target="_blank" rel="noopener">TRACK WITH ${esc((o.tracking.courier || 'COURIER').trim().toUpperCase())} →</a>` : '<p class="prose">A tracking link appears here once your order ships.</p>'}`;
    } catch (err) { msg(form, err.message, true); }
    btn.disabled = false;
  });
}
