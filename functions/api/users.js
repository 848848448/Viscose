async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;

  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const users = await env.DB.prepare("SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC").all();
  return new Response(JSON.stringify({ users: users.results }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const currentUser = data.user;

  if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, name, password, role } = await context.request.json();
  if (!email || !name || !password) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const assignRole = role || 'user';
  if (assignRole === 'superadmin') {
    return new Response(JSON.stringify({ error: 'Cannot create superadmin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (assignRole === 'admin' && currentUser.role !== 'superadmin') {
    return new Response(JSON.stringify({ error: 'Only superadmin can create admins' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const hash = await hashPassword(password);
  try {
    await env.DB.prepare("INSERT INTO users (email, name, password_hash, role, created_by) VALUES (?, ?, ?, ?, ?)")
      .bind(email.toLowerCase().trim(), name, hash, assignRole, currentUser.user_id).run();
  } catch (e) {
    if (e.message?.includes('UNIQUE')) {
      return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }

  return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  const { env, data } = context;
  const currentUser = data.user;

  if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(context.request.url);
  const userId = url.searchParams.get('id');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing user id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const target = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first();
  if (!target) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.role === 'superadmin') {
    return new Response(JSON.stringify({ error: 'Cannot delete superadmin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.role === 'admin' && currentUser.role !== 'superadmin') {
    return new Response(JSON.stringify({ error: 'Only superadmin can delete admins' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
