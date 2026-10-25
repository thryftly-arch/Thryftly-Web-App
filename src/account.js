// Account page: sign in / create account / reset password, then orders (with reorder) and saved pieces.
import { $, $$, esc, cssUrl, loadSite, money, bindSettings, mountChrome, productCard, addToCart, getSaved, syncSaved } from './shop.js';
import { authOn, signedIn, signIn, signUp, signOut, sendReset, setPassword, takeLinkSession, accountApi } from './auth.js';

const site = await loadSite();
const link = authOn() ? takeLinkSession() : null; // before the header, so it already says ACCOUNT
mountChrome();
bindSettings(site.settings);
const msg = (el, t, err) => { el.textContent = t; el.classList.toggle('err', !!err); };
const show = which => ['out', 'reset', 'in'].forEach(k => ($(`.acct-${k}`).hidden = k !== which));

/* ---------- signed out ---------- */
const form = $('.acct-form'), fmsg = $('.co-msg', form);
let mode = 'in';
function setMode(m) {
  mode = m;
  $$('.acct-tabs button').forEach(b => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-selected', b.dataset.mode === m); });
  $('.btn-red', form).textContent = m === 'up' ? 'CREATE ACCOUNT →' : 'SIGN IN →';
  form.password.autocomplete = m === 'up' ? 'new-password' : 'current-password';
  form.password.placeholder = m === 'up' ? 'Password (6+ characters)' : 'Password';
  msg(fmsg, '');
}
$$('.acct-tabs button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
form.addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('.btn-red', form);
  btn.disabled = true; msg(fmsg, mode === 'up' ? 'CREATING YOUR ACCOUNT…' : 'SIGNING IN…');
  try {
    const s = mode === 'up' ? await signUp(form.email.value.trim(), form.password.value) : await signIn(form.email.value.trim(), form.password.value);
    if (!s) { msg(fmsg, 'ALMOST THERE: we sent you an email. Click the link in it to confirm your account, then sign in.'); setMode('in'); }
    else location.reload(); // header and saved list pick up the account
  } catch (err) { msg(fmsg, /invalid login/i.test(err.message) ? 'Wrong email or password.' : err.message, true); }
  btn.disabled = false;
});
$('.forgot', form).addEventListener('click', async () => {
  if (!form.email.reportValidity()) return;
  try { await sendReset(form.email.value.trim()); msg(fmsg, 'If that email has an account, a reset link is on its way.'); }
  catch (err) { msg(fmsg, err.message, true); }
});

/* ---------- new password (from the reset email) ---------- */
$('.reset-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, m = $('.co-msg', f);
  try { await setPassword(f.password.value); msg(m, 'PASSWORD SAVED.'); setTimeout(() => location.replace('/account.html'), 900); }
  catch (err) { msg(m, err.message, true); }
});

/* ---------- signed in ---------- */
const bySlug = Object.fromEntries(site.products.map(p => [p.slug, p]));
function drawSaved() {
  const list = getSaved().map(s => bySlug[s]).filter(Boolean);
  $('.saved-n').textContent = list.length;
  $('.acct-saved').innerHTML = list.length ? list.map(productCard).join('') : '<p class="prose">Nothing saved yet. Tap ♡ on any piece to keep it here, on every device you sign in on.</p>';
}

function drawOrders(orders) {
  $('.orders-n').textContent = orders.length;
  $('.acct-orders').innerHTML = orders.length ? orders.map((o, n) => `
    <article class="acct-order">
      <div class="acct-ohead">
        <span><b>${esc(o.number)}</b> · ${new Date(o.placed).toLocaleDateString()}</span>
        <span class="acct-status">${esc(o.status)}</span>
        <span class="acct-total">${money(o.amount)}</span>
      </div>
      <div class="acct-items">${o.items.map(i => `
        <a class="acct-item" href="/product.html?p=${encodeURIComponent(i.slug)}${i.color ? '&c=' + encodeURIComponent(i.color) : ''}">
          <span class="acct-thumb" style="background-image:${esc(cssUrl(i.image))}"></span>
          <span><b>${esc(i.name)}</b><br><small>${esc([i.color, i.size].filter(Boolean).join(' / '))} · ×${i.qty}</small></span></a>`).join('')}</div>
      <div class="acct-acts">
        <button class="btn-red reorder" type="button" data-n="${n}">REORDER →</button>
        ${o.tracking ? `<a class="btn-ghost" href="${esc(o.tracking.url)}" target="_blank" rel="noopener">TRACK PARCEL</a>` : `<a class="btn-ghost" href="/track.html?n=${encodeURIComponent(o.number)}">ORDER STATUS</a>`}
        <button class="btn-ghost invoice" type="button" data-n="${n}">INVOICE ↗</button>
        ${site.settings.exchangeDays && o.status !== 'CANCELLED & REFUNDED' ? `<a class="btn-ghost" href="/exchange.html?n=${encodeURIComponent(o.number)}">EXCHANGE</a>` : ''}
      </div>
    </article>`).join('') : '<p class="prose">No orders yet. Orders you place while signed in show up here.</p>';
  // Invoice: same lookup as Track order (number + the email on the order), handed over on this device for 30 minutes.
  $$('.invoice').forEach(b => b.addEventListener('click', () => {
    const o = orders[b.dataset.n];
    try { localStorage.setItem('thryftly_invoice', JSON.stringify({ number: o.number, email: o.email, at: Date.now() })); } catch { /* ignore */ }
    window.open('/invoice.html', '_blank', 'noopener');
  }));
  // Reorder: everything still on sale goes back in the cart at the same size and colour.
  $$('.reorder').forEach(b => b.addEventListener('click', () => {
    let added = 0, gone = [];
    for (const i of orders[b.dataset.n].items) {
      const p = bySlug[i.slug], v = p?.sizes.find(v => v.label === i.size && (v.color || '') === (i.color || ''));
      if (!v?.available) { gone.push(i.name); continue; }
      for (let k = 0; k < i.qty; k++) addToCart(i.slug, i.size, i.color);
      added++;
    }
    msg($('.acct-note'), gone.length ? `${gone.join(', ')} ${gone.length > 1 ? 'are' : 'is'} no longer available in that size/colour${added ? '; the rest is in your cart.' : '.'}` : '', !!gone.length);
    if (added) window.dispatchEvent(new CustomEvent('thryftly:drawer', { detail: 'cart' }));
  }));
}

async function signedInView() {
  show('in');
  $('.signout').addEventListener('click', async () => { await signOut(); location.replace('/account.html'); });
  drawSaved();
  window.addEventListener('thryftly:saved', drawSaved);
  syncSaved(true).then(drawSaved);
  try {
    const a = await accountApi('');
    $('.acct-email').textContent = a.email;
    $('.acct-name').textContent = a.email.split('@')[0].toUpperCase() + '.';
    drawOrders(a.orders);
  } catch (err) {
    if (err.status === 401) { await signOut(); return location.replace('/account.html'); }
    msg($('.acct-note'), err.message, true);
  }
}

if (!authOn()) {
  show('out');
  $$('input, button', form).forEach(el => (el.disabled = true));
  msg(fmsg, 'Accounts are not switched on yet.', true);
} else if (link?.error) {
  show('out'); msg(fmsg, link.error, true);
} else if (link?.type === 'recovery') show('reset');
else if (signedIn()) signedInView();
else show('out');
