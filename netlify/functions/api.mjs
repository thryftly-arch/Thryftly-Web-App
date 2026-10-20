// Netlify runs the whole Express API as this one function. netlify.toml sends /api/* and /wp-json/*
// here with the path kept after the function prefix, which is stripped again before Express sees it.
import serverless from 'serverless-http';
import app from '../../server/index.js';

const run = serverless(app, {
  // There's no real socket, so give Express the visitor's IP (rate limits are per IP).
  request(req, event) {
    const h = event.headers || {};
    Object.defineProperty(req, 'ip', { value: h['x-nf-client-connection-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || '0.0.0.0' });
    // serverless-http hands over the body already read (a Buffer) and Express's parsers then skip it,
    // so parse it here. The Razorpay webhook keeps the raw bytes for its signature; multer reads the stream.
    const type = String(h['content-type'] || '').split(';')[0].trim(), buf = req.body;
    if (!Buffer.isBuffer(buf) || req.url.startsWith('/api/webhooks/')) return;
    if (type === 'application/json') { try { req.body = buf.length ? JSON.parse(buf) : {}; } catch { req.body = {}; } }
    else if (type === 'application/x-www-form-urlencoded') req.body = Object.fromEntries(new URLSearchParams(buf.toString()));
    else if (type.startsWith('text/')) req.body = buf.toString();
  },
});
export const handler = (event, context) => {
  event.path = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  // Rewrites hand over the visitor's original path: /sitemap.xml, /robots.txt, /feeds/google.xml live under /api.
  if (/^\/(sitemap\.xml|robots\.txt|feeds\/google\.xml)$/.test(event.path)) event.path = '/api' + event.path;
  return run(event, context);
};
