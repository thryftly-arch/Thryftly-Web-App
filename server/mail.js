// Shop emails, sent from the shop's own address over SMTP (Gmail by default: SMTP_USER + an App Password).
// Every email shares one branded layout; each builder returns { subject, html, text }.
// Nothing here throws: a mail problem is logged and never breaks an order.
import nodemailer from 'nodemailer';

const env = k => process.env[k] || '';
export const mailOn = () => !!(env('SMTP_USER') && env('SMTP_PASS'));
const site = () => (env('SITE_URL') || 'http://localhost:5173').replace(/\/+$/, '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let tx;
const transport = () => (tx ||= nodemailer.createTransport({
  host: env('SMTP_HOST') || 'smtp.gmail.com',
  port: +env('SMTP_PORT') || 465,
  secure: (+env('SMTP_PORT') || 465) === 465,
  auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') },
}));

export async function send(to, { subject, html, text }, { replyTo } = {}) {
  if (!mailOn() || !to) return false;
  try {
    await transport().sendMail({ from: env('MAIL_FROM') || `THRYFTLY <${env('SMTP_USER')}>`, to, subject, html, text, replyTo });
    return true;
  } catch (e) {
    console.error('mail failed:', subject, '→', to, e.message);
    return false;
  }
}
export const ownerEmail = () => env('OWNER_EMAIL') || env('SMTP_USER');

/* ---------- layout ---------- */
const F = "font-family:'Arial Black',Arial,Helvetica,sans-serif;";
const T = 'font-family:Arial,Helvetica,sans-serif;';
export const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#FF3B3B;color:#ffffff;${T}font-weight:800;font-size:13px;letter-spacing:2px;text-decoration:none;padding:14px 22px;border:2px solid #000000;">${esc(label)} &rarr;</a>`;
export const p = t => `<p style="margin:0 0 14px;${T}font-size:15px;line-height:1.6;color:#e8e8e8;">${t}</p>`;
const codeBox = (code, note) => `<div style="margin:18px 0;padding:16px;background:#FFD84D;border:2px solid #000;text-align:center;"><div style="${T}font-size:11px;letter-spacing:2px;color:#000;font-weight:700;">${esc(note)}</div><div style="${F}font-size:28px;letter-spacing:4px;color:#000;margin-top:6px;">${esc(code)}</div></div>`;

// title: big headline; accent: the red word after it. footer: extra footer line (e.g. unsubscribe).
export function layout({ title, accent = '', body, preheader = '', footer = '' }) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#0b0b0c;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0c;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#141416;border:3px solid #000000;">
<tr><td style="background:#FFD84D;padding:16px 24px;border-bottom:3px solid #000;"><a href="${site()}" style="${F}font-size:22px;letter-spacing:3px;color:#000000;text-decoration:none;">&#9889; THRYFTLY</a></td></tr>
<tr><td style="padding:30px 24px 26px;">
<h1 style="margin:0 0 18px;${F}font-style:italic;font-size:30px;line-height:1.05;color:#ffffff;">${esc(title)}${accent ? ` <span style="color:#FF3B3B;">${esc(accent)}</span>` : ''}</h1>
${body}
</td></tr>
<tr><td style="padding:16px 24px 22px;border-top:1px solid #26262a;${T}font-size:12px;line-height:1.7;color:#8a8a90;">
<a href="${site()}/shop.html" style="color:#FFD84D;text-decoration:none;">SHOP</a> &nbsp;·&nbsp; <a href="${site()}/account.html" style="color:#FFD84D;text-decoration:none;">ACCOUNT</a> &nbsp;·&nbsp; <a href="${site()}/track.html" style="color:#FFD84D;text-decoration:none;">TRACK ORDER</a> &nbsp;·&nbsp; <a href="${site()}/contact.html" style="color:#FFD84D;text-decoration:none;">CONTACT</a><br>
Printed to order, shipped across India.${footer ? '<br>' + footer : ''}
</td></tr></table></td></tr></table></body></html>`;
  return { html, text: textOf(html) };
}

// Plain-text twin of an email (shown by mail apps that don't do HTML, and good for spam scores).
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ', times: '×', minus: '−', rarr: '→', middot: '·' };
function textOf(html) {
  return html.replace(/<head>[^]*?<\/head>/, '').replace(/<div style="display:none[^]*?<\/div>/, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, (m, href, label) => (/^https?:/.test(href) ? `${label.trim()} (${href})` : label))
    .replace(/<\/(td|th)>/g, '  ').replace(/<(br|\/p|\/tr|\/h1|\/div)[^>]*>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|[a-z]+);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(+e.slice(1)) : ENT[e] ?? m))
    .split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* ---------- order pieces ---------- */
const money = (sym, n) => esc(sym) + Number(n).toLocaleString('en-IN');
// img(u): absolute image URL for the email (the caller knows where images live).
function itemsTable(order, sym, img) {
  const rows = order.items.map(i => `<tr>
<td width="64" style="padding:8px 0;"><img src="${esc(img(i.image))}" width="56" height="70" alt="" style="display:block;width:56px;height:70px;object-fit:cover;background:#f2f2f2;border:2px solid #000;"></td>
<td style="padding:8px 12px;${T}font-size:14px;color:#ffffff;"><b>${esc(i.name)}</b><br><span style="color:#9a9aa0;font-size:12px;">${esc([i.color, i.size].filter(Boolean).join(' / '))} &times; ${i.qty}</span></td>
<td align="right" style="padding:8px 0;${T}font-size:14px;color:#ffffff;white-space:nowrap;">${money(sym, i.price * i.qty)}</td></tr>`).join('');
  const line = (k, v, strong) => `<tr><td colspan="2" style="padding:4px 0;${T}font-size:${strong ? 16 : 13}px;color:${strong ? '#FFD84D' : '#c8c8cc'};${strong ? 'font-weight:800;' : ''}">${k}</td><td align="right" style="padding:4px 0;${T}font-size:${strong ? 16 : 13}px;color:${strong ? '#FFD84D' : '#c8c8cc'};${strong ? 'font-weight:800;' : ''}white-space:nowrap;">${v}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border-top:1px solid #26262a;">${rows}
<tr><td colspan="3" style="border-top:1px solid #26262a;padding-top:8px;"></td></tr>
${line('Subtotal', money(sym, order.subtotal))}${order.discount ? line(`Discount (${esc(order.discount.code)})`, '&minus;' + money(sym, order.discount.amount)) : ''}${line('Shipping', order.shipping ? money(sym, order.shipping) : 'FREE')}${line('Total', money(sym, order.amount), true)}</table>`;
}
const address = c => `<p style="margin:0 0 18px;${T}font-size:13px;line-height:1.6;color:#c8c8cc;"><b style="color:#fff;">Shipping to</b><br>${esc(c.name)}<br>${esc(c.address1)}${c.address2 ? '<br>' + esc(c.address2) : ''}<br>${esc(c.city)}, ${esc(c.state)} ${esc(c.zip)}<br>${esc(c.phone)}</p>`;
const trackUrl = o => `${site()}/track.html?n=${encodeURIComponent(o.number)}`;
const first = name => esc(String(name || '').trim().split(/\s+/)[0] || 'there');

/* ---------- customer emails ---------- */
export const orderConfirmed = (o, sym, img) => ({
  subject: `Order ${o.number} confirmed ⚡`,
  ...layout({ title: "YOU'RE", accent: 'CHARGED.', preheader: `We've got your order ${o.number}. It goes to print now.`,
    body: p(`Hey ${first(o.customer.name)}, thanks for your order. Every piece is printed to order, so it goes into production now. We'll email you again the moment it ships.`)
      + p(`<b style="color:#fff;">Order ${esc(o.number)}</b> · ${new Date(o.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`)
      + itemsTable(o, sym, img) + address(o.customer) + button(trackUrl(o), 'TRACK YOUR ORDER') }),
});

