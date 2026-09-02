export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (!isAdmin) return Response.json({ error: 'Admins only' }, { status: 403 });

  const url = new URL(context.request.url);
  const limit = parseInt(url.searchParams.get('limit')) || 50;
  const offset = parseInt(url.searchParams.get('offset')) || 0;

  const fullQuery = `
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
    LIMIT ? OFFSET ?`;
  // Fallback query without newer columns, in case the ALTER TABLEs haven't been run yet
  const basicQuery = `
    SELECT l.*, u.name as user_name, p.id as pickup_id, p.notes,
      a.label as addr_label, a.street, a.city, a.state, a.zip,
      pu.name as pickup_user_name
    FROM pickup_log l
    JOIN users u ON l.changed_by = u.id
    JOIN pickups p ON l.pickup_id = p.id
    JOIN addresses a ON p.address_id = a.id
    JOIN users pu ON p.user_id = pu.id
    ORDER BY l.created_at DESC
    LIMIT ? OFFSET ?`;

  let logs;
  try {
    logs = await env.DB.prepare(fullQuery).bind(limit, offset).all();
  } catch (e) {
    try {
      logs = await env.DB.prepare(basicQuery).bind(limit, offset).all();
    } catch (e2) {
      return Response.json({ logs: [], error: e2.message });
    }
  }

  return Response.json({ logs: logs.results });
}
