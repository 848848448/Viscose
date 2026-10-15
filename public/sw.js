const CACHE = 'viscose-v2';
const SHELL = ['/', '/manifest.json', '/icon-192.png'];
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Viscose - offline</title><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center"><div><h2>You are offline</h2><p>Check your connection, then reload.</p><button onclick="location.reload()" style="padding:10px 18px;border-radius:10px;border:0;background:#111;color:#fff;font-weight:600">Reload</button></div></body>';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

function withTimeout(p, ms) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); }); }

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // never touch map tiles / CDNs
  if (url.pathname.startsWith('/api/')) return;               // never cache API data
  if (req.headers.has('range')) return;
  const isNav = req.mode === 'navigate';
  e.respondWith((async () => {
    try {
      const r = await (isNav ? withTimeout(fetch(req), 6000) : fetch(req));
      if (r && r.ok && r.type === 'basic') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(isNav ? '/' : req, copy)).catch(() => {}); }
      return r;
    } catch (err) {
      const hit = await caches.match(isNav ? '/' : req);
      if (hit) return hit;
      if (isNav) return new Response(OFFLINE, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      return Response.error();
    }
  })());
});
