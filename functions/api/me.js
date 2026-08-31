export async function onRequestGet(context) {
  const { env, data } = context;
  const u = await env.DB.prepare("SELECT id, email, name, role, avatar FROM users WHERE id = ?").bind(data.user.user_id).first();
  return Response.json({ user: u });
}
