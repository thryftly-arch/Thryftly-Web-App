// Sets up Supabase Auth for the shop in one go:
//   - Site URL + allowed redirect links (so confirm/reset emails link to the shop, not localhost)
//   - SMTP: auth emails come from the shop's own address (e.g. thryftly@gmail.com), not Supabase
//   - THRYFTLY-branded templates for confirm / reset / magic link / email change / invite / code
// Needs in .env: SUPABASE_URL, SITE_URL, SMTP_USER, SMTP_PASS (+ optional SMTP_HOST, SMTP_PORT, MAIL_FROM)
// and SUPABASE_ACCESS_TOKEN (a personal access token: supabase.com/dashboard/account/tokens).
// Without the token it only writes the templates to supabase/templates/ to paste in by hand.
//   npm run setup:auth
import fs from 'node:fs';

try { process.loadEnvFile(); } catch { /* env from the shell */ }
const env = k => process.env[k] || '';
const site = env('SITE_URL').replace(/\/+$/, '');
if (!site || /localhost/.test(site)) { console.error('Set SITE_URL in .env to the live address (e.g. https://thryftly.netlify.app) first.'); process.exit(1); }

const { authTemplates } = await import('../server/mail.js');
const t = authTemplates();
fs.mkdirSync('supabase/templates', { recursive: true });
for (const [k, v] of Object.entries(t)) fs.writeFileSync(`supabase/templates/${k}.html`, `<!-- Subject: ${v.subject} -->\n${v.html}`);
console.log('Templates written to supabase/templates/.');

const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env('SUPABASE_URL'))?.[1];
if (!env('SUPABASE_ACCESS_TOKEN') || !ref) {
  console.log('No SUPABASE_ACCESS_TOKEN: paste them in Supabase → Authentication → Emails, and set the URLs and SMTP there by hand (README).');
  process.exit(0);
}
const from = /<([^>]+)>/.exec(env('MAIL_FROM'))?.[1] || env('SMTP_USER');
const body = {
  site_url: site,
  uri_allow_list: [`${site}/account.html`, `${site}/**`, 'http://localhost:5173/account.html'].join(','),
  ...(env('SMTP_USER') && env('SMTP_PASS') && {
    smtp_host: env('SMTP_HOST') || 'smtp.gmail.com', smtp_port: env('SMTP_PORT') || '465', smtp_user: env('SMTP_USER'), smtp_pass: env('SMTP_PASS'),
    smtp_admin_email: from, smtp_sender_name: 'THRYFTLY', rate_limit_email_sent: 100,
  }),
  ...Object.fromEntries(Object.entries(t).flatMap(([k, v]) => [[`mailer_subjects_${k}`, v.subject], [`mailer_templates_${k}_content`, v.html]])),
};
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH', headers: { Authorization: 'Bearer ' + env('SUPABASE_ACCESS_TOKEN'), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
if (!res.ok) { console.error('Supabase said', res.status, (await res.text()).slice(0, 400)); process.exit(1); }
console.log(`Done: Site URL ${site}, redirect links allowed, ${body.smtp_host ? `emails sent by ${from} via ${body.smtp_host}` : 'SMTP NOT set (add SMTP_USER/SMTP_PASS and run again)'}, branded templates live.`);
