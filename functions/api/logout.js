export async function onRequestPost(context) {
  const token = context.request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) await context.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return Response.json({ success: true });
}
