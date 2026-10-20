import { DatabaseSync, backup } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const scrypt = promisify(scryptCallback);
export const digest = value => createHash('sha256').update(value).digest('hex');
export function fail(status, message) { throw Object.assign(new Error(message), { status }); }
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,63}$/.test(value)) fail(400, 'Benutzername: 3–64 Zeichen (Buchstaben, Zahlen, Punkt, _ oder -).');
  return value.toLowerCase();
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || Buffer.byteLength(value) > 512) fail(400, 'Das Passwort muss mindestens 12 Zeichen haben.');
  return value;
}
export async function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + Buffer.from(await scrypt(password(value), salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 })).toString('hex');
}
export async function checkPassword(value, stored) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 512) return false;
  const [salt, hash] = stored.split(':');
  const actual = await scrypt(value, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const collections = new Set(['notes', 'notebooks', 'tags', 'files']);
export function profileName(value) {
  if (typeof value !== 'string' || !value.length || value.length > 160 || /[\x00-\x1f]/.test(value)) fail(400, 'Ungültiges Profil.');
  return value;
}
function cleanCrypto(value) {
  if (!value || !['0', '1'].includes(String(value.encrypt))) fail(400, 'Verschlüsselungseinstellungen fehlen.');
  if (String(value.encrypt) === '1' && (!Array.isArray(value.encryptSalt) || value.encryptSalt.length > 32 || !value.encryptSalt.length || !value.encryptSalt.every(Number.isFinite) || !['128','192','256'].includes(String(value.encryptKeySize)) || !['64','96','128'].includes(String(value.encryptTag)) || !Number.isSafeInteger(Number(value.encryptIter)) || Number(value.encryptIter) < 1)) fail(400, 'Ungültige Verschlüsselungseinstellungen.');
  return String(value.encrypt) === '0' ? { encrypt: '0' } : {
    encrypt: '1', encryptSalt: value.encryptSalt,
    encryptIter: String(value.encryptIter), encryptTag: String(value.encryptTag), encryptKeySize: String(value.encryptKeySize)
  };
}
export class Store {
  static async open(directory) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const store = new Store(join(directory, 'laverna.sqlite'));
    store.directory = directory;
    store.dummyPassword = await hashPassword(randomBytes(32).toString('hex'));
    if (!store.hasUsers()) {
      try { store.setupToken = (await readFile(join(directory, 'setup-token'), 'utf8')).trim(); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        store.setupToken = randomBytes(32).toString('hex');
        await writeFile(join(directory, 'setup-token'), store.setupToken + '\n', { mode: 0o600, flag: 'wx' });
      }
    }
    return store;
  }
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('Database schema is newer than this server supports.');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS profiles(user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, crypto TEXT NOT NULL, PRIMARY KEY(user_id,name));
      CREATE TABLE IF NOT EXISTS revisions(rev INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), profile TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS records(user_id TEXT NOT NULL REFERENCES users(id), profile TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, rev INTEGER NOT NULL REFERENCES revisions(rev), data TEXT NOT NULL, PRIMARY KEY(user_id,profile,collection,id));
      CREATE INDEX IF NOT EXISTS history_lookup ON revisions(user_id,profile,collection,id,rev);
      PRAGMA user_version=1;
    `);
  }
  hasUsers() { return this.db.prepare('SELECT count(*) AS n FROM users').get().n > 0; }
  publicUser(user) { return { id: user.id, username: user.username, admin: Boolean(user.admin), disabled: Boolean(user.disabled) }; }
  async createUser(name, pass, admin = false, setupToken) {
    const normalized = username(name), hashed = await hashPassword(pass);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (setupToken !== undefined && (this.hasUsers() || !this.setupToken || !timingSafeEqual(Buffer.from(digest(setupToken)), Buffer.from(digest(this.setupToken))))) fail(403, 'Einrichtungsschlüssel ungültig oder Einrichtung bereits abgeschlossen.');
      const user = { id: randomUUID(), username: normalized, password: hashed, admin: admin ? 1 : 0, disabled: 0 };
      if (this.db.prepare('SELECT id FROM users WHERE username=?').get(normalized)) fail(409, 'Benutzername bereits vergeben.');
      this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run(user.id, user.username, user.password, user.admin, 0);
      this.db.exec('COMMIT');
      if (setupToken !== undefined) { this.setupToken = null; await unlink(join(this.directory, 'setup-token')).catch(() => {}); }
      return this.publicUser(user);
    } catch (e) { if (this.db.isTransaction) this.db.exec('ROLLBACK'); throw e; }
  }
  async login(name, pass) {
    const user = typeof name === 'string' ? this.db.prepare('SELECT * FROM users WHERE username=?').get(name.toLowerCase()) : null;
    const valid = await checkPassword(pass, user?.password || this.dummyPassword);
    if (!user || user.disabled || !valid) fail(401, 'Benutzername oder Passwort falsch.');
    const current = this.db.prepare('SELECT password,disabled FROM users WHERE id=?').get(user.id);
    if (current.disabled || current.password !== user.password) fail(401, 'Benutzername oder Passwort falsch.');
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token), user.id, csrf, Date.now() + 30 * 86400000);
    return { token, csrf, user: this.publicUser(user) };
  }
  session(token) {
    return this.db.prepare('SELECT users.*,sessions.csrf FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>? AND users.disabled=0').get(digest(token || ''), Date.now());
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token || '')); }
  async changePassword(id, pass) {
    const hashed = await hashPassword(pass);
    if (!this.db.prepare('UPDATE users SET password=? WHERE id=?').run(hashed, id).changes) fail(404, 'Konto nicht gefunden.');
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  users() { return this.db.prepare('SELECT * FROM users ORDER BY username').all().map(u => this.publicUser(u)); }
  disable(id, disabled, actor) {
    if (id === actor) fail(400, 'Das eigene Administratorkonto kann nicht gesperrt werden.');
    if (!this.db.prepare('UPDATE users SET disabled=? WHERE id=?').run(disabled ? 1 : 0, id).changes) fail(404, 'Konto nicht gefunden.');
    this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  }
  snapshot(user, profile) {
    profileName(profile);
    const settings = this.db.prepare('SELECT crypto FROM profiles WHERE user_id=? AND name=?').get(user, profile);
    return { crypto: settings ? JSON.parse(settings.crypto) : null, records: this.db.prepare('SELECT collection,id,rev,data FROM records WHERE user_id=? AND profile=? ORDER BY rev').all(user, profile).map(r => ({ ...r, data: JSON.parse(r.data) })) };
  }
  save(user, profile, input) {
    profileName(profile);
    if (!Array.isArray(input.changes) || input.changes.length > 100) fail(400, 'Maximal 100 Änderungen pro Anfrage.');
    const crypto = cleanCrypto(input.crypto);
    const changes = input.changes.map(c => {
      if (!collections.has(c.collection) || typeof c.id !== 'string' || !c.id.length || c.id.length > 160 || !Number.isSafeInteger(c.baseRev) || c.baseRev < 0 || !c.data || Array.isArray(c.data) || c.data.id !== c.id || c.data.type !== c.collection || !Number.isFinite(c.data.updated) || ![0,1,2].includes(Number(c.data.trash))) fail(400, 'Ungültiger Datensatz.');
      // Older Laverna objects may still have decrypted fields in memory.
      const data = { ...c.data };
      if (data.encryptedData) for (const key of c.collection === 'notes' ? ['title','content','tags','tasks'] : c.collection === 'files' ? ['name','src','fileType'] : ['name']) delete data[key];
      if (crypto.encrypt === '1' && Number(data.trash) !== 2 && !data.encryptedData) fail(409, 'Unverschlüsselte Daten für ein verschlüsseltes Profil abgelehnt.');
      const encoded = canonical(data);
      if (Buffer.byteLength(encoded) > (c.collection === 'files' ? 16 : 2) * 1024 * 1024) fail(413, 'Datensatz ist zu groß (Notizen: 2 MiB; Anhänge: 16 MiB inklusive Kodierung).');
      return { ...c, data, encoded };
    });
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT crypto FROM profiles WHERE user_id=? AND name=?').get(user, profile);
      if (old && old.crypto !== canonical(crypto)) fail(409, 'Die Verschlüsselungseinstellungen stimmen nicht überein. Importiere auf allen Geräten dieselben Laverna-Einstellungen.');
      if (!old) this.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(user, profile, canonical(crypto));
      const results = [];
      for (const c of changes) {
        const current = this.db.prepare('SELECT rev,data FROM records WHERE user_id=? AND profile=? AND collection=? AND id=?').get(user, profile, c.collection, c.id);
        if (current?.data === c.encoded) { results.push({ id: c.id, collection: c.collection, rev: current.rev }); continue; }
        if ((current?.rev || 0) !== c.baseRev) {
          // A stale delete must not remove a newer edit. Keep its attempted
          // deletion in history; active conflicting edits become separate records.
          let conflictId = null;
          if (Number(c.data.trash) !== 2) {
            conflictId = randomUUID();
            const copy = { ...c.data, id: conflictId };
            if (c.collection === 'notes' && !copy.encryptedData) copy.title += ' (Konfliktkopie)';
            this.write(user, profile, c.collection, conflictId, canonical(copy));
          } else this.db.prepare('INSERT INTO revisions(user_id,profile,collection,id,data,created) VALUES(?,?,?,?,?,?)').run(user, profile, c.collection, c.id, c.encoded, Date.now());
          results.push({ id: c.id, collection: c.collection, rev: current?.rev || 0, conflict: true, conflictId });
        } else results.push({ id: c.id, collection: c.collection, rev: this.write(user, profile, c.collection, c.id, c.encoded) });
      }
      this.db.exec('COMMIT');
      return { results };
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  write(user, profile, collection, id, data) {
    const rev = Number(this.db.prepare('INSERT INTO revisions(user_id,profile,collection,id,data,created) VALUES(?,?,?,?,?,?)').run(user, profile, collection, id, data, Date.now()).lastInsertRowid);
    this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,profile,collection,id) DO UPDATE SET rev=excluded.rev,data=excluded.data').run(user, profile, collection, id, rev, data);
    return rev;
  }
  history(user, profile, collection, id) {
    return this.db.prepare('SELECT rev,data,created FROM revisions WHERE user_id=? AND profile=? AND collection=? AND id=? ORDER BY rev DESC LIMIT 100').all(user, profileName(profile), collection, id).map(r => ({ ...r, data: JSON.parse(r.data) }));
  }
  async backup(destination) { return backup(this.db, destination); }
  close() { this.db.close(); }
}
