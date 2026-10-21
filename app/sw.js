/* Static app assets are shared; offline identity and shell are private. */
const build = '__OFFLINE_VERSION__';
const assetsName = 'laverna-assets-' + build;
const privateName = 'laverna-offline-session';
const identityKey = '/__offline_identity__';
const shellKey = '/__offline_shell__';
let preparing;
let generation = 0;
self.addEventListener('activate', event => event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('laverna-assets-') && name !== assetsName) await caches.delete(name);
    await self.clients.claim();
})()));
async function clearSession() { generation++; await caches.delete(privateName); }
async function prepare(user) {
    if (!user || typeof user.id !== 'string') throw new Error('Anmeldung fehlt.');
    const ticket = ++generation;
    const cache = await caches.open(assetsName);
    const urls = await fetch('/offline-assets.json',{cache:'no-store'}).then(response => response.json());
    let index = 0;
    await Promise.all(Array.from({length:8}, async () => {
        while (index < urls.length) {
            const url = urls[index++];
            if (await cache.match(url)) continue;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Offline-Datei fehlt: ' + url);
            await cache.put(url,response);
        }
    }));
    const shell = await fetch('/',{cache:'no-store'});
    if (!shell.ok || shell.redirected) throw new Error('Anmeldung erforderlich.');
    const session = await fetch('/api/me',{cache:'no-store'}).then(response => { if (!response.ok) throw new Error('Anmeldung erforderlich.'); return response.json(); });
    if (ticket !== generation || session.user.id !== user.id) throw new Error('Das angemeldete Konto hat sich geändert.');
    const privateCache = await caches.open(privateName);
    await privateCache.put(shellKey,shell);
    await privateCache.put(identityKey,new Response(JSON.stringify({user:session.user,csrf:'',offline:true}),{headers:{'Content-Type':'application/json'}}));
}
self.addEventListener('message', event => {
    if (event.data?.type !== 'prepare') return;
    event.waitUntil((async () => {
        try {
            if (!preparing || preparing.userId !== event.data.user?.id) {
                const task = {userId:event.data.user?.id,promise:prepare(event.data.user)};
                preparing = task; task.promise.finally(() => { if (preparing === task) preparing = null; }).catch(() => {});
            }
            await preparing.promise; event.ports[0]?.postMessage({ok:true});
        } catch (error) { event.ports[0]?.postMessage({ok:false,error:error.message}); }
    })());
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (['/api/logout','/api/login','/api/setup'].includes(url.pathname) && event.request.method === 'POST') {
        event.respondWith((async () => { const response = await fetch(event.request); if (response.ok) await clearSession(); return response; })()); return;
    }
    if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || ['/ready.json','/healthz','/sw.js','/offline-assets.json'].includes(url.pathname)) return;
    if (url.pathname === '/nas-session.js') {
        event.respondWith((async () => {
            try { const response = await fetch(event.request); if (response.status === 401) await clearSession(); return response; }
            catch (error) {
                const identity = await (await caches.open(privateName)).match(identityKey);
                if (!identity) throw error;
                return new Response('window.LAVERNA_NAS=' + (await identity.text()).replaceAll('<','\\u003c') + ';',{headers:{'Content-Type':'application/javascript'}});
            }
        })()); return;
    }
    if (event.request.mode === 'navigate') {
        event.respondWith((async () => {
            try { return await fetch(event.request); }
            catch (error) {
                if (url.pathname !== '/' && url.pathname !== '/index.html') throw error;
                const cache = await caches.open(privateName);
                if (!await cache.match(identityKey)) throw error;
                const shell = await cache.match(shellKey); if (!shell) throw error; return shell;
            }
        })()); return;
    }
    if (!/^\/(scripts|styles|locales|bower_components|images)\//.test(url.pathname) && url.pathname !== '/manifest.webmanifest') return;
    event.respondWith((async () => {
        const cache = await caches.open(assetsName);
        const cached = await cache.match(event.request,{ignoreSearch:true});
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) await cache.put(event.request,response.clone());
        return response;
    })());
});
