export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (!isAdmin) return Response.json({ error: 'Admins only' }, { status: 403 });

  const url = new URL(context.request.url);
  const driverId = parseInt(url.searchParams.get('driver_id'));
  if (!driverId) return Response.json({ error: 'Missing driver_id' }, { status: 400 });
  const days = parseInt(url.searchParams.get('days')) || 7;
  const since = `-${days} days`;

  // Driver info
  const driver = await env.DB.prepare("SELECT id, name, email FROM users WHERE id = ?").bind(driverId).first();

  // All pickups this driver was assigned, with addresses
  const pickups = await env.DB.prepare(`
    SELECT p.id, p.status, p.requested_at, p.updated_at, p.pickup_photo, p.delivery_photo,
      u.name as user_name, a.label as addr_label, a.street, a.city, a.state, a.zip
    FROM pickups p
    JOIN users u ON p.user_id = u.id
    JOIN addresses a ON p.address_id = a.id
    WHERE p.driver_id = ?
    ORDER BY p.updated_at DESC
  `).bind(driverId).all();

  // Status-change log entries made by this driver
  const logs = await env.DB.prepare(`
    SELECT l.pickup_id, l.old_status, l.new_status, l.created_at,
      a.label as addr_label, a.street, a.city, a.state, a.zip, pu.name as pickup_user_name
    FROM pickup_log l
    JOIN pickups p ON l.pickup_id = p.id
    JOIN addresses a ON p.address_id = a.id
    JOIN users pu ON p.user_id = pu.id
    WHERE l.changed_by = ? AND l.created_at > datetime('now', ?)
    ORDER BY l.created_at DESC
  `).bind(driverId, since).all();

  // Raw location trail
  let trail = { results: [] };
  try {
    trail = await env.DB.prepare(`
      SELECT lat, lng, pickup_id, recorded_at FROM driver_location_history
      WHERE user_id = ? AND recorded_at > datetime('now', ?)
      ORDER BY recorded_at ASC
    `).bind(driverId, since).all();
  } catch (e) { /* table may not exist yet */ }

  // Derive "stops": consecutive points close together become one stop with arrive/leave times
  const points = trail.results || [];
  const stops = [];
  const distM = (a, b) => {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const s = Math.sin(dLat/2)**2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.sqrt(s));
  };
  let cur = null;
  for (const pt of points) {
    if (cur && distM(cur, pt) < 80) {
      cur.last = pt.recorded_at; cur.count++;
    } else {
      if (cur) stops.push(cur);
      cur = { lat: pt.lat, lng: pt.lng, first: pt.recorded_at, last: pt.recorded_at, count: 1, pickup_id: pt.pickup_id };
    }
  }
  if (cur) stops.push(cur);

  return Response.json({
    driver,
    pickups: pickups.results,
    logs: logs.results,
    trail: points,
    stops
  });
}
