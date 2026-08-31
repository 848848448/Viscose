export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';

  let query, params;
  if (isAdmin && !url.searchParams.get('mine')) {
    query = `SELECT p.*, u.name as user_name, u.email as user_email,
      a.label as addr_label, a.street, a.city, a.state, a.zip, a.country
      FROM pickups p
      JOIN users u ON p.user_id = u.id
      JOIN addresses a ON p.address_id = a.id
      ORDER BY CASE p.status WHEN 'picked_up' THEN 0 WHEN 'in_process' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END, p.requested_at DESC`;
    params = [];
  } else {
    query = `SELECT p.*, a.label as addr_label, a.street, a.city, a.state, a.zip, a.country
      FROM pickups p
      JOIN addresses a ON p.address_id = a.id
      WHERE p.user_id = ?
      ORDER BY p.requested_at DESC`;
    params = [user.user_id];
  }

  const result = params.length
    ? await env.DB.prepare(query).bind(...params).all()
    : await env.DB.prepare(query).all();

  return Response.json({ pickups: result.results });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { address_id, notes, photo } = await context.request.json();

  if (!address_id) {
    return Response.json({ error: 'Address is required' }, { status: 400 });
  }

  const addr = await env.DB.prepare("SELECT id, user_id FROM addresses WHERE id = ?").bind(address_id).first();
  if (!addr || addr.user_id !== user.user_id) {
    return Response.json({ error: 'Address not found' }, { status: 404 });
  }

  await env.DB.prepare("INSERT INTO pickups (user_id, address_id, notes, photo) VALUES (?, ?, ?, ?)")
    .bind(user.user_id, address_id, notes || '', photo || '').run();

  return Response.json({ success: true }, { status: 201 });
}

export async function onRequestPut(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';

  const { id, status, admin_notes } = await context.request.json();
  if (!id) return Response.json({ error: 'Missing pickup id' }, { status: 400 });

  if (!isAdmin) {
    return Response.json({ error: 'Only admins can update pickup status' }, { status: 403 });
  }

  const pickup = await env.DB.prepare("SELECT p.*, u.email as user_email, u.name as user_name, a.label as addr_label FROM pickups p JOIN users u ON p.user_id = u.id JOIN addresses a ON p.address_id = a.id WHERE p.id = ?").bind(id).first();
  if (!pickup) return Response.json({ error: 'Pickup not found' }, { status: 404 });

  const oldStatus = pickup.status;
  const updates = [];
  const values = [];
  if (status) { updates.push("status = ?"); values.push(status); }
  if (admin_notes !== undefined) { updates.push("admin_notes = ?"); values.push(admin_notes); }
  updates.push("updated_at = datetime('now')");

  if (updates.length === 1) return Response.json({ error: 'Nothing to update' }, { status: 400 });

  values.push(id);
  await env.DB.prepare(`UPDATE pickups SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  if (status && status !== oldStatus) {
    try {
      await env.DB.prepare("INSERT INTO pickup_log (pickup_id, changed_by, old_status, new_status) VALUES (?, ?, ?, ?)")
        .bind(id, user.user_id, oldStatus, status).run();
    } catch(e) {}

    if (env.RESEND_API_KEY) {
      try {
        const statusLabels = { picked_up: 'Picked Up', in_process: 'In Process', ready: 'Ready for Delivery', delivered: 'Delivered' };
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: env.EMAIL_FROM || 'Viscose <onboarding@resend.dev>',
            to: [pickup.user_email],
            subject: `Pickup ${statusLabels[status] || status} — ${pickup.addr_label || 'Address'}`,
            html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
              <h2 style="margin-bottom:8px">Pickup Update</h2>
              <p>Hello ${pickup.user_name},</p>
              <p>Your pickup request for <strong>${pickup.addr_label || 'your address'}</strong> has been updated.</p>
              <table style="margin:16px 0;font-size:15px">
                <tr><td style="padding:4px 12px 4px 0;color:#666">Status:</td><td style="font-weight:600">${statusLabels[status] || status}</td></tr>
                ${admin_notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Notes:</td><td>${admin_notes}</td></tr>` : ''}
              </table>
              <p style="margin-top:24px"><a href="${env.SITE_URL || 'https://viscose.pages.dev'}/#mypickups" style="background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">View Pickups</a></p>
              <p style="margin-top:32px;font-size:13px;color:#999">This email was sent by Viscose.</p>
            </div>`
          })
        });
      } catch(e) { console.error('Notification email failed:', e); }
    }
  }

  return Response.json({ success: true });
}

export async function onRequestDelete(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');

  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

  const pickup = await env.DB.prepare("SELECT user_id, status FROM pickups WHERE id = ?").bind(id).first();
  if (!pickup) return Response.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  if (pickup.user_id !== user.user_id && !isAdmin) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  await env.DB.prepare("DELETE FROM pickups WHERE id = ?").bind(id).run();
  return Response.json({ success: true });
}
