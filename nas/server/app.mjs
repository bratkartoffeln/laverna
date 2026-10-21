import { createServer } from 'node:http';
import { readFile, stat, writeFile, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Store, fail, checkPassword } from './store.mjs';
import { Backups } from './backups.mjs';

const mime = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.ico':'image/x-icon', '.woff':'font/woff', '.woff2':'font/woff2', '.ttf':'font/ttf', '.eot':'application/vnd.ms-fontobject', '.map':'application/json', '.md':'text/plain; charset=utf-8', '.less':'text/plain; charset=utf-8' };
export async function application({ dataDirectory, webDirectory, accountDirectory = new URL('./public/', import.meta.url), secureCookies = true, publicUrl, revision = 'development' }) {
  const store = await Store.open(dataDirectory);
  const backups = await Backups.open(store);
  const web = resolve(webDirectory);
  mime['.webmanifest'] = 'application/manifest+json';
  const rate = new Map();
  let hashing = 0;
  let mutations = 0;
  let maintenanceRequested = false;
  const maintenanceFile = resolve(dataDirectory, '.update-maintenance');
  const maintenance = async () => { try { await stat(maintenanceFile); return true; } catch (e) {if(e.code !== 'ENOENT')throw e; return false;} };
  const limitedHash = async fn => {
    if (hashing >= 4) fail(429, 'Zu viele Anmeldungen. Bitte kurz warten.');
    hashing++;
    try { return await fn(); } finally { hashing--; }
  };
  const send = (res, status, data) => { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8'}); res.end(JSON.stringify(data)); };
  const cookie = token => 'laverna_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + (token ? 30 * 86400 : 0) + (secureCookies ? '; Secure' : '');
  const server = createServer(async (req, res) => {
    let counted = false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = decodeURIComponent(url.pathname);
      if (path === '/internal/maintenance' && req.method === 'POST') {
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) fail(403, 'Nur lokal verfügbar.');
        if (url.searchParams.get('action') === 'enter') {
          maintenanceRequested = true;
          await writeFile(maintenanceFile, 'NAS update in progress\n', {mode:0o600});
          const until = Date.now() + 10000;
          while (mutations && Date.now() < until) await new Promise(r => setTimeout(r, 50));
          if (mutations) fail(503, 'Schreibvorgänge noch aktiv.');
        } else if (url.searchParams.get('action') === 'exit') {
          await unlink(maintenanceFile).catch(e => {if(e.code !== 'ENOENT') throw e;});
          maintenanceRequested = false;
        }
        else fail(400, 'Aktion fehlt.');
        return send(res, 200, {maintenance:await maintenance()});
      }
      const token = /(?:^|;\s*)laverna_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      const user = store.session(token);
      const requireUser = () => {
        if (!user) fail(401, 'Bitte anmelden.');
        if (req.headers['x-laverna-user'] !== user.id) fail(409, 'Das angemeldete Konto hat sich geändert. Bitte die Seite neu laden.');
      };
      if (path.startsWith('/api/')) {
        if (req.method !== 'GET') {
          const origins = new Set([publicUrl && new URL(publicUrl).origin, 'http://' + req.headers.host]);
          if (!origins.has(req.headers.origin) || req.headers['x-laverna-request'] !== '1' || !/^application\/json\b/.test(req.headers['content-type'] || '')) fail(403, 'Anfrage nicht erlaubt.');
          if (maintenanceRequested || await maintenance() || maintenanceRequested) fail(503, 'NAS-Update läuft. Änderungen bleiben lokal und werden gleich erneut synchronisiert.');
          mutations++; counted = true;
        }
        let body = {};
        if (req.method === 'POST') {
          let size = 0, chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 24 * 1024 * 1024) fail(413, 'Anfrage zu groß (maximal 24 MiB).');
            chunks.push(chunk);
          }
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail(400, 'Ungültiges JSON.'); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Ungültige Anfrage.');
        }
        if (req.method === 'GET' && path === '/api/status') return send(res, 200, { setupRequired: !store.hasUsers() });
        if (req.method === 'POST' && (path === '/api/login' || path === '/api/setup')) {
          const keys = [req.socket.remoteAddress, 'user:' + String(body.username || '').toLowerCase().slice(0,64)];
          const now = Date.now();
          if (rate.size > 2000) for (const [k,v] of rate) if (v.until < now) rate.delete(k);
          for (const key of keys) {
            const bucket = rate.get(key) || { attempts: 0, until: now + 15 * 60000 };
            if (bucket.until < now) { bucket.attempts = 0; bucket.until = now + 15 * 60000; }
            if (++bucket.attempts > (key.startsWith('user:') ? 20 : 100)) { rate.set(key, bucket); fail(429, 'Zu viele Anmeldeversuche. Bitte in 15 Minuten erneut versuchen.'); }
            if (rate.size < 5000 || rate.has(key)) rate.set(key, bucket); else fail(429, 'Zu viele Anmeldungen. Bitte später erneut versuchen.');
          }
          const login = await limitedHash(async () => {
            if (path === '/api/setup') {
              if (typeof body.setupToken !== 'string' || body.setupToken.length > 256) fail(403, 'Einrichtungsschlüssel fehlt.');
              await store.createUser(body.username, body.password, true, body.setupToken);
            }
            return store.login(body.username, body.password);
          });
          rate.delete(keys[1]);
          res.setHeader('Set-Cookie', cookie(login.token));
          return send(res, 200, { user: login.user, csrf: login.csrf });
        }
        if (path === '/api/me' && req.method === 'GET') {
          if (!user) fail(401, 'Bitte anmelden.');
          if (req.headers['x-laverna-user']) requireUser();
          return send(res, 200, { user: store.publicUser(user), csrf: user.csrf });
        }
        requireUser();
        if (req.method !== 'GET' && req.headers['x-csrf-token'] !== user.csrf) fail(403, 'Sitzung ungültig. Bitte die Seite neu laden.');
        if (path === '/api/logout' && req.method === 'POST') { store.logout(token); res.setHeader('Set-Cookie', cookie('')); return send(res, 200, { ok: true }); }
        if (path === '/api/password' && req.method === 'POST') {
          await limitedHash(async () => {
            if (!await checkPassword(body.currentPassword, user.password)) fail(403, 'Bisheriges Passwort falsch.');
            await store.changePassword(user.id, body.password);
          });
          res.setHeader('Set-Cookie', cookie('')); return send(res, 200, { ok: true });
        }
        if (path === '/api/sync' && req.method === 'GET') return send(res, 200, store.snapshot(user.id, url.searchParams.get('profile') || 'notes-db'));
        if (path === '/api/sync' && req.method === 'POST') return send(res, 200, store.save(user.id, body.profile, body));
        if (path === '/api/profiles' && req.method === 'GET') return send(res, 200, { profiles: store.db.prepare('SELECT name,crypto FROM profiles WHERE user_id=?').all(user.id).map(p => ({name:p.name, crypto:JSON.parse(p.crypto)})) });
        if (path === '/api/history' && req.method === 'GET') return send(res, 200, { revisions: store.history(user.id, url.searchParams.get('profile') || 'notes-db', url.searchParams.get('collection'), url.searchParams.get('id')) });
        if (path === '/api/backups' && user.admin) {
          if (req.method === 'GET') return send(res, 200, await backups.list());
          if (body.action === 'create') return send(res, 201, await backups.create());
          if (body.action === 'schedule') { await backups.configure(body.intervalHours); return send(res, 200, await backups.list()); }
          if (body.action === 'restore') {
            if (body.confirmation !== 'WIEDERHERSTELLEN') fail(400, 'Bestätigung zur Wiederherstellung fehlt.');
            if (!await limitedHash(() => checkPassword(body.password, user.password))) fail(403, 'Administratorkennwort falsch.');
            maintenanceRequested = true;
            try {
              const until = Date.now() + 10000;
              while (mutations > 1 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 25));
              if (mutations > 1) fail(503, 'Schreibvorgänge noch aktiv.');
              return send(res, 200, await backups.restore(body.id));
            } finally { maintenanceRequested = false; }
          }
        }
        if (path === '/api/backups/download' && req.method === 'GET' && user.admin) {
          const id = url.searchParams.get('id'), filename = await backups.filename(id);
          res.setHeader('Content-Type', 'application/vnd.sqlite3');
          res.setHeader('Content-Disposition', 'attachment; filename="' + id + '"');
          createReadStream(filename).on('error', () => res.destroy()).pipe(res); return;
        }
        if (path === '/api/users' && user.admin) {
          if (req.method === 'GET') return send(res, 200, { users: store.users() });
          if (req.method === 'POST') {
            if (body.action === 'create') return send(res, 201, { user: await limitedHash(() => store.createUser(body.username, body.password, false)) });
            if (body.action === 'reset-password') { await limitedHash(() => store.changePassword(body.id, body.password)); return send(res, 200, { ok:true }); }
            if (body.action === 'disable') { store.disable(body.id, Boolean(body.disabled), user.id); return send(res, 200, { ok:true }); }
          }
        }
        fail(404, 'Nicht gefunden.');
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'Methode nicht erlaubt.');
      if (path === '/healthz' || path === '/ready.json') {
        store.db.prepare('SELECT 1').get();
        const info = JSON.parse(await readFile(resolve(web, 'ready.json'), 'utf8'));
        return send(res, 200, { ...info, sourceRevision: revision, sync: true, schema: 1 });
      }
      if (['/account', '/account.js', '/account.css'].includes(path)) {
        if (path === '/account' && user && !url.searchParams.has('session')) {
          res.writeHead(302, {Location:'/#/settings/account'}); res.end(); return;
        }
        const name = path === '/account' ? 'account.html' : path.slice(1);
        res.setHeader('Content-Security-Policy', "default-src 'self'; font-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        res.setHeader('Content-Type', mime[extname(name)]);
        res.end(await readFile(new URL(name, accountDirectory))); return;
      }
      if (path === '/nas-session.js') {
        if (!user) fail(401, 'Bitte anmelden.');
        res.setHeader('Content-Type', mime['.js']);
        res.end('window.LAVERNA_NAS=' + JSON.stringify({ user:store.publicUser(user), csrf:user.csrf }).replaceAll('<','\\u003c') + ';'); return;
      }
      if (path === '/' || path === '/index.html') {
        if (!user) { res.writeHead(302, {Location:'/account'}); res.end(); return; }
        const html = await readFile(resolve(web, 'index.html'), 'utf8');
        res.setHeader('Content-Type', mime['.html']);
        res.end(html.replace('<head>', '<head><script src="/nas-session.js"></script>')); return;
      }
      if (path.split('/').some(p => p.startsWith('.') || p.includes('\\')) || !mime[extname(path)]) fail(404, 'Nicht gefunden.');
      const filename = resolve(web, '.' + path);
      if (!filename.startsWith(web + sep)) fail(404, 'Nicht gefunden.');
      let info;
      try { info = await stat(filename); } catch { fail(404, 'Nicht gefunden.'); }
      if (!info.isFile()) fail(404, 'Nicht gefunden.');
      res.setHeader('Content-Type', mime[extname(filename)]);
      res.setHeader('Content-Length', info.size);
      res.writeHead(200);
      if (req.method === 'HEAD') res.end(); else createReadStream(filename).on('error', () => res.destroy()).pipe(res);
    } catch (e) {
      if (!res.headersSent) send(res, e.status || (e instanceof URIError ? 400 : 500), { error:e.status ? e.message : 'Serverfehler.' });
      else res.destroy();
      if (!e.status && !(e instanceof URIError)) console.error('Request failed:', e.code || e.name);
    } finally { if (counted) mutations--; }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  return { server, store, backups, close: async () => { await backups.close(); await new Promise(resolve => server.close(resolve)); store.close(); } };
}
