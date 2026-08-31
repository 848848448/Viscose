async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;

  if (user.role !== 'superadmin' && user.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const users = await env.DB.prepare("SELECT id, email, name, role, phone, billing_address, billing_city, billing_state, billing_zip, billing_country, created_at FROM users ORDER BY created_at DESC").all();
  return new Response(JSON.stringify({ users: users.results }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const currentUser = data.user;

  if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const { email, name, password, role, phone, billing_address, billing_city, billing_state, billing_zip, billing_country } = await context.request.json();
  if (!email || !name || !password || !phone || !billing_address || !billing_city || !billing_state || !billing_zip) {
    return new Response(JSON.stringify({ error: 'All fields are required (name, email, password, phone, billing address)' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const assignRole = role || 'user';
  if (assignRole === 'superadmin') {
    return new Response(JSON.stringify({ error: 'Cannot create superadmin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (assignRole === 'admin' && currentUser.role !== 'superadmin') {
    return new Response(JSON.stringify({ error: 'Only superadmin can create admins' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const hash = await hashPassword(password);
  const userEmail = email.toLowerCase().trim();
  try {
    await env.DB.prepare("INSERT INTO users (email, name, password_hash, role, created_by, phone, billing_address, billing_city, billing_state, billing_zip, billing_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(userEmail, name, hash, assignRole, currentUser.user_id, phone, billing_address, billing_city, billing_state, billing_zip, billing_country || 'US').run();
  } catch (e) {
    if (e.message?.includes('UNIQUE')) {
      return new Response(JSON.stringify({ error: 'Email already exists' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    throw e;
  }

  if (env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM || 'Viscose <onboarding@resend.dev>',
          to: [userEmail],
          subject: 'Your Viscose account is ready',
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="margin-bottom:8px">Welcome to Viscose</h2>
            <p>Hello ${name},</p>
            <p>An account has been created for you by ${currentUser.name}.</p>
            <p><strong>Your login details:</strong></p>
            <table style="margin:16px 0;font-size:15px">
              <tr><td style="padding:4px 12px 4px 0;color:#666">Email:</td><td style="font-weight:600">${userEmail}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666">Password:</td><td style="font-weight:600">${password}</td></tr>
            </table>
            <p>Please sign in and change your password in Settings.</p>
            <p style="margin-top:24px"><a href="${env.SITE_URL || 'https://viscose.pages.dev'}" style="background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Sign In</a></p>
            <p style="margin-top:32px;font-size:13px;color:#999">This email was sent by Viscose.</p>
          </div>`
        })
      });
    } catch (emailErr) {
      console.error('Email send failed:', emailErr);
    }
  }

  return new Response(JSON.stringify({ success: true }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  const { env, data } = context;
  const currentUser = data.user;

  if (currentUser.role !== 'superadmin' && currentUser.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const url = new URL(context.request.url);
  const userId = url.searchParams.get('id');
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Missing user id' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const target = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first();
  if (!target) {
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.role === 'superadmin') {
    return new Response(JSON.stringify({ error: 'Cannot delete superadmin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (target.role === 'admin' && currentUser.role !== 'superadmin') {
    return new Response(JSON.stringify({ error: 'Only superadmin can delete admins' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}
