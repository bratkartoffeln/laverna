/* global define */
define(['underscore', 'marionette', 'backbone.radio', 'localforage'], function(_, Marionette, Radio, localForage) {
    'use strict';
    var types = ['files', 'notes', 'notebooks', 'tags'];
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).filter(function(k) { return value[k] !== undefined; }).sort().map(function(k) { return JSON.stringify(k) + ':' + canonical(value[k]); }).join(',') + '}';
        return JSON.stringify(value);
    }
    function clean(model, keys) {
        var data = JSON.parse(JSON.stringify(model));
        if (data.encryptedData) (keys || []).forEach(function(k) { delete data[k]; });
        return data;
    }
    async function fileData(model) {
        var data = Object.assign({}, model);
        if (data.src instanceof Blob) {
            if (data.src.size > 10 * 1024 * 1024) throw new Error('NAS: Anhänge dürfen maximal 10 MiB groß sein.');
            data.src = await new Promise(function(resolve,reject) { var reader=new FileReader();reader.onload=function(){resolve(reader.result);};reader.onerror=reject;reader.readAsDataURL(data.src); });
        }
        return clean(data, []);
    }
    async function decodeRemote(remote) {
        for (var record of remote.records) {
            if (record.collection === 'files' && record.data.encryptedData) {
                var decoded = await Radio.request('encrypt', 'decrypt', record.data.encryptedData);
                if (typeof decoded === 'string') decoded = JSON.parse(decoded);
                record.data = Object.assign(_.omit(record.data,'encryptedData'), decoded);
            }
        }
        return remote;
    }
    async function saveRemote(record, profile) {
        var data = Object.assign({},record.data);
        if (record.collection === 'files' && typeof data.src === 'string' && data.src.startsWith('data:')) {
            var blob = await fetch(data.src).then(function(r){return r.blob();}); data.src=blob;
        }
        return Radio.request(record.collection,'save:raw',data,{profile:profile,preserveCiphertext:true});
    }
    function cryptoConfigs() {
        var config = Radio.request('configs', 'get:object');
        return String(config.encrypt) === '1' ? {
            encrypt:'1', encryptSalt:config.encryptSalt, encryptIter:String(config.encryptIter),
            encryptTag:String(config.encryptTag), encryptKeySize:String(config.encryptKeySize)
        } : {encrypt:'0'};
    }
    function key(record) { return record.collection + '/' + record.id; }
    async function local(profile) {
        var result = {};
        for (var type of types) {
            var collection = await Radio.request(type, 'fetch', {encrypt:true, profile:profile});
            var keys = collection.model.prototype.encryptKeys;
            for (var model of (collection.fullCollection || collection).toJSON()) {
                var data = type === 'files' ? await fileData(model) : clean(model, keys);
                result[type + '/' + model.id] = {collection:type,id:model.id,data:data,hash:canonical(data)};
            }
        }
        return result;
    }
    async function api(path, body) {
        var session = window.LAVERNA_NAS;
        var headers = {'X-Laverna-User':session.user.id,'X-CSRF-Token':session.csrf,'X-Laverna-Request':'1'};
        if (body) headers['Content-Type'] = 'application/json';
        var response = await fetch('/api/' + path, {method:body ? 'POST' : 'GET', headers:headers, body:body && JSON.stringify(body), signal:AbortSignal.timeout(30000)});
        var data = await response.json();
        if (!response.ok) {
            var error = new Error(data.error || 'NAS nicht erreichbar.'); error.status = response.status; throw error;
        }
        return data;
    }
    var Sync = Marionette.Object.extend({
        initialize: function() {
            this.profile = Radio.request('uri', 'profile') || 'notes-db';
            this.cache = localForage.createInstance({name:'nas-' + window.LAVERNA_NAS.user.id + '/' + this.profile, storeName:'nas-sync'});
            Radio.reply('sync', 'start', this.run, this);
            for (var type of types) this.listenTo(Radio.channel(type), 'sync:model destroy:model restore:model saved:collection saved:all', this.schedule);
            this.focus = this.schedule.bind(this);
            window.addEventListener('online', this.focus); window.addEventListener('focus', this.focus);
            this.run();
        },
        status: function(text, error, state) {
            this.lastStatus = text;
            var element = document.getElementById('nas-sync-status');
            if (element) { element.textContent = text; element.classList.toggle('text-danger',Boolean(error)); }
            window.LavernaSyncStatus = {text:text,state:state || (error ? 'error' : 'synced')};
            window.dispatchEvent(new CustomEvent('laverna:sync-status'));
        },
        schedule: function() {
            this.status('Lokal gespeichert · Synchronisierung ausstehend',false,'pending');
            clearTimeout(this.timer);
            if (this.running) { this.again = true; return; }
            this.timer = setTimeout(this.run.bind(this), 800);
        },
        run: async function() {
            if (this.running) { this.again = true; return; }
            this.running = true; clearTimeout(this.timer); Radio.trigger('sync', 'start', 'nas');
            this.status('Wird mit dem NAS synchronisiert …',false,'syncing');
            var conflicts = false;
            try {
                if (window.LAVERNA_NAS.offline) {
                    var session = await fetch('/api/me').then(function(response) { if (!response.ok) throw new Error('NAS-Anmeldung erforderlich.'); return response.json(); });
                    if (session.user.id !== window.LAVERNA_NAS.user.id) throw new Error('Das angemeldete Konto hat sich geändert. Bitte neu laden.');
                    window.LAVERNA_NAS.csrf = session.csrf; window.LAVERNA_NAS.offline = false;
                }
                var base = await this.cache.getItem('base') || {};
                var before = await local(this.profile);
                var remote = await api('sync?profile=' + encodeURIComponent(this.profile));
                var crypto = cryptoConfigs();
                if (remote.crypto && canonical(remote.crypto) !== canonical(crypto)) throw new Error('NAS: Verschlüsselungseinstellungen stimmen nicht überein. Importiere dieselben Einstellungen wie auf dem ersten Gerät.');
                remote = await decodeRemote(remote);
                var profiles = await api('profiles'), configs=Radio.request('configs','get:object');
                var names=_.uniq(configs.appProfiles.concat(profiles.profiles.map(function(p){return p.name;})));
                if (names.length !== configs.appProfiles.length) await Radio.request('configs','save:object',{name:'appProfiles',value:JSON.stringify(names)});
                var remoteMap = {};
                remote.records.forEach(function(record) { remoteMap[key(record)] = record; });
                var changes = [];
                Object.keys(before).forEach(function(k) {
                    var item = before[k], known = base[k], r = remoteMap[k];
                    if (r && canonical(r.data) === item.hash) { base[k] = {rev:r.rev,hash:item.hash}; return; }
                    if (!known || known.hash !== item.hash) changes.push({collection:item.collection,id:item.id,data:item.data,baseRev:known ? known.rev : 0});
                });
                // Bound request size even when notes contain embedded attachments.
                while (changes.length) {
                    var batch = [], size = 0;
                    while (changes.length && batch.length < 50 && (size < 3 * 1024 * 1024 || !batch.length)) {
                        var change = changes.shift(); size += canonical(change).length;
                        if (change.collection === 'files' && crypto.encrypt === '1' && Number(change.data.trash) !== 2) {
                            var encrypted = await Radio.request('encrypt','encrypt',_.pick(change.data,'name','src','fileType'));
                            change.data = Object.assign(_.omit(change.data,'name','src','fileType'),{encryptedData:encrypted});
                        }
                        batch.push(change);
                    }
                    var written = await api('sync', {profile:this.profile,crypto:crypto,changes:batch});
                    written.results.forEach(function(result) {
                        var k = key(result);
                        if (result.conflict) conflicts = true;
                        else base[k] = {rev:result.rev,hash:before[k].hash};
                    });
                    // Persist acknowledgements before fetching more remote data.
                    await this.cache.setItem('base', base);
                }
                remote = await api('sync?profile=' + encodeURIComponent(this.profile));
                remote = await decodeRemote(remote);
                var current = await local(this.profile);
                for (var record of remote.records) {
                    var k = key(record), hash = canonical(record.data);
                    // An edit made during the HTTP request stays local for the next round.
                    if ((current[k] && current[k].hash) !== (before[k] && before[k].hash)) continue;
                    if (!current[k] || current[k].hash !== hash) {
                        var saved = await saveRemote(record, this.profile);
                        if (!saved) throw new Error('NAS-Datensatz konnte nicht übernommen werden. Prüfe die Verschlüsselungseinstellungen.');
                    }
                    base[k] = {rev:record.rev,hash:hash};
                }
                await this.cache.setItem('base', base);
                var conflictCount = remote.records.filter(function(record) { return record.collection === 'notes' && Number(record.data.trash) === 0 && record.data.conflictOf; }).length;
                this.status(conflictCount ? 'NAS: ' + conflictCount + ' offene Konflikte · In der Notizansicht vergleichen.' : conflicts ? 'NAS: Konflikt erkannt; beide Fassungen wurden erhalten.' : 'NAS: synchronisiert · ' + new Date().toLocaleTimeString(),false,conflictCount || conflicts ? 'conflict' : 'synced');
            } catch (error) {
                this.status((error.status === 401 ? 'NAS: Anmeldung abgelaufen. Öffne NAS-Konto zur Anmeldung.' : navigator.onLine ? error.message : 'Lokal gespeichert · Offline; Übertragung folgt automatisch.'), navigator.onLine, navigator.onLine ? 'error' : 'offline');
                Radio.trigger('sync', 'error', {cloud:'nas',error:error});
            } finally {
                this.running = false; Radio.trigger('sync', 'stop', 'nas');
                this.timer = setTimeout(this.run.bind(this), this.again ? 800 : 15000); this.again = false;
            }
        },
        onDestroy: function() {
            clearTimeout(this.timer); window.removeEventListener('online',this.focus); window.removeEventListener('focus',this.focus);
        }
    });
    Sync.importLegacy = async function() {
        if (!window.LAVERNA_NAS) throw new Error('NAS-Anmeldung erforderlich.');
        var profile = Radio.request('uri', 'profile') || 'notes-db';
        for (var type of types) {
            var old = localForage.createInstance({name:profile,storeName:type}), records = [];
            await old.iterate(function(value) { records.push(value); });
            if (records.some(function(value) { return value.encryptedData; }) && cryptoConfigs().encrypt !== '1') throw new Error('Zuerst die bisherigen Verschlüsselungseinstellungen importieren.');
            for (var record of records) {
                // Re-importing cannot overwrite notes already edited in the NAS account.
                var collection = await Radio.request(type, 'fetch', {encrypt:true,profile:profile});
                if (!(collection.fullCollection || collection).get(record.id)) {
                    var saved = await Radio.request(type, 'save:raw', record, {profile:profile});
                    if (!saved) throw new Error('Lokaler Datensatz konnte nicht übernommen werden.');
                }
            }
        }
        Radio.request('sync','start');
    };
    return Sync;
});
