export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { message_id, action } = await context.request.json();
  if (!message_id) return Response.json({ error: 'Missing message_id' }, { status: 400 });

  if (action === 'unpin') {
    await env.DB.prepare("UPDATE direct_messages SET pinned = 0 WHERE id = ?").bind(message_id).run();
    return Response.json({ action: 'unpinned' });
  }

  await env.DB.prepare("UPDATE direct_messages SET pinned = 1 WHERE id = ?").bind(message_id).run();
  return Response.json({ action: 'pinned' });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const withUser = url.searchParams.get('with');
  if (!withUser) return Response.json({ pins: [] });

  const otherId = parseInt(withUser);
  const pins = await env.DB.prepare(`
    SELECT m.*, u.name as sender_name FROM direct_messages m
    JOIN users u ON m.sender_id = u.id
    WHERE m.pinned = 1 AND ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
    ORDER BY m.created_at DESC
  `).bind(user.user_id, otherId, otherId, user.user_id).all();

  return Response.json({ pins: pins.results });
}
