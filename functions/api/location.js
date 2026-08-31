const locationCache = {};

export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  if (user.role !== 'driver') return Response.json({ error: 'Drivers only' }, { status: 403 });
  const { lat, lng, pickup_id } = await context.request.json();
  if (!lat || !lng) return Response.json({ error: 'Missing coordinates' }, { status: 400 });
  locationCache[user.user_id] = { lat, lng, pickup_id: pickup_id || null, updated: Date.now() };
  return Response.json({ ok: true });
}

export async function onRequestGet(context) {
  const { data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (!isAdmin) return Response.json({ error: 'Admins only' }, { status: 403 });
  const url = new URL(context.request.url);
  const driverId = url.searchParams.get('driver_id');
  if (driverId) {
    const loc = locationCache[parseInt(driverId)];
    if (!loc || Date.now() - loc.updated > 120000) return Response.json({ location: null });
    return Response.json({ location: loc });
  }
  const active = {};
  for (const [id, loc] of Object.entries(locationCache)) {
    if (Date.now() - loc.updated < 120000) active[id] = loc;
  }
  return Response.json({ locations: active });
}
