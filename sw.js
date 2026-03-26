const CACHE_NAME = 'bondi-cache-v1';
const ASSETS = [
  'index.html',
  'style.css',
  'app.js',
  'routes.txt',
  'stops.txt',
  'trips.txt',
  'stop_times.txt'
];

// Instalación: Guardamos los archivos en caché
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Estrategia: Cache First (Prioriza velocidad y ahorro de datos)
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  );
});