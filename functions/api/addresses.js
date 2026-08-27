export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  let targetUserId = url.searchParams.get('user_id');

  if (targetUserId && user.role !== 'superadmin' && user.role !== 'admin') {
    if (parseInt(targetUserId) !== user.user_id) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const userId = targetUserId || user.user_id;
  const addresses = await env.DB.prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all();
  return new Response(JSON.stringify({ addresses: addresses.results }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { label, street, city, state, zip, country } = await context.request.json();

  if (!street) {
    return new Response(JSON.stringify({ error: 'Street is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare("INSERT INTO addresses (user_id, label, street, city, state, zip, country) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(user.user_id, label || '', street, city || '', state || '', zip || '', country || '').run();

  return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut(context) {
  const { env, data } = context;
  const user = data.user;
  const { id, label, street, city, state, zip, country } = await context.request.json();

  if (!id || !street) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const addr = await env.DB.prepare("SELECT user_id FROM addresses WHERE id = ?").bind(id).first();
  if (!addr) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (addr.user_id !== user.user_id && user.role !== 'superadmin' && user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare("UPDATE addresses SET label=?, street=?, city=?, state=?, zip=?, country=? WHERE id=?")
    .bind(label || '', street, city || '', state || '', zip || '', country || '', id).run();

  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (!id) {
    return new Response(JSON.stringify({ error: 'Missing id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const addr = await env.DB.prepare("SELECT user_id FROM addresses WHERE id = ?").bind(id).first();
  if (!addr) {
    return new Response(JSON.stringify({ error: 'Not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (addr.user_id !== user.user_id && user.role !== 'superadmin' && user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare("DELETE FROM addresses WHERE id = ?").bind(id).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
