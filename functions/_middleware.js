export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const publicPaths = ['/api/login', '/api/setup'];
  if (url.pathname.startsWith('/api/') && !publicPaths.includes(url.pathname)) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const session = await env.DB.prepare(
      "SELECT s.user_id, u.email, u.name, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')"
    ).bind(token).first();
    if (!session) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    context.data = { user: session };
  }

  return next();
}
