// Compatibilidade: páginas antigas ainda podem solicitar sw.js.
// A versão atual registra sw-financeiro.js no mesmo escopo e substitui esta.
const FINANCE_CACHE_PREFIX = 'meu-financeiro-familiar-';
const CACHE = `${FINANCE_CACHE_PREFIX}v533-icone-legivel`;
const APP_SCOPE_PATH = '/Gest-o-Financeira/';
const ASSETS = ['./', './index.html', './styles.css', './managers.css', './ui-fixes.css', './family.css', './decision.css', './manifest.json', './manifest-financeiro.webmanifest', './app.js', './domain.js', './storage.js', './icone-financeiro-180.png', './icone-financeiro-192.png', './icone-financeiro-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(FINANCE_CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))),
  self.clients.claim()
])));
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(APP_SCOPE_PATH)) return;
  event.respondWith(fetch(event.request, { cache: 'no-store' }).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
