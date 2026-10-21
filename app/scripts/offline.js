/* Prepare the offline shell without storing cookies or CSRF tokens. */
(function() {
    'use strict';
    window.LavernaOffline = {ready:false};
    if (!window.LAVERNA_NAS || !('serviceWorker' in navigator) || !window.isSecureContext) return;
    async function prepare() {
        if (window.LAVERNA_NAS.offline || !navigator.onLine) return;
        try {
            var registration = await navigator.serviceWorker.register('/sw.js');
            await navigator.serviceWorker.ready;
            var worker = registration.active, channel = new MessageChannel();
            var result = await new Promise(function(resolve,reject) {
                var timer = setTimeout(function() { reject(new Error('Offline-Vorbereitung dauert länger. Beim nächsten Start wird sie fortgesetzt.')); },120000);
                channel.port1.onmessage = function(event) { clearTimeout(timer); resolve(event.data); };
                worker.postMessage({type:'prepare',user:window.LAVERNA_NAS.user},[channel.port2]);
            });
            var prompt = window.LavernaOffline.installPrompt;
            window.LavernaOffline = {ready:result.ok,error:result.error,installPrompt:prompt};
        } catch (error) { window.LavernaOffline = {ready:false,error:error.message}; }
        window.dispatchEvent(new CustomEvent('laverna:offline-ready'));
    }
    window.addEventListener('load',prepare);
    window.addEventListener('online',prepare);
    window.addEventListener('beforeinstallprompt',function(event) {
        event.preventDefault(); window.LavernaOffline.installPrompt = event;
        window.dispatchEvent(new CustomEvent('laverna:offline-ready'));
    });
}());
