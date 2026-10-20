// One-off move from this computer to Supabase: makes Supabase hold exactly what data/db.json and
// data/uploads/ hold here (products, orders, settings, pages, images). Safe to run again; images
// already in the bucket are skipped.
//   1. Run supabase/schema.sql in the Supabase SQL editor.
//   2. Put SUPABASE_URL and SUPABASE_SECRET_KEY in .env.
//   3. npm run push:supabase
import fs from 'node:fs';
import path from 'node:path';

try { process.loadEnvFile(); } catch { /* env from the shell */ }
const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const local = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
const S = await import('../server/store.js');
if (!S.remote) { console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env first.'); process.exit(1); }

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
const have = await S.listFiles();
const files = fs.readdirSync(path.join(dataDir, 'uploads')).filter(f => TYPES[path.extname(f).toLowerCase()] && !have.has(f));
console.log(`Images: ${have.size} already in Supabase, uploading ${files.length}…`);
let done = 0, failed = 0;
for (let i = 0; i < files.length; i += 8) {
  await Promise.all(files.slice(i, i + 8).map(async f => {
    try { await S.putFile(f, fs.readFileSync(path.join(dataDir, 'uploads', f)), TYPES[path.extname(f).toLowerCase()]); done++; }
    catch (e) { failed++; console.error(f, e.message); }
  }));
  process.stdout.write(`\r  ${done}/${files.length}`);
}
console.log(failed ? `\n${failed} images failed: run again to retry them.` : '\nImages done.');

await S.load();
for (const k of Object.keys(S.db)) delete S.db[k];
Object.assign(S.db, local);
await S.save();
console.log(`Data done: ${local.products.length} products, ${local.orders.length} orders, ${local.drops.length} drops, ${local.subscribers.length} subscribers.`);
