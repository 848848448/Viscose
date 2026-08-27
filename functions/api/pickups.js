export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';

  let query, params;
  if (isAdmin && !url.searchParams.get('mine')) {
    query = `SELECT p.*, u.name as user_name, u.email as user_email,
      a.label as addr_label, a.street, a.city, a.state, a.zip, a.country
      FROM pickups p
      JOIN users u ON p.user_id = u.id
      JOIN addresses a ON p.address_id = a.id
      ORDER BY CASE p.status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, p.requested_at DESC`;
    params = [];
  } else {
    query = `SELECT p.*, a.label as addr_label, a.street, a.city, a.state, a.zip, a.country
      FROM pickups p
      JOIN addresses a ON p.address_id = a.id
      WHERE p.user_id = ?
      ORDER BY p.requested_at DESC`;
    params = [user.user_id];
  }

  const result = params.length
    ? await env.DB.prepare(query).bind(...params).all()
    : await env.DB.prepare(query).all();

  return Response.json({ pickups: result.results });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { address_id, notes } = await context.request.json();

  if (!address_id) {
    return Response.json({ error: 'Address is required' }, { status: 400 });
  }

  const addr = await env.DB.prepare("SELECT id, user_id FROM addresses WHERE id = ?").bind(address_id).first();
  if (!addr || addr.user_id !== user.user_id) {
    return Response.json({ error: 'Address not found' }, { status: 404 });
  }

  await env.DB.prepare("INSERT INTO pickups (user_id, address_id, notes) VALUES (?, ?, ?)")
    .bind(user.user_id, address_id, notes || '').run();

  return Response.json({ success: true }, { status: 201 });
}

export async function onRequestPut(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';

  const { id, status, admin_notes } = await context.request.json();
  if (!id) return Response.json({ error: 'Missing pickup id' }, { status: 400 });

  if (!isAdmin) {
    return Response.json({ error: 'Only admins can update pickup status' }, { status: 403 });
  }

  const updates = [];
  const values = [];
  if (status) { updates.push("status = ?"); values.push(status); }
  if (admin_notes !== undefined) { updates.push("admin_notes = ?"); values.push(admin_notes); }
  updates.push("updated_at = datetime('now')");

  if (updates.length === 1) return Response.json({ error: 'Nothing to update' }, { status: 400 });

  values.push(id);
  await env.DB.prepare(`UPDATE pickups SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return Response.json({ success: true });
}

export async function onRequestDelete(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

  const pickup = await env.DB.prepare("SELECT user_id, status FROM pickups WHERE id = ?").bind(id).first();
  if (!pickup) return Response.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (pickup.user_id !== user.user_id && !isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  await env.DB.prepare("DELETE FROM pickups WHERE id = ?").bind(id).run();
  return Response.json({ success: true });
}
