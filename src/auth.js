// Customer sign-in with Supabase Auth, straight from the browser (passwords never touch our server).
// The session lives in localStorage; our API gets the access token as a Bearer header and checks it
// with Supabase. Off when the server has no SUPABASE_PUBLISHABLE_KEY (site.auth is null).
let cfg = null;
export const setAuthConfig = c => { cfg = c; };
export const authOn = () => !!cfg;

const KEY = 'thryftly_session';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const write = s => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* private mode */ } };
export const session = () => read();
export const signedIn = () => !!read()?.refresh_token;

async function gotrue(path, { body, method = 'POST', token } = {}) {
  const res = await fetch(cfg.url + '/auth/v1' + path, {
    method, headers: { apikey: cfg.key, 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.msg || j.error_description || j.message || 'Something went wrong. Try again.');
  return j;
}
// The email inside an access token (links from emails carry only the token).
const tokenEmail = t => { try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch { return ''; } };
// Supabase answers with { access_token, refresh_token, expires_in, user } when a session starts.
const keep = j => {
  if (!j.access_token) return null;
  const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, email: j.user?.email || tokenEmail(j.access_token) || read()?.email || '' };
  write(s);
  return s;
};

export const signIn = async (email, password) => keep(await gotrue('/token?grant_type=password', { body: { email, password } }));
// With "Confirm email" on in Supabase there's no session yet: the caller tells them to check their inbox.
// redirect_to: the confirm link brings them back here (Supabase falls back to its Site URL otherwise).
export const signUp = async (email, password) => keep(await gotrue('/signup?redirect_to=' + encodeURIComponent(location.origin + '/account.html'), { body: { email, password } }));
export const sendReset = email => gotrue('/recover?redirect_to=' + encodeURIComponent(location.origin + '/account.html'), { body: { email } });
export async function setPassword(password) { await gotrue('/user', { method: 'PUT', body: { password }, token: await token() }); }
export async function signOut() {
  const s = read();
  write(null);
  try { sessionStorage.removeItem('thryftly_saved_sync'); } catch { /* ignore */ }
  if (s) await gotrue('/logout', { token: s.access_token }).catch(() => {});
}

// Links from Supabase emails (confirm, reset) land on /account.html#access_token=…&type=…
export function takeLinkSession() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.get('access_token')) return h.get('error_description') ? { error: h.get('error_description') } : null;
  keep({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_in: +h.get('expires_in') });
  history.replaceState(null, '', location.pathname + location.search);
  return { type: h.get('type') };
}

// A fresh access token, refreshing it when it's about to run out. Null when signed out.
export async function token() {
  const s = read();
  if (!s?.refresh_token || !cfg) return null;
  if (s.expires_at - Date.now() > 60e3) return s.access_token;
  try { return keep(await gotrue('/token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })).access_token; }
  catch { write(null); return null; }
}

// Our own API, as the signed-in customer.
export async function accountApi(path, { method = 'GET', body } = {}) {
  const t = await token();
  if (!t) throw Object.assign(new Error('Sign in again'), { status: 401 });
  const res = await fetch('/api/account' + path, { method, headers: { Authorization: 'Bearer ' + t, ...(body && { 'Content-Type': 'application/json' }) }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.error || 'Request failed'), { status: res.status });
  return j;
}
