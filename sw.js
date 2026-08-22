/* Полка — service worker.
   Оболочка приложения кэшируется навсегда, обложки — по мере просмотра. */
const SHELL = 'polka-shell-v3';
const MEDIA = 'polka-media-v1';

const FILES = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.allSettled(FILES.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== MEDIA).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Запросы к API всегда идут в сеть — данные должны быть свежими.
  if (url.hostname === 'api.tesera.ru') return;

  // Обложки: сначала кэш, потом сеть, с сохранением на будущее.
  if (url.hostname === 's.tesera.ru') {
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(MEDIA).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Своя оболочка: сеть с откатом в кэш, чтобы работало офлайн.
  // cache: 'no-cache' заставляет перепроверить файл на сервере по ETag.
  // Без этого GitHub Pages держит app.js в кэше браузера десять минут,
  // и свежая версия доезжает до устройства с опозданием.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache' })
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => fromCache(req))
    );
  }
});

/* Офлайн-откат.

   ignoreVary здесь решающий. GitHub Pages отдаёт файлы с заголовком Vary,
   а запрос на открытие приложения с домашнего экрана несёт не те заголовки,
   с какими файл клали в кэш при установке. Из-за этого точное совпадение
   не находилось, и в авиарежиме приложение просто не запускалось —
   при том что все файлы лежали в кэше. */
async function fromCache(req) {
  const opts = { ignoreVary: true, ignoreSearch: true };

  const exact = await caches.match(req, opts);
  if (exact) return exact;

  // Любой переход внутри приложения — это одна и та же страница:
  // маршрут живёт в адресной строке после решётки и до сервера не доходит.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    const page = await caches.match('./index.html', opts) || await caches.match('./', opts);
    if (page) return page;
  }

  return new Response('Нет связи, а в кэше пусто', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
