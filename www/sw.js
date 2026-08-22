// Service Worker - 离线缓存
const CACHE_NAME = 'lottery-app-v2';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/engine.js',
  './js/storage.js',
  './js/api.js',
  './js/adapters.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// 拦截请求
self.addEventListener('fetch', (event) => {
  const req = event.request;
  
  // 只缓存 GET 请求
  if (req.method !== 'GET') return;
  
  const url = new URL(req.url);
  
  // API 请求：网络优先，失败回退缓存
  if (url.hostname.includes('api16868') || url.hostname.includes('api68')) {
    event.respondWith(
      fetch(req).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }
  
  // 静态资源：缓存优先，更新缓存
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // 后台更新
        fetch(req).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
        }).catch(() => {});
        return cached;
      }
      
      return fetch(req).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
