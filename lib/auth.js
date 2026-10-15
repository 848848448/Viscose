const ITER = 100000;
const hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/.{2}/g).map(h => parseInt(h, 16)));

async function sha256(password) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password)));
}

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return 'pbkdf2$' + ITER + '$' + hex(salt) + '$' + await pbkdf2(password, salt);
}

// Returns { ok, upgrade }. upgrade = new hash to store when the old SHA-256 format matched.
export async function verifyPassword(password, stored) {
  if (!stored) return { ok: false };
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, salt, h] = stored.split('$');
    if (parseInt(iter) !== ITER) return { ok: false };
    return { ok: safeEqual(await pbkdf2(password, unhex(salt)), h) };
  }
  if (safeEqual(await sha256(password), stored)) return { ok: true, upgrade: await hashPassword(password) };
  return { ok: false };
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Best-effort failed-login throttle using the edge cache (no DB schema needed).
const rlKey = (id) => new Request('https://ratelimit.invalid/' + encodeURIComponent(id));
export async function tooManyAttempts(id) {
  try {
    const hit = await caches.default.match(rlKey(id));
    return hit ? parseInt(await hit.text()) >= 8 : false;
  } catch (e) { return false; }
}
export async function recordFailure(id) {
  try {
    const hit = await caches.default.match(rlKey(id));
    const n = hit ? parseInt(await hit.text()) + 1 : 1;
    await caches.default.put(rlKey(id), new Response(String(n), { headers: { 'Cache-Control': 'max-age=900' } }));
  } catch (e) {}
}
export async function clearFailures(id) {
  try { await caches.default.delete(rlKey(id)); } catch (e) {}
}

// Hard lockout backed by D1 table login_attempts(key, fails, first_at). Fails open if the table is missing.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
export async function isLocked(env, key) {
  try {
    const r = await env.DB.prepare("SELECT fails, first_at FROM login_attempts WHERE key = ?").bind(key).first();
    return !!r && Date.now() - r.first_at < WINDOW_MS && r.fails >= MAX_FAILS;
  } catch (e) { return false; }
}
export async function noteFailure(env, key) {
  try {
    const now = Date.now();
    const r = await env.DB.prepare("SELECT fails, first_at FROM login_attempts WHERE key = ?").bind(key).first();
    if (!r || now - r.first_at >= WINDOW_MS) {
      await env.DB.prepare("INSERT OR REPLACE INTO login_attempts (key, fails, first_at) VALUES (?, 1, ?)").bind(key, now).run();
    } else {
      await env.DB.prepare("UPDATE login_attempts SET fails = fails + 1 WHERE key = ?").bind(key).run();
    }
  } catch (e) {}
}
export async function noteSuccess(env, key) {
  try { await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run(); } catch (e) {}
}
