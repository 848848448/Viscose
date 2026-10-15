export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { message_id, action } = await context.request.json();
  if (!message_id) return Response.json({ error: 'Missing message_id' }, { status: 400 });

  if (action === 'unstar') {
    await env.DB.prepare("DELETE FROM starred_messages WHERE message_id = ? AND user_id = ?").bind(message_id, user.user_id).run();
    return Response.json({ action: 'unstarred' });
  }

  await env.DB.prepare("INSERT OR IGNORE INTO starred_messages (message_id, user_id) VALUES (?, ?)").bind(message_id, user.user_id).run();
  return Response.json({ action: 'starred' });
}

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;
  const stars = await env.DB.prepare(`
    SELECT m.*, u.name as sender_name, o.name as other_name FROM starred_messages s
    JOIN direct_messages m ON s.message_id = m.id
    JOIN users u ON m.sender_id = u.id
    JOIN users o ON CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END = o.id
    WHERE s.user_id = ?
    ORDER BY s.created_at DESC
  `).bind(user.user_id, user.user_id).all();

  return Response.json({ starred: stars.results });
}
