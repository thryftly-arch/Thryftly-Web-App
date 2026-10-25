// Customer invoice: the order is read with the number + email the shopper typed on Track order.
import { invoiceHtml } from './invoice.js';

const box = document.querySelector('.inv');
document.querySelector('.inv-print').addEventListener('click', () => print());
let creds = null;
try { const c = JSON.parse(localStorage.getItem('thryftly_invoice')); if (c && Date.now() - c.at < 30 * 60e3) creds = { number: c.number, email: c.email }; } catch { /* ignore */ }
if (!creds) box.innerHTML = '<p class="inv-msg">Open this from <a href="/track.html">Track order</a>: look up your order there, then press INVOICE.</p>';
else {
  try {
    const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b && JSON.stringify(b) }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
    const [o, site] = await Promise.all([post('/api/track', creds), fetch('/api/site').then(r => r.json())]);
    if (!o.paid) throw new Error('This order was never paid, so there is no invoice.');
    box.innerHTML = invoiceHtml(o, site.settings);
    document.title = `Invoice ${o.number} — THRYFTLY`;
  } catch (e) { box.innerHTML = `<p class="inv-msg">${String(e.message).replace(/</g, '&lt;')}</p>`; }
}
