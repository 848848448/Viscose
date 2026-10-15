import { verifyPassword, tooManyAttempts, recordFailure, clearFailures } from '../../lib/auth.js';

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost(context) {
  const { env } = context;
  let body;
  try { body = await context.request.json(); } catch (e) { return json({ error: 'Invalid request' }, 400); }
  const { email, password } = body || {};

  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return json({ error: 'Missing email or password' }, 400);
  }

  const mail = email.toLowerCase().trim();
  const ip = context.request.headers.get('CF-Connecting-IP') || '';
  const keys = ['e:' + mail, 'i:' + ip];
  for (const k of keys) {
    if (await tooManyAttempts(k)) return json({ error: 'Too many attempts. Try again in 15 minutes.' }, 429);
  }

  const row = await env.DB.prepare("SELECT id, email, name, role, password_hash FROM users WHERE email = ?").bind(mail).first();
  const res = row ? await verifyPassword(password, row.password_hash) : { ok: false };

  if (!res.ok) {
    for (const k of keys) await recordFailure(k);
    return json({ error: 'Invalid credentials' }, 401);
  }
  await clearFailures('e:' + mail);

  if (res.upgrade) {
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(res.upgrade, row.id).run();
  }

  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();

  const user = { id: row.id, email: row.email, name: row.name, role: row.role };
  const token = generateToken();
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, user.id, expires).run();

  return json({ token, user });
}
