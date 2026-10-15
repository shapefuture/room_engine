const CACHE='room-of-us-v4';
const CORE=['/','/index.html','/manifest.webmanifest','/icon-192.svg','/icon-512.svg'];
const DYNAMIC=new Set(['/cartridge.json','/cartridge.gcf']);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function networkFirst(request){try{const response=await fetch(request,{cache:'no-store'});if(response.ok){const copy=response.clone();const c=await caches.open(CACHE);await c.put(request,copy);}return response;}catch{return caches.match(request);}}
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(DYNAMIC.has(url.pathname)||url.pathname.startsWith('/cartridge-parts/')){event.respondWith(networkFirst(event.request));return;}event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(async response=>{if(response.ok){const copy=response.clone();const c=await caches.open(CACHE);await c.put(request,copy);}return response;}).catch(()=>caches.match('/index.html'))));});
