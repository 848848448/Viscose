export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const withUser = url.searchParams.get('with');
  const mediaId = url.searchParams.get('media');
  const isAdmin = user.role === 'superadmin' || user.role === 'admin';
  const isDriver = user.role === 'driver';

  if (!isAdmin && !isDriver) {
    return Response.json({ error: 'Not authorized' }, { status: 403 });
  }

  if (mediaId) {
    const row = await env.DB.prepare("SELECT media, media_type FROM direct_messages WHERE id = ? AND (sender_id = ? OR receiver_id = ?)").bind(mediaId, user.user_id, user.user_id).first();
    if (!row) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json({ media: row.media || '', media_type: row.media_type || '' });
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

    // Media (base64) is fetched on demand via ?media=ID so polling stays small
    return Response.json({ messages: messages.results.map(m => (m.media ? { ...m, media: 'lazy' } : m)) });
  }

  const lastWhere = "((m.sender_id = ?1 AND m.receiver_id = u.id) OR (m.sender_id = u.id AND m.receiver_id = ?1))";
  const roleFilter = isDriver ? "u.role IN ('admin', 'superadmin')" : "u.role IN ('driver', 'admin', 'superadmin') AND u.id != ?1";
  // One query for every conversation (was 2 queries per contact, which exceeds the free-plan subrequest limit with many users)
  const rows = await env.DB.prepare(`
    SELECT u.id, u.name, u.role,
      (SELECT m.message FROM direct_messages m WHERE ${lastWhere} ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message,
      (SELECT m.created_at FROM direct_messages m WHERE ${lastWhere} ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message_at,
      (SELECT s.name FROM direct_messages m JOIN users s ON s.id = m.sender_id WHERE ${lastWhere} ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_sender,
      (SELECT COUNT(*) FROM direct_messages m WHERE m.sender_id = u.id AND m.receiver_id = ?1 AND m.read_at IS NULL) AS unread
    FROM users u WHERE ${roleFilter}
    ORDER BY ${isDriver ? 'u.name' : "CASE u.role WHEN 'driver' THEN 0 ELSE 1 END, u.name"}
  `).bind(user.user_id).all();

  const conversations = rows.results.map(r => ({
    user_id: r.id, name: r.name, role: r.role,
    last_message: r.last_message || '', last_message_at: r.last_message_at || null,
    last_sender: r.last_sender || null, unread: r.unread || 0
  }));

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
  if (typeof media === 'string' && (media === 'lazy' || media.length > 1500000)) return Response.json({ error: 'That attachment is too large or invalid.' }, { status: 413 });
  if (typeof message === 'string' && message.length > 5000) return Response.json({ error: 'Message is too long.' }, { status: 400 });
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
