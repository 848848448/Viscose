const typingState = {};

export async function onRequestPost(context) {
  const { data } = context;
  const user = data.user;
  const { to } = await context.request.json();
  if (!to) return Response.json({ error: 'Missing to' }, { status: 400 });
  const key = `${user.user_id}_${to}`;
  typingState[key] = Date.now();
  return Response.json({ ok: true });
}

export async function onRequestGet(context) {
  const { data } = context;
  const user = data.user;
  const url = new URL(context.request.url);
  const from = url.searchParams.get('from');
  if (!from) return Response.json({ typing: false });
  const key = `${from}_${user.user_id}`;
  const ts = typingState[key];
  const typing = ts && (Date.now() - ts) < 4000;
  return Response.json({ typing: !!typing });
}
