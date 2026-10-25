// A printable invoice for one paid order. Used by the customer invoice page and by Admin → Orders.
// Prices on the site include GST; with a GST rate set in Admin → Site content, each line shows the
// taxable value and tax inside it (CGST + SGST inside the shop's state, IGST outside it).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function invoiceHtml(o, s) {
  const sym = s.symbol || '₹', m = n => esc(sym) + (Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rate = +s.gstRate || 0, c = o.customer;
  const shopState = (String(s.contact?.address || '').match(/,\s*([A-Za-z ]+?)\s*[-,]?\s*\d{6}/) || [])[1]?.trim().toLowerCase() || '';
  const intra = shopState && shopState === String(c.state || '').trim().toLowerCase();
  const net = v => v / (1 + rate / 100);
  // Discount spread over the lines by value, so each line's tax is on what was actually paid.
  const gross = o.items.reduce((t, i) => t + i.price * i.qty, 0), disc = o.discount?.amount || 0;
  const lines = o.items.map(i => { const paid = i.price * i.qty - (gross ? disc * (i.price * i.qty) / gross : 0); return { ...i, paid, taxable: net(paid), tax: paid - net(paid) }; });
  const ship = { paid: o.shipping || 0, taxable: net(o.shipping || 0), tax: (o.shipping || 0) - net(o.shipping || 0) };
  const tax = lines.reduce((t, l) => t + l.tax, 0) + ship.tax;
  const head = rate ? '<th>ITEM</th><th>QTY</th><th>RATE</th><th>TAXABLE</th><th>GST</th><th>AMOUNT</th>' : '<th>ITEM</th><th>QTY</th><th>RATE</th><th>AMOUNT</th>';
  const row = (name, qty, unit, l) => rate
    ? `<tr><td>${name}</td><td>${qty}</td><td>${unit}</td><td>${m(l.taxable)}</td><td>${m(l.tax)}</td><td>${m(l.paid)}</td></tr>`
    : `<tr><td>${name}</td><td>${qty}</td><td>${unit}</td><td>${m(l.paid)}</td></tr>`;
  const cols = rate ? 6 : 4;
  return `
    <header class="inv-head">
      <div><div class="inv-brand">⚡ THRYFTLY</div>
        <p>${esc(s.legalName || 'THRYFTLY')}${s.contact?.address ? '<br>' + esc(s.contact.address).replace(/\n/g, '<br>') : ''}${s.gstin ? `<br>GSTIN: <b>${esc(s.gstin)}</b>` : ''}${s.contact?.email ? '<br>' + esc(s.contact.email) : ''}</p></div>
      <div class="inv-meta"><h1>${s.gstin ? 'TAX INVOICE' : 'INVOICE'}</h1>
        <p>Invoice no. <b>${esc(o.number.toUpperCase())}</b><br>Date <b>${new Date(o.paidAt || o.placed).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</b>${o.paymentId ? `<br>Payment ${esc(o.paymentId)}` : ''}</p></div>
    </header>
    <section class="inv-to"><h2>BILL & SHIP TO</h2><p><b>${esc(c.name)}</b><br>${esc(c.address1)}${c.address2 ? '<br>' + esc(c.address2) : ''}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.zip)}<br>${esc(c.phone)} · ${esc(c.email)}</p>${rate ? `<p>Place of supply: <b>${esc(c.state)}</b></p>` : ''}</section>
    <table class="inv-table"><thead><tr>${head}</tr></thead><tbody>
      ${lines.map(l => row(`${esc(l.name)}<small>${esc([l.color, l.size].filter(Boolean).join(' / '))}</small>`, l.qty, m(l.price), l)).join('')}
      ${ship.paid ? row('Shipping', 1, m(ship.paid), ship) : ''}
    </tbody><tfoot>
      <tr><td colspan="${cols - 1}">Subtotal</td><td>${m(o.subtotal)}</td></tr>
      ${disc ? `<tr><td colspan="${cols - 1}">Discount${o.discount.code ? ` (${esc(o.discount.code)})` : ''}</td><td>−${m(disc)}</td></tr>` : ''}
      <tr><td colspan="${cols - 1}">Shipping</td><td>${o.shipping ? m(o.shipping) : 'FREE'}</td></tr>
      ${rate ? (intra ? `<tr><td colspan="${cols - 1}">CGST ${rate / 2}% (included)</td><td>${m(tax / 2)}</td></tr><tr><td colspan="${cols - 1}">SGST ${rate / 2}% (included)</td><td>${m(tax / 2)}</td></tr>` : `<tr><td colspan="${cols - 1}">IGST ${rate}% (included)</td><td>${m(tax)}</td></tr>`) : ''}
      <tr class="inv-total"><td colspan="${cols - 1}">TOTAL PAID</td><td>${m(o.amount)}</td></tr>
      ${o.refund ? `<tr><td colspan="${cols - 1}">Refunded ${new Date(o.refund.at).toLocaleDateString('en-IN')}</td><td>−${m(o.refund.amount)}</td></tr>` : ''}
    </tfoot></table>
    <p class="inv-foot">${rate ? 'All prices include GST.' : 'All prices include applicable taxes.'} This is a computer-generated invoice and needs no signature. Thanks for shopping with THRYFTLY.</p>`;
}
