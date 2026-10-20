// Runs after `vite build` on Netlify: serve /uploads/* from the Supabase Storage bucket,
// so image paths stored in the database (/uploads/abc.webp) work unchanged.
import fs from 'node:fs';

const sb = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
if (!sb) {
  console.error('SUPABASE_URL is not set: product images will not load. Add it in Netlify → Environment variables.');
  process.exit(1);
}
fs.writeFileSync('dist/_redirects', `/uploads/*  ${sb}/storage/v1/object/public/uploads/:splat  200\n`);
console.log('dist/_redirects: /uploads → ' + sb);
