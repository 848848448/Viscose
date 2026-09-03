async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { env, data } = context;
  let user;
  try {
    user = await env.DB.prepare("SELECT id, email, name, role, avatar, created_at, phone, billing_address, billing_city, billing_state, billing_zip, billing_country FROM users WHERE id = ?")
      .bind(data.user.user_id).first();
  } catch (e) {
    user = await env.DB.prepare("SELECT id, email, name, role, avatar, created_at FROM users WHERE id = ?")
      .bind(data.user.user_id).first();
  }
  return Response.json({ user });
}

export async function onRequestPut(context) {
  const { env, data } = context;
  const body = await context.request.json();
  const { name, avatar, phone, billing_address, billing_city, billing_state, billing_zip, billing_country } = body;
  if (!name) return Response.json({ error: 'Name is required' }, { status: 400 });

  const updates = ["name = ?"];
  const values = [name];
  if (avatar !== undefined) { updates.push("avatar = ?"); values.push(avatar || ''); }
  if (phone !== undefined) { updates.push("phone = ?"); values.push(phone || ''); }
  if (billing_address !== undefined) { updates.push("billing_address = ?"); values.push(billing_address || ''); }
  if (billing_city !== undefined) { updates.push("billing_city = ?"); values.push(billing_city || ''); }
  if (billing_state !== undefined) { updates.push("billing_state = ?"); values.push(billing_state || ''); }
  if (billing_zip !== undefined) { updates.push("billing_zip = ?"); values.push(billing_zip || ''); }
  if (billing_country !== undefined) { updates.push("billing_country = ?"); values.push(billing_country || ''); }
  values.push(data.user.user_id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
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
