export async function onRequestPost(context) {
  const { env, data } = context;
  const user = data.user;
  const { message_id, emoji } = await context.request.json();
  if (!message_id || !emoji) return Response.json({ error: 'Missing fields' }, { status: 400 });

  const existing = await env.DB.prepare(
    "SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"
  ).bind(message_id, user.user_id, emoji).first();

  if (existing) {
    await env.DB.prepare("DELETE FROM message_reactions WHERE id = ?").bind(existing.id).run();
    return Response.json({ action: 'removed' });
  }

  await env.DB.prepare(
    "INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)"
  ).bind(message_id, user.user_id, emoji).run();
  return Response.json({ action: 'added' }, { status: 201 });
}

export async function onRequestGet(context) {
  const { env } = context;
  const url = new URL(context.request.url);
  const messageIds = url.searchParams.get('ids');
  if (!messageIds) return Response.json({ reactions: {} });

  const ids = messageIds.split(',').map(Number).filter(Boolean);
  if (!ids.length) return Response.json({ reactions: {} });

  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT message_id, emoji, user_id, u.name as user_name FROM message_reactions r JOIN users u ON r.user_id = u.id WHERE message_id IN (${placeholders})`
  ).bind(...ids).all();

  const reactions = {};
  for (const r of rows.results) {
    if (!reactions[r.message_id]) reactions[r.message_id] = [];
    reactions[r.message_id].push({ emoji: r.emoji, user_id: r.user_id, user_name: r.user_name });
  }
  return Response.json({ reactions });
}
