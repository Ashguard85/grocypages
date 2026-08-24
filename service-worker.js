'use strict';
const CACHE='grocy-article-pwa-v10';
const SW_VERSION='v10';
const SHELL=['./','./index.html','./app.js','./app.css','./manifest.webmanifest','./offline.html','./icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png','./icons/apple-touch-icon.png','./icons/favicon-32.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('grocy-article-pwa-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('message',e=>{if(e.data?.type==='SKIP_WAITING')self.skipWaiting();if(e.data?.type==='GET_VERSION'&&e.ports?.[0])e.ports[0].postMessage({version:SW_VERSION})});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url); if(e.request.method!=='GET')return;
  if(u.origin===self.location.origin){e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>e.request.mode==='navigate'?caches.match('./index.html').then(r=>r||caches.match('./offline.html')):caches.match(e.request))));}
});
