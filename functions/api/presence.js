export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  await env.DB.prepare(
    "UPDATE users SET last_seen = datetime('now') WHERE id = ?"
  ).bind(user.user_id).run();
  return Response.json({ ok: true });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const url = new URL(context.request.url);
  const userId = url.searchParams.get('user_id');
  if (!userId) return Response.json({ error: 'Missing user_id' }, { status: 400 });
  const user = await env.DB.prepare(
    "SELECT last_seen FROM users WHERE id = ?"
  ).bind(userId).first();
  if (!user) return Response.json({ online: false });
  const lastSeen = user.last_seen ? new Date(user.last_seen + 'Z') : null;
  const online = lastSeen && (Date.now() - lastSeen.getTime()) < 60000;
  return Response.json({ online: !!online, last_seen: user.last_seen });
}
