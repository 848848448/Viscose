async function hashPassword(password) {
  const encoder = new TextEncoder();
  const d = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', d);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { env } = context;
  const { email, token, new_password } = await context.request.json();

  if (token && new_password) {
    const reset = await env.DB.prepare(
      "SELECT * FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')"
    ).bind(token).first();
    if (!reset) return Response.json({ error: 'Invalid or expired reset link' }, { status: 400 });

    if (new_password.length < 6) return Response.json({ error: 'Password must be at least 6 characters' }, { status: 400 });

    const hash = await hashPassword(new_password);
    await env.DB.prepare("UPDATE users SET password_hash = ? WHERE email = ?").bind(hash, reset.email).run();
    await env.DB.prepare("UPDATE password_resets SET used = 1 WHERE id = ?").bind(reset.id).run();

    return Response.json({ success: true });
  }

  if (!email) return Response.json({ error: 'Email is required' }, { status: 400 });

  const user = await env.DB.prepare("SELECT id, name FROM users WHERE email = ?").bind(email.toLowerCase().trim()).first();
  if (!user) {
    return Response.json({ success: true });
  }

  const resetToken = crypto.randomUUID() + '-' + crypto.randomUUID();
  const expires = new Date(Date.now() + 3600000).toISOString();

  await env.DB.prepare("INSERT INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)")
    .bind(email.toLowerCase().trim(), resetToken, expires).run();

  if (env.RESEND_API_KEY) {
    const siteUrl = env.SITE_URL || 'https://viscose.pages.dev';
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: env.EMAIL_FROM || 'Viscose <onboarding@resend.dev>',
          to: [email.toLowerCase().trim()],
          subject: 'Reset your password',
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2>Password Reset</h2>
            <p>Hello ${user.name},</p>
            <p>Click the link below to reset your password. This link expires in 1 hour.</p>
            <p style="margin:24px 0"><a href="${siteUrl}/#reset=${resetToken}" style="background:#111;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:500">Reset Password</a></p>
            <p style="font-size:13px;color:#999">If you didn't request this, ignore this email.</p>
          </div>`
        })
      });
    } catch(e) { console.error('Reset email failed:', e); }
  }

  return Response.json({ success: true });
}
