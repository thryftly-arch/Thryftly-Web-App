// Copy the whole shop from one Supabase project to another (e.g. to move it to another region):
// every row of the "thryftly" table and every image in the "uploads" bucket. Safe to run again.
// Customer logins (Supabase Auth users) are not copied: customers sign up again on the new project.
//   .env: OLD_SUPABASE_URL + OLD_SUPABASE_SECRET_KEY = the project you're leaving
//         SUPABASE_URL + SUPABASE_SECRET_KEY          = the new project (schema.sql already run)
//   npm run copy:supabase
try { process.loadEnvFile(); } catch { /* env from the shell */ }
const OLD = (process.env.OLD_SUPABASE_URL || '').replace(/\/+$/, ''), OKEY = process.env.OLD_SUPABASE_SECRET_KEY || '';
if (!OLD || !OKEY) { console.error('Set OLD_SUPABASE_URL and OLD_SUPABASE_SECRET_KEY (the project you are leaving) in .env.'); process.exit(1); }
if (OLD === (process.env.SUPABASE_URL || '').replace(/\/+$/, '')) { console.error('SUPABASE_URL must point at the NEW project.'); process.exit(1); }
const S = await import('../server/store.js');
if (!S.remote) { console.error('Set SUPABASE_URL and SUPABASE_SECRET_KEY to the new project.'); process.exit(1); }

const old = async (path, opts = {}) => {
  const res = await fetch(OLD + path, { ...opts, headers: { apikey: OKEY, ...(OKEY.startsWith('eyJ') && { Authorization: 'Bearer ' + OKEY }), ...opts.headers } });
  if (!res.ok) throw new Error(`old project ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
};

// 1. Images
const names = [];
for (let offset = 0; ; offset += 1000) {
  const page = await (await old('/storage/v1/object/list/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: '', limit: 1000, offset }) })).json();
  names.push(...page.map(f => f.name));
  if (page.length < 1000) break;
}
const have = await S.listFiles();
const todo = names.filter(n => !have.has(n));
console.log(`Images: ${names.length} in the old project, ${have.size} already in the new one, copying ${todo.length}…`);
let done = 0, failed = 0;
for (let i = 0; i < todo.length; i += 8) {
  await Promise.all(todo.slice(i, i + 8).map(async n => {
    try {
      const r = await old(`/storage/v1/object/public/uploads/${encodeURIComponent(n)}`);
      await S.putFile(n, Buffer.from(await r.arrayBuffer()), r.headers.get('content-type') || 'application/octet-stream');
      done++;
    } catch (e) { failed++; console.error('\n' + n, e.message); }
  }));
  process.stdout.write(`\r  ${done}/${todo.length}`);
}
console.log(failed ? `\n${failed} images failed: run again to retry them.` : '\nImages done.');

// 2. Rows (products, orders, settings, wishlists, everything)
const rows = [];
for (let off = 0; ; off += 1000) {
  const page = await (await old(`/rest/v1/thryftly?select=coll,id,data,updated_at&order=coll,id&limit=1000&offset=${off}`)).json();
  rows.push(...page);
  if (page.length < 1000) break;
}
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
for (let i = 0; i < rows.length; i += 200) {
  const res = await fetch(URL_ + '/rest/v1/thryftly', {
    method: 'POST',
    headers: { apikey: KEY, ...(KEY.startsWith('eyJ') && { Authorization: 'Bearer ' + KEY }), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.slice(i, i + 200)),
  });
  if (!res.ok) { console.error('new project said', res.status, (await res.text()).slice(0, 300)); process.exit(1); }
}
const count = rows.reduce((m, r) => ((m[r.coll] = (m[r.coll] || 0) + 1), m), {});
console.log('Rows copied:', Object.entries(count).map(([k, v]) => `${v} ${k}`).join(', '));
