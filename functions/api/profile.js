async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = await env.DB.prepare("SELECT id, email, name, role, created_at FROM users WHERE id = ?")
    .bind(data.user.user_id).first();
  return Response.json({ user });
}

export async function onRequestPut(context) {
  const { env, data } = context;
  const { name } = await context.request.json();
  if (!name) return Response.json({ error: 'Name is required' }, { status: 400 });
  await env.DB.prepare("UPDATE users SET name = ? WHERE id = ?").bind(name, data.user.user_id).run();
  return Response.json({ success: true });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const { current_password, new_password } = await context.request.json();

  if (!current_password || !new_password) {
    return Response.json({ error: 'Both passwords are required' }, { status: 400 });
  }
  if (new_password.length < 6) {
    return Response.json({ error: 'New password must be at least 6 characters' }, { status: 400 });
  }

  const currentHash = await hashPassword(current_password);
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND password_hash = ?")
    .bind(data.user.user_id, currentHash).first();

  if (!user) {
    return Response.json({ error: 'Current password is incorrect' }, { status: 401 });
  }

  const newHash = await hashPassword(new_password);
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, data.user.user_id).run();

  return Response.json({ success: true });
}