export const orderShipped = (o, sym, img) => ({
  subject: `Your order ${o.number} has shipped 📦`,
  ...layout({ title: "IT'S ON", accent: 'THE WAY.', preheader: `Order ${o.number} is with ${o.tracking?.courier || 'the courier'}.`,
    body: p(`Good news, ${first(o.customer.name)}: order <b style="color:#fff;">${esc(o.number)}</b> has left the print shop${o.tracking?.courier ? ` with <b style="color:#fff;">${esc(o.tracking.courier)}</b>` : ''}.`)
      + (o.tracking?.awb ? p(`Tracking number: <b style="color:#FFD84D;">${esc(o.tracking.awb)}</b>`) : '')
      + button(o.tracking?.url || trackUrl(o), 'TRACK YOUR PARCEL') + '<div style="height:18px"></div>' + itemsTable(o, sym, img) }),
});

export const orderDelivered = (o, sym, img) => ({
  subject: `Delivered: order ${o.number}`,
  ...layout({ title: 'DELIVERED.', accent: 'WEAR IT LOUD.', preheader: `Order ${o.number} has been delivered.`,
    body: p(`Your order <b style="color:#fff;">${esc(o.number)}</b> has been delivered. We hope it hits.`)
      + p(`Something wrong with it? Reply to this email within 7 days with a photo and we'll sort it out.`)
      + button(`${site()}/shop.html`, 'SHOP MORE') }),
});

