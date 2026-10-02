const CACHE='examkok-v12-study-os';
const ASSETS=['/','/manifest.webmanifest','/icon.svg','/v12.css','/model.js','/legacy.js','/math.js','/app.js'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/api/'))return;e.respondWith(fetch(e.request,{cache:'no-store'}).catch(()=>caches.match(e.request).then(r=>r||(e.request.mode==='navigate'?caches.match('/'):Response.error()))))});
