export async function onRequestGet(context) {
  return new Response(JSON.stringify({ user: context.data.user }), { headers: { 'Content-Type': 'application/json' } });
}
