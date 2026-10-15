export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const pickupId = url.searchParams.get('pickup_id');
  if (!pickupId) return Response.json({ error: 'Missing pickup_id' }, { status: 400 });

  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  const pickup = await env.DB.prepare("SELECT user_id FROM pickups WHERE id = ?").bind(pickupId).first();
  if (!pickup) return Response.json({ error: 'Pickup not found' }, { status: 404 });
  if (pickup.user_id !== user.user_id && !isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const comments = await env.DB.prepare(
    "SELECT c.*, u.name as user_name, u.role as user_role FROM pickup_comments c JOIN users u ON c.user_id = u.id WHERE c.pickup_id = ? ORDER BY c.created_at ASC"
  ).bind(pickupId).all();

  return Response.json({ comments: comments.results });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { pickup_id, message } = await context.request.json();

  if (!pickup_id || !message?.trim()) {
    return Response.json({ error: 'Missing pickup_id or message' }, { status: 400 });
  }

  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  const pickup = await env.DB.prepare("SELECT user_id FROM pickups WHERE id = ?").bind(pickup_id).first();
  if (!pickup) return Response.json({ error: 'Pickup not found' }, { status: 404 });
  if (pickup.user_id !== user.user_id && !isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  await env.DB.prepare("INSERT INTO pickup_comments (pickup_id, user_id, message) VALUES (?, ?, ?)")
    .bind(pickup_id, user.user_id, message.trim()).run();

  return Response.json({ success: true }, { status: 201 });
}
