export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q || q.length < 2) return Response.json({ results: [] });

  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  const isDriver = user.role === 'driver';
  const like = `%${q}%`;

  const results = [];

  if (isAdmin) {
    const users = await env.DB.prepare(
      "SELECT id, name, email, role FROM users WHERE name LIKE ? OR email LIKE ? LIMIT 5"
    ).bind(like, like).all();
    for (const u of users.results) {
      results.push({ type: 'user', id: u.id, title: u.name, sub: u.email, extra: u.role });
    }
  }

  const pickupQuery = isAdmin
    ? "SELECT p.id, p.status, p.notes, a.label, a.street, u.name as user_name FROM pickups p LEFT JOIN addresses a ON p.address_id = a.id LEFT JOIN users u ON p.user_id = u.id WHERE (a.label LIKE ? OR a.street LIKE ? OR p.notes LIKE ? OR u.name LIKE ?) ORDER BY p.requested_at DESC LIMIT 5"
    : "SELECT p.id, p.status, p.notes, a.label, a.street FROM pickups p LEFT JOIN addresses a ON p.address_id = a.id WHERE p.user_id = ? AND (a.label LIKE ? OR a.street LIKE ? OR p.notes LIKE ?) ORDER BY p.requested_at DESC LIMIT 5";

  const pickups = isAdmin
    ? await env.DB.prepare(pickupQuery).bind(like, like, like, like).all()
    : await env.DB.prepare(pickupQuery).bind(user.user_id, like, like, like).all();

  for (const p of pickups.results) {
    results.push({ type: 'pickup', id: p.id, title: p.label || p.street || 'Pickup #' + p.id, sub: p.status, extra: p.user_name || '' });
  }

  if (isAdmin || isDriver) {
    const msgs = await env.DB.prepare(
      "SELECT m.id, m.message, m.created_at, u.name as sender_name, m.sender_id, m.receiver_id FROM direct_messages m JOIN users u ON m.sender_id = u.id WHERE (m.sender_id = ? OR m.receiver_id = ?) AND m.message LIKE ? ORDER BY m.created_at DESC LIMIT 5"
    ).bind(user.user_id, user.user_id, like).all();
    for (const m of msgs.results) {
      results.push({ type: 'message', id: m.id, title: m.sender_name, sub: m.message?.slice(0, 80) || '', extra: m.sender_id === user.user_id ? m.receiver_id : m.sender_id });
    }
  }

  return Response.json({ results });
}
