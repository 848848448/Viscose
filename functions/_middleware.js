const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const fail = (status, error) => new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });

export async function onRequest(context) {
  const { request, env, next } = context;
  const url = new URL(request.url);
  const isApi = url.pathname.startsWith('/api/');
  try {
    const publicPaths = ['/api/login', '/api/setup', '/api/reset-password'];
    if (isApi && !publicPaths.includes(url.pathname)) {
      const token = request.headers.get('Authorization')?.replace('Bearer ', '');
      if (!token) return fail(401, 'Unauthorized');
      const session = await env.DB.prepare(
        "SELECT s.user_id, u.email, u.name, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime('now')"
      ).bind(token).first();
      if (!session) return fail(401, 'Invalid or expired session');
      context.data = { user: session };
    }
    const res = await next();
    if (!isApi) return res;
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'no-store');
    return out;
  } catch (e) {
    if (!isApi) throw e;
    const msg = String((e && e.message) || e);
    console.error('API error', request.method, url.pathname, msg);
    if (e instanceof SyntaxError || /JSON/i.test(msg) && /Unexpected|parse|end of/i.test(msg)) return fail(400, 'The request was not valid. Please reload and try again.');
    if (/UNIQUE constraint/i.test(msg)) return fail(409, 'That already exists.');
    if (/TOOBIG|too large|too big/i.test(msg)) return fail(413, 'That is too large to save. Try a smaller photo or shorter text.');
    return fail(500, 'The server had a problem. Please try again in a moment.');
  }
}
