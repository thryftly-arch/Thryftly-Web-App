// When an order really shipped / was delivered, from what Qikink reports.
// Qikink gives every order a courier, an AWB, a tracking link and an "In-Transit" status within minutes of
// creation, long before it's printed (even cancelled orders have a tracking link). So:
//   shipped   = Qikink says it's moving AND the print + dispatch window (business days after payment) has passed
//   delivered = Qikink recorded a delivery date (or the status is exactly "Delivered")

// t + n business days (Mon–Fri).
export function addWorkdays(t, n) {
  const d = new Date(t);
  for (let k = 0; k < n;) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) k++; }
  return +d;
}

// Copy Qikink's view onto the order (status, tracking, delivery date). Doesn't decide anything by itself.
export function applyQikinkStatus(o, q) {
  o.qikinkStatus = q.status;
  if (q.shipping?.tracking_link) o.tracking = { awb: q.shipping.awb, url: q.shipping.tracking_link, courier: q.shipping.courier_provider_name };
  const bad = /undeliver|rto|return|cancel/i.test(q.status || '');
  if (!bad && !o.deliveredAt && (q.delivered_on || /^delivered$/i.test(q.status || ''))) {
    const t = q.delivered_on ? Date.parse(String(q.delivered_on).replace(' ', 'T') + '+05:30') : NaN; // Qikink times are IST
    o.deliveredAt = new Date(isNaN(t) ? Date.now() : t).toISOString();
  }
}

export const isDelivered = o => !!o.deliveredAt;
export const isShipped = (o, dispatchMin = 2, now = Date.now()) =>
  isDelivered(o) || (!!o.paidAt && /transit|picked|out for|manifest|dispatch|ship/i.test(o.qikinkStatus || '') && now >= addWorkdays(Date.parse(o.paidAt), dispatchMin));
