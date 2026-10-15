import { hashPassword, verifyPassword, esc } from '../../lib/auth.js';
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
  if (!email || !name || !password) {
    return new Response(JSON.stringify({ error: 'Name, email and password are required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const assignRole = role || 'user';
  if (assignRole === 'user' && (!phone || !billing_address || !billing_city || !billing_state || !billing_zip)) {
    return new Response(JSON.stringify({ error: 'Phone and billing address are required for users' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (assignRole === 'admin' && currentUser.role !== 'superadmin') {
    return new Response(JSON.stringify({ error: 'Only the superadmin can create admins' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return new Response(JSON.stringify({ error: 'Password must be at least 6 characters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (assignRole === 'superadmin') {
    return new Response(JSON.stringify({ error: 'Cannot create superadmin' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const hash = await hashPassword(password);
  const userEmail = email.toLowerCase().trim();
  try {
    await env.DB.prepare("INSERT INTO users (email, name, password_hash, role, created_by, phone, billing_address, billing_city, billing_state, billing_zip, billing_country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(userEmail, name, hash, assignRole, currentUser.user_id, phone || '', billing_address || '', billing_city || '', billing_state || '', billing_zip || '', billing_country || 'US').run();
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
            <p>Hello ${esc(name)},</p>
            <p>An account has been created for you by ${esc(currentUser.name)}.</p>
            <p><strong>Your login details:</strong></p>
            <table style="margin:16px 0;font-size:15px">
              <tr><td style="padding:4px 12px 4px 0;color:#666">Email:</td><td style="font-weight:600">${esc(userEmail)}</td></tr>
                          </table>
            <p>Your password was set by the person who created your account. Ask them for it, then change it in Settings.</p>
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
    return new Response(JSON.stringify({ error: 'Only the superadmin can delete admins' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(userId) === String(currentUser.user_id)) {
    return new Response(JSON.stringify({ error: 'You cannot delete your own account' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
  return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPut(context) {
  const { env, data } = context;
  const me = data.user;
  const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  if (me.role !== 'superadmin' && me.role !== 'admin') return j({ error: 'Forbidden' }, 403);

  let body;
  try { body = await context.request.json(); } catch (e) { return j({ error: 'Invalid request' }, 400); }
  const { id, password, role } = body || {};
  if (!id) return j({ error: 'Missing user id' }, 400);

  const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first();
  if (!target) return j({ error: 'User not found' }, 404);
  if (target.role === 'superadmin') return j({ error: 'Cannot modify superadmin' }, 403);
  if (target.role === 'admin' && me.role !== 'superadmin') return j({ error: 'Only the superadmin can modify admins' }, 403);
  if (password === undefined && role === undefined) return j({ error: 'Nothing to update' }, 400);

  if (role !== undefined) {
    if (me.role !== 'superadmin') return j({ error: 'Only the superadmin can change roles' }, 403);
    if (!['user', 'driver', 'factory', 'admin'].includes(role)) return j({ error: 'Invalid role' }, 400);
    if (String(target.id) === String(me.user_id)) return j({ error: 'You cannot change your own role' }, 400);
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(role, target.id).run();
  }
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 6) return j({ error: 'Password must be at least 6 characters' }, 400);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(await hashPassword(password), target.id).run();
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id).run();
  }
  return j({ success: true });
}
