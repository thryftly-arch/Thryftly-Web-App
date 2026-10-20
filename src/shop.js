// Shared storefront helpers: API, cart, formatting, safe rendering.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Admin-provided URLs are already restricted server-side; this keeps them inert inside CSS url().
export const cssUrl = u => (u ? `url("${encodeURI(u).replace(/"/g, '%22')}")` : '');

export async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`);
  return j;
}

let site;
export const loadSite = async () => (site ??= await api('/api/site'));
export const money = n => site.settings.symbol + (Number.isInteger(+n) ? n : (+n).toFixed(2));

/* ---------- cart (localStorage, can be unavailable) ---------- */
const KEY = 'thryftly_cart';
export function getCart() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
}
export function setCart(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode */ }
  updateCartCount();
}
export function addToCart(slug, size, color = '') {
  const items = getCart();
  const hit = items.find(i => i.slug === slug && i.size === size && (i.color || '') === color);
  // Cap at 5 and let the server enforce real stock.
  hit ? (hit.qty = Math.min(5, hit.qty + 1)) : items.push({ slug, size, color, qty: 1 });
  setCart(items);
}
export function updateCartCount() {
  const n = getCart().reduce((t, i) => t + i.qty, 0);
  $$('.cart-count').forEach(c => (c.textContent = n));
}

/* ---------- settings → page ---------- */
export function bindSettings(s) {
  $$('[data-s]').forEach(el => { if (s[el.dataset.s] != null) el.textContent = s[el.dataset.s]; });
  $$('[data-social]').forEach(a => {
    const u = s.socials?.[a.dataset.social];
    if (u && /^https:\/\//.test(u)) a.href = u; else a.removeAttribute('target');
  });
  updateCartCount();
}