export const orderRefunded = (o, sym) => ({
  subject: `Refund for order ${o.number}`,
  ...layout({ title: 'REFUND', accent: 'ON ITS WAY.', preheader: `We've refunded ${money(sym, o.refund?.amount ?? o.amount)}.`,
    body: p(`Hi ${first(o.customer.name)}, we've cancelled order <b style="color:#fff;">${esc(o.number)}</b> and refunded <b style="color:#FFD84D;">${money(sym, o.refund?.amount ?? o.amount)}</b> to your original payment method.`)
      + p('Refunds usually reach your account in 5–7 working days, depending on your bank.')
      + p('Questions? Just reply to this email.') }),
});

export const welcomeAccount = (email, code) => ({
  subject: 'Welcome to THRYFTLY ⚡',
  ...layout({ title: "YOU'RE", accent: 'IN.', preheader: 'Your account is ready.' + (code ? ` Here's ${code} for your first order.` : ''),
    body: p('Your THRYFTLY account is live. Save pieces with ♡ and they follow you to every device. Every order you place shows up in your account, ready to reorder in one tap.')
      + (code ? codeBox(code, 'YOUR FIRST-ORDER CODE') + p('Enter it at checkout.') : '')
      + button(`${site()}/shop.html`, 'START SHOPPING') }),
});

export const welcomeSubscriber = (email, code, unsubscribeUrl) => ({
  subject: "You're on the list ⚡",
  ...layout({ title: "YOU'RE ON", accent: 'THE LIST.', preheader: 'First to know about new drops.',
    body: p("You'll hear about new drops before anyone else. No spam, just the good stuff.")
      + (code ? codeBox(code, 'A LITTLE SOMETHING FOR SIGNING UP') + p('Use it at checkout on your first order.') : '')
      + button(`${site()}/shop.html`, 'SHOP NOW'),
    footer: `<a href="${esc(unsubscribeUrl)}" style="color:#8a8a90;">Unsubscribe</a>` }),
});

export const contactAutoReply = m => ({
  subject: 'We got your message',
  ...layout({ title: 'GOT IT.', accent: "WE'LL BE IN TOUCH.", preheader: 'Thanks for reaching out.',
    body: p(`Hi ${first(m.name)}, thanks for writing to us. We usually reply within one working day.`)
      + `<div style="margin:0 0 16px;padding:14px;border-left:3px solid #FFD84D;background:#0b0b0c;${T}font-size:13px;line-height:1.6;color:#c8c8cc;white-space:pre-wrap;">${esc(m.message)}</div>` }),
});

export const cartReminder = (o, sym, img, restoreUrl, code) => ({
  subject: 'You left something behind 👀',
  ...layout({ title: 'STILL', accent: 'THINKING?', preheader: 'Your cart is saved. Pick up where you left off.',
    body: p(`Hey ${first(o.customer.name)}, you were this close. Your pieces are saved: finish checking out whenever you're ready.`)
      + itemsTable({ ...o, discount: null }, sym, img)
      + (code ? codeBox(code, 'USE THIS CODE AT CHECKOUT') : '')
      + button(restoreUrl, 'FINISH YOUR ORDER') }),
});

