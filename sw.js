// Wave Mine service worker: keeps the game playable offline and makes it installable.
// Same-origin files only. The 1v1 relay, Google Fonts and anything cross-origin go straight to the network.
const VERSION = 'wavemine-v3';
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  const isConfig = url.pathname.endsWith('/config.js');
  if (isPage || isConfig) {
    // Network first, so a new index.html reaches players as soon as it is online. Cache when offline.
    event.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(cache => cache.put(isConfig ? './config.js' : './index.html', copy));
        return res;
      }).catch(() => caches.match(isConfig ? './config.js' : './index.html'))
    );
    return;
  }
  // Icons and manifest: cache first.
  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(cache => cache.put(req, copy));
      return res;
    }))
  );
});

// ---- turn alerts (Web Push, no payload: the worker wakes us, we read the latest move ourselves) ----
const ALERT_TEXT = {
  q: 'played. Your turn.', check: 'checked an answer. Your turn.', mine: 'sealed their mine.', giveup: 'gave up. You win.',
  rematch: 'wants a rematch. Hide your gems.', join: 'joined your room.', leave: 'left the room.', sub: 'turned alerts on.',
};
async function alertText() {
  let meta = null;
  try { const c = await caches.open('wavemine-meta'); const r = await c.match('./_meta'); if (r) meta = await r.json(); } catch (e) { /* none */ }
  const room = meta && meta.room ? String(meta.room) : '';
  let body = 'Your opponent played. Your turn.';
  try {
    if (meta && meta.db && room) {
      const res = await fetch(`${meta.db}/rooms/${room}/events.json?orderBy="$key"&limitToLast=1`, { cache: 'no-store' });
      const data = await res.json();
      const ev = data && typeof data === 'object' ? Object.values(data)[0] : null;
      const who = meta.opp || 'Your opponent';
      if (ev && ev.by && ev.by !== meta.me) {
        body = ev.t === 'chat' ? `${who}: ${String(ev.text || '').slice(0, 120)}` : `${who} ${ALERT_TEXT[ev.t] || 'made a move.'}`;
      }
    }
  } catch (e) { /* offline: keep the generic text */ }
  return { body: body + (room ? ` Room ${room}.` : ''), room };
}
self.addEventListener('push', event => {
  event.waitUntil(alertText().then(({ body, room }) => self.registration.showNotification('Wave Mine', {
    body, icon: './icon-192.png', badge: './icon-192.png', tag: 'wavemine-' + room, renotify: true, data: { url: './' + (room ? '#room=' + room : '') },
  })));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || './', self.location.href).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(w => 'focus' in w);
    if (c) return (c.navigate ? c.navigate(target) : Promise.resolve(c)).then(w => w && w.focus());
    return self.clients.openWindow(target);
  }));
});
