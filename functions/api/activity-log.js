export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (!isAdmin) return Response.json({ error: 'Admins only' }, { status: 403 });

  const url = new URL(context.request.url);
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  const logs = await env.DB.prepare(`
    SELECT l.*, u.name as user_name, u.role as user_role, p.id as pickup_id,
      p.cancel_reason, p.notes, p.contact_phone,
      a.label as addr_label, a.street, a.city, a.state, a.zip,
      pu.name as pickup_user_name
    FROM pickup_log l
    JOIN users u ON l.changed_by = u.id
    JOIN pickups p ON l.pickup_id = p.id
    JOIN addresses a ON p.address_id = a.id
    JOIN users pu ON p.user_id = pu.id
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  return Response.json({ logs: logs.results });
}