/* ---------- emails to the shop ---------- */
export const newOrderAlert = (o, sym, img) => ({
  subject: `🟡 New order ${o.number}: ${money(sym, o.amount)}`,
  ...layout({ title: 'NEW', accent: 'ORDER.', preheader: `${o.customer.name}, ${o.customer.city}: ${money(sym, o.amount)}`,
    body: p(`<b style="color:#fff;">${esc(o.customer.name)}</b> · ${esc(o.customer.email)} · ${esc(o.customer.phone)}`)
      + itemsTable(o, sym, img) + address(o.customer)
      + p(o.status === 'sent_to_qikink' ? '✅ Sent to Qikink automatically.' : `⚠️ Not sent to Qikink: ${esc(o.fulfillmentError || o.status)}. Open Admin → Orders and press RETRY.`)
      + button(`${site()}/admin.html`, 'OPEN ADMIN') }),
});

export const contactToOwner = m => ({
  subject: `Message from ${m.name}${m.order ? ` (order ${m.order})` : ''}`,
  ...layout({ title: 'NEW', accent: 'MESSAGE.', preheader: m.message.slice(0, 90),
    body: p(`<b style="color:#fff;">${esc(m.name)}</b> · ${esc(m.email)}${m.order ? ` · order ${esc(m.order)}` : ''}`)
      + `<div style="margin:0 0 16px;padding:14px;border-left:3px solid #FFD84D;background:#0b0b0c;${T}font-size:14px;line-height:1.6;color:#e8e8e8;white-space:pre-wrap;">${esc(m.message)}</div>`
      + p('Reply to this email to answer them directly.') }),
});

/* ---------- Supabase Auth templates (Go templates, filled in by Supabase) ---------- */
// Pushed by tools/setup-supabase-auth.js. {{ .ConfirmationURL }} etc. are left for Supabase to fill.
const raw = (href, label) => button('HREF', label).replace('HREF', href);
export const authTemplates = () => ({
  confirmation: { subject: 'Confirm your THRYFTLY account', html: layout({ title: 'ONE', accent: 'CLICK.', preheader: 'Confirm your email to finish signing up.',
    body: p('Confirm your email and your THRYFTLY account is ready: saved pieces on every device, every order in one place.') + raw('{{ .ConfirmationURL }}', 'CONFIRM MY EMAIL') + '<div style="height:16px"></div>' + p('<span style="color:#8a8a90;font-size:12px;">Didn\'t sign up? Ignore this email.</span>') }).html },
  recovery: { subject: 'Reset your THRYFTLY password', html: layout({ title: 'NEW', accent: 'PASSWORD?', preheader: 'Reset link inside. It expires in an hour.',
    body: p('Someone (hopefully you) asked to reset the password for this account. The link works once and expires in an hour.') + raw('{{ .ConfirmationURL }}', 'CHOOSE A NEW PASSWORD') + '<div style="height:16px"></div>' + p('<span style="color:#8a8a90;font-size:12px;">Didn\'t ask for this? Ignore this email; your password stays the same.</span>') }).html },
  magic_link: { subject: 'Your THRYFTLY sign-in link', html: layout({ title: 'SIGN', accent: 'IN.', preheader: 'Your one-time sign-in link.',
    body: p('Tap below to sign in. The link works once and expires in an hour.') + raw('{{ .ConfirmationURL }}', 'SIGN ME IN') }).html },
  email_change: { subject: 'Confirm your new email', html: layout({ title: 'NEW', accent: 'EMAIL?', preheader: 'Confirm the change to your THRYFTLY email.',
    body: p('Confirm that <b style="color:#fff;">{{ .NewEmail }}</b> should be the email on your THRYFTLY account.') + raw('{{ .ConfirmationURL }}', 'CONFIRM NEW EMAIL') }).html },
  invite: { subject: "You're invited to THRYFTLY", html: layout({ title: "YOU'RE", accent: 'INVITED.', preheader: 'Set up your THRYFTLY account.',
    body: p('Accept the invite to set up your account.') + raw('{{ .ConfirmationURL }}', 'ACCEPT INVITE') }).html },
  reauthentication: { subject: 'Your THRYFTLY confirmation code', html: layout({ title: 'YOUR', accent: 'CODE.', preheader: 'Enter this code to continue.',
    body: p('Enter this code to continue:') + codeBox('{{ .Token }}', 'CONFIRMATION CODE') }).html },
});
