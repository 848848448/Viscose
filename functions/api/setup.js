async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  try {
    const { env } = context;
    if (!env.DB) {
      return Response.json({ needsSetup: true, error: 'D1 database not bound. Add a D1 binding named DB in Cloudflare dashboard.' });
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").first();
    return Response.json({ needsSetup: !existing });
  } catch (e) {
    return Response.json({ needsSetup: true, error: e.message });
  }
}

export async function onRequestPost(context) {
  try {
    const { env } = context;
    if (!env.DB) {
      return Response.json({ error: 'D1 database not bound' }, { status: 500 });
    }

    const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'superadmin' LIMIT 1").first();
    if (existing) {
      return Response.json({ error: 'Already set up' }, { status: 400 });
    }

    const { email, password, name } = await context.request.json();
    if (!email || !password || !name) {
      return Response.json({ error: 'Missing fields' }, { status: 400 });
    }

    const hash = await hashPassword(password);
    await env.DB.prepare("INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'superadmin')")
      .bind(email.toLowerCase().trim(), name, hash).run();

    return Response.json({ success: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
