export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const withUser = url.searchParams.get('with');
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  const isDriver = user.role === 'driver';

  if (!isAdmin && !isDriver) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  if (withUser) {
    const otherId = parseInt(withUser);
    const other = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(otherId).first();
    if (!other) return Response.json({ error: 'User not found' }, { status: 404 });

    if (isDriver && other.role !== 'admin' && other.role !== 'superadmin') {
      return Response.json({ error: 'Drivers can only message admins' }, { status: 403 });
    }
    if (isAdmin && other.role !== 'driver' && other.role !== 'admin' && other.role !== 'superadmin') {
      return Response.json({ error: 'Admins can only message drivers and other admins' }, { status: 403 });
    }

    const messages = await env.DB.prepare(`
      SELECT m.*, u.name as sender_name, u.role as sender_role,
        r.message as reply_text, r_u.name as reply_name
      FROM direct_messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN direct_messages r ON m.reply_to_id = r.id
      LEFT JOIN users r_u ON r.sender_id = r_u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at ASC
    `).bind(user.user_id, otherId, otherId, user.user_id).all();

    await env.DB.prepare(
      "UPDATE direct_messages SET read_at = datetime('now') WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL"
    ).bind(user.user_id, otherId).run();

    return Response.json({ messages: messages.results });
  }

  let contacts;
  if (isDriver) {
    contacts = await env.DB.prepare(
      "SELECT id, name, role FROM users WHERE role IN ('admin', 'superadmin') ORDER BY name"
    ).all();
  } else {
    contacts = await env.DB.prepare(
      "SELECT id, name, role FROM users WHERE role IN ('driver', 'admin', 'superadmin') AND id != ? ORDER BY CASE role WHEN 'driver' THEN 0 ELSE 1 END, name"
    ).bind(user.user_id).all();
  }

  const conversations = [];
  for (const c of contacts.results) {
    const lastMsg = await env.DB.prepare(`
      SELECT m.*, u.name as sender_name FROM direct_messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.created_at DESC LIMIT 1
    `).bind(user.user_id, c.id, c.id, user.user_id).first();

    const unread = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM direct_messages WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL"
    ).bind(c.id, user.user_id).first();

    conversations.push({
      user_id: c.id,
      name: c.name,
      role: c.role,
      last_message: lastMsg?.message || '',
      last_message_at: lastMsg?.created_at || null,
      last_sender: lastMsg?.sender_name || null,
      unread: unread?.count || 0
    });
  }

  conversations.sort((a, b) => {
    if (a.last_message_at && b.last_message_at) return b.last_message_at.localeCompare(a.last_message_at);
    if (a.last_message_at) return -1;
    if (b.last_message_at) return 1;
    return 0;
  });

  return Response.json({ conversations });
}

export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  const isDriver = user.role === 'driver';

  if (!isAdmin && !isDriver) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  const { receiver_id, message, reply_to_id, media, media_type } = await context.request.json();
  if (!receiver_id) return Response.json({ error: 'Receiver required' }, { status: 400 });
  if (!message && !media) return Response.json({ error: 'Message or media required' }, { status: 400 });

  const receiver = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(receiver_id).first();
  if (!receiver) return Response.json({ error: 'User not found' }, { status: 404 });

  if (isDriver && receiver.role !== 'admin' && receiver.role !== 'superadmin') {
    return Response.json({ error: 'Drivers can only message admins' }, { status: 403 });
  }

  const { results } = await env.DB.prepare(
    "INSERT INTO direct_messages (sender_id, receiver_id, message, reply_to_id, media, media_type) VALUES (?, ?, ?, ?, ?, ?) RETURNING id"
  ).bind(user.user_id, receiver_id, message || '', reply_to_id || null, media || '', media_type || '').all();

  return Response.json({ success: true, id: results[0]?.id }, { status: 201 });
}

export async function onRequestDelete(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const id = url.searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id' }, { status: 400 });

  const msg = await env.DB.prepare("SELECT sender_id FROM direct_messages WHERE id = ?").bind(id).first();
  if (!msg) return Response.json({ error: 'Not found' }, { status: 404 });
  if (msg.sender_id !== user.user_id) return Response.json({ error: 'Can only delete your own messages' }, { status: 403 });

  await env.DB.prepare("DELETE FROM direct_messages WHERE id = ?").bind(id).run();
  return Response.json({ success: true });
}
