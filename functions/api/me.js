export async function onRequestGet(context) {
  const u = context.data.user;
  return Response.json({ user: { id: u.user_id, email: u.email, name: u.name, role: u.role } });
}
