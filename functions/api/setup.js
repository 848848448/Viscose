async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { env } = context;
  const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").first();
  if (existing) {
    return new Response(JSON.stringify({ error: 'Already set up' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, password, name } = await context.request.json();
  if (!email || !password || !name) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const hash = await hashPassword(password);
  await env.DB.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'superadmin')")
    .bind(email, name, hash).run();

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
