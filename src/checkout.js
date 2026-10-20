import { $, $$, esc, cssUrl, api, loadSite, money, bindSettings, getCart, setCart, mountChrome } from './shop.js';

const site = await loadSite();
mountChrome();
bindSettings(site.settings);
const bySlug = Object.fromEntries(site.products.map(p => [p.slug, p]));
const form = $('.co-form');
const msg = (t, err) => { const m = $('.co-msg'); m.textContent = t; m.classList.toggle('err', !!err); };

// Remember the address on this device only.
const ADDR = 'thryftly_addr';
try { const a = JSON.parse(localStorage.getItem(ADDR)) || {}; for (const [k, v] of Object.entries(a)) if (form[k]) form[k].value = v; } catch { /* ignore */ }

async function render() {
  const items = getCart().filter(i => bySlug[i.slug]);
  setCart(items);
  if (!items.length) {
    $('.co-lines').innerHTML = '<div class="co-empty">NOTHING CHARGED UP YET.<a class="btn-red" href="/#shop">SHOP THE DROP →</a></div>';
    form.hidden = true;
    return;
  }
  form.hidden = false;
  $('.co-lines').innerHTML = items.map((i, n) => {
    const p = bySlug[i.slug];
    const v = p.sizes.find(v => v.label === i.size && (v.color || '') === (i.color || ''));
    return `<div class="co-line">
      <div class="co-thumb" style="background-image:${esc(cssUrl(p.colorImages?.[i.color] || p.images.front))}"></div>
      <div><div class="co-name">${esc(p.name)}</div><div class="co-meta">${esc(i.size)} · ${esc(i.color || p.color)}</div>
        <div class="co-qty"><button type="button" data-n="${n}" data-d="-1" aria-label="Less">−</button>${i.qty}<button type="button" data-n="${n}" data-d="1" aria-label="More">+</button>
        <button type="button" class="co-remove" data-n="${n}">REMOVE</button></div></div>
      <div class="co-price">${money((v?.price || p.price) * i.qty)}</div></div>`;
  }).join('');
  try {
    const q = await api('/api/cart/quote', { items });
    $('.co-sum').innerHTML = `<span>SUBTOTAL</span><span>${money(q.subtotal)}</span><span>SHIPPING</span><span>${q.shipping ? money(q.shipping) : 'FREE'}</span><span class="tot">TOTAL</span><span class="tot">${money(q.amount)}</span>`;
    $('.co-pay').disabled = !site.payments;
    msg(site.payments ? '' : 'Checkout is not live yet — payments are being set up.', !site.payments);
  } catch (e) {
    $('.co-sum').innerHTML = '';
    $('.co-pay').disabled = true;
    msg(e.message, true);
  }
}

$('.co-lines').addEventListener('click', e => {
  const b = e.target.closest('button[data-n]');
  if (!b) return;
  const items = getCart().filter(i => bySlug[i.slug]);
  const it = items[b.dataset.n];
  if (b.classList.contains('co-remove')) items.splice(b.dataset.n, 1);
  else it.qty = Math.min(5, Math.max(1, it.qty + +b.dataset.d));
  setCart(items);
  render();
});

const loadRazorpay = () => window.Razorpay ? Promise.resolve() : new Promise((ok, bad) => {
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = ok; s.onerror = () => bad(new Error('Could not load the payment window. Check your connection.'));
  document.head.append(s);
});

form.addEventListener('submit', async e => {
  e.preventDefault();
  const customer = Object.fromEntries(new FormData(form));
  try { localStorage.setItem(ADDR, JSON.stringify(customer)); } catch { /* ignore */ }
  const pay = $('.co-pay');
  pay.disabled = true;
  msg('OPENING SECURE PAYMENT…');
  try {
    const [order] = await Promise.all([api('/api/checkout', { items: getCart(), customer }), loadRazorpay()]);
    new window.Razorpay({
      key: order.key,
      order_id: order.razorpayOrderId,
      amount: order.amount,
      currency: order.currency,
      name: 'THRYFTLY',
      description: `Order ${order.number}`,
      prefill: { name: customer.name, email: customer.email, contact: customer.phone },
      theme: { color: '#FF3B3B' },
      modal: { ondismiss: () => { pay.disabled = false; msg('Payment cancelled. Your cart is still here.'); } },
      handler: async resp => {
        msg('CONFIRMING PAYMENT…');
        try {
          const r = await api('/api/checkout/verify', { orderId: order.orderId, ...resp });
          setCart([]);
          $('.co').innerHTML = `<div class="co-done"><h1 class="co-h1">YOU'RE <span class="volt">CHARGED.</span></h1>
            <span>ORDER ${esc(r.number)} IS CONFIRMED. A RECEIPT IS ON ITS WAY TO ${esc(customer.email)}.</span>
            <div style="display:flex;gap:14px;flex-wrap:wrap"><a class="btn-red" href="/track.html?n=${encodeURIComponent(r.number)}">TRACK THIS ORDER →</a><a class="btn-ghost" href="/shop.html">KEEP SHOPPING</a></div></div>`;
        } catch (err) {
          msg(`Payment received but confirmation failed (${err.message}). Don't pay again — contact us with order ${order.number}.`, true);
        }
      },
    }).open();
  } catch (err) {
    pay.disabled = false;
    msg(err.message, true);
  }
});

render();
