// Service worker de FolderPlay: deja la app disponible sin conexión.
// Los assets de Astro llevan hash en el nombre, así que cache-first es seguro;
// la navegación va network-first para recibir versiones nuevas al instante.

// Al cambiar el nombre se descartan las cachés anteriores en 'activate'.
// v3: reparto de app.js en módulos (assets nuevos) y páginas cacheadas por
// idioma. Los assets viejos quedaban huérfanos ocupando sitio para siempre.
// v4: Astro 7 rehace los hashes y renombra el chunk de CSS (index.* → AppShell.*),
// así que toda la caché v3 queda huérfana.
const CACHE = 'folderplay-v4';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cada página se guarda con su propia dirección: cacheando todo como '/', sin
// conexión se servía la página en español a quien entraba por /en/.
async function handleNavigation(request) {
  const key = new URL(request.url).pathname;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(key, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(key) || await caches.match('/');
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function handleAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
  } else {
    event.respondWith(handleAsset(request));
  }
});
