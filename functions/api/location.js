export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  if (user.role !== 'driver') return Response.json({ error: 'Drivers only' }, { status: 403 });
  const { lat, lng, pickup_id } = await context.request.json();
  if (typeof lat !== 'number' || typeof lng !== 'number') return Response.json({ error: 'Missing coordinates' }, { status: 400 });
  await env.DB.prepare(
    `INSERT INTO driver_locations (user_id, lat, lng, pickup_id, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, pickup_id = excluded.pickup_id, updated_at = datetime('now')`
  ).bind(user.user_id, lat, lng, pickup_id || null).run();
  return Response.json({ ok: true });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (!isAdmin) return Response.json({ error: 'Admins only' }, { status: 403 });
  const url = new URL(context.request.url);
  const driverId = url.searchParams.get('driver_id');

  // Only locations updated within the last 2 minutes are considered active
  if (driverId) {
    const row = await env.DB.prepare(
      `SELECT user_id, lat, lng, pickup_id, updated_at FROM driver_locations
       WHERE user_id = ? AND updated_at > datetime('now', '-2 minutes')`
    ).bind(parseInt(driverId)).first();
    if (!row) return Response.json({ location: null });
    return Response.json({ location: { lat: row.lat, lng: row.lng, pickup_id: row.pickup_id, updated: Date.parse(row.updated_at + 'Z') } });
  }

  const rows = await env.DB.prepare(
    `SELECT user_id, lat, lng, pickup_id, updated_at FROM driver_locations
     WHERE updated_at > datetime('now', '-2 minutes')`
  ).all();
  const locations = {};
  (rows.results || []).forEach(r => {
    locations[r.user_id] = { lat: r.lat, lng: r.lng, pickup_id: r.pickup_id, updated: Date.parse(r.updated_at + 'Z') };
  });
  return Response.json({ locations });
}
