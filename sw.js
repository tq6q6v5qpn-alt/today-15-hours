const CACHE='today15-v19';
// Retire only this app's confirmed previous cache. Preserve all unknown names.
const RETIRED_CACHES=new Set(['today15-v18']);
const FILES=['./','./index.html','./styles.css?v=19','./core.js?v=19','./tracking.js?v=19','./time-controls.js?v=19','./app.js?v=19','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE&&RETIRED_CACHES.has(key)).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.open(CACHE).then(cache=>cache.match(event.request).then(hit=>hit||(
    event.request.mode==='navigate'?cache.match('./index.html'):undefined
  )))));
});
