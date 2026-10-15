export async function onRequestGet(context) {
  const { env, data } = context;
  const u = await env.DB.prepare("SELECT id, email, name, role, avatar, phone FROM users WHERE id = ?").bind(data.user.user_id).first();
  if (!u) return Response.json({ error: 'Invalid or expired session' }, { status: 401 });
  return Response.json({ user: u });
}
