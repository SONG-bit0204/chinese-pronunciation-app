// 오프라인 저장: 서버가 켜져 있으면 최신 파일을 쓰고, 꺼져 있으면 저장해 둔 파일로 열기
const CACHE = 'zh-pron-app-v5';
const PRE = ['./', './index.html', './css/style.css', './js/pitch.js', './js/app.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './shared/css/base.css', './shared/js/data.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('zh-pron-app-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
    );
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    // 병음 라이브러리: 한 번 받으면 저장 (그다음부터는 인터넷 없이도 병음 표시)
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return res;
    })));
  }
});
