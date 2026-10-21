import { DatabaseSync } from 'node:sqlite';
import { mkdir, readdir, readFile, writeFile, rename, stat, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, fail } from './store.mjs';

const managedName = /^laverna-[\dT.Z-]+(?:-(?:manual|automatic|before-restore)-[a-f0-9-]+)?\.sqlite$/;
export class Backups {
  static async open(store) {
    const manager = new Backups(store);
    await mkdir(manager.directory, {recursive:true,mode:0o700});
    try { manager.intervalHours = JSON.parse(await readFile(manager.config, 'utf8')).intervalHours; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (![0,24,168].includes(manager.intervalHours)) manager.intervalHours = 0;
    manager.timer = setInterval(() => manager.tick().catch(error => { manager.lastError = error.message; }), 60000);
    manager.timer.unref();
    return manager;
  }
  constructor(store) {
    this.store = store;
    this.directory = join(store.directory, 'backups');
    this.config = join(store.directory, 'backup-settings.json');
    this.intervalHours = 0;
  }
  async list() {
    const files = [];
    for (const id of await readdir(this.directory)) if (managedName.test(id)) {
      const filename = await this.filename(id);
      const info = await stat(filename);
      if (info.isFile()) files.push({id,created:info.mtimeMs,size:info.size});
    }
    files.sort((a,b) => b.created - a.created);
    const last = files[0]?.created || null;
    return {files,intervalHours:this.intervalHours,next:this.intervalHours ? last ? last + this.intervalHours * 3600000 : Date.now() : null,lastError:this.lastError || null};
  }
  async filename(id) {
    if (typeof id !== 'string' || !managedName.test(id)) fail(400, 'Ungültige Sicherung.');
    const filename = await realpath(join(this.directory, id)).catch(() => fail(404, 'Sicherung nicht gefunden.'));
    if (dirname(filename) !== await realpath(this.directory)) fail(400, 'Ungültiger Sicherungspfad.');
    return filename;
  }
  async configure(intervalHours) {
    if (![0,24,168].includes(intervalHours)) fail(400, 'Sicherungsintervall: aus, täglich oder wöchentlich.');
    await writeFile(this.config + '.tmp', JSON.stringify({intervalHours}) + '\n', {mode:0o600});
    await rename(this.config + '.tmp', this.config);
    this.intervalHours = intervalHours;
  }
  async tick(now = Date.now()) {
    if (!this.intervalHours || this.busy) return;
    const {files} = await this.list();
    if (!files.length || now - files[0].created >= this.intervalHours * 3600000) await this.create('automatic');
  }
  async create(kind = 'manual') {
    if (this.busy) fail(409, 'Eine Sicherung oder Wiederherstellung läuft bereits.');
    this.busy = true;
    this.operation = this.snapshot(kind);
    try { return await this.operation; } finally { this.busy = false; this.operation = null; }
  }
  async snapshot(kind) {
    const id = 'laverna-' + new Date().toISOString().replaceAll(':','-') + '-' + kind + '-' + randomUUID() + '.sqlite';
    await this.store.backup(join(this.directory,id));
    this.lastError = null;
    return {id};
  }
  async inspect(id) {
    const filename = await this.filename(id);
    let db;
    try {
      db = new DatabaseSync(filename, {readOnly:true});
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || db.prepare('PRAGMA user_version').get().user_version !== 1) fail(400, 'Sicherung ist beschädigt oder inkompatibel.');
      const profiles = db.prepare('SELECT user_id,name,crypto FROM profiles').all();
      const records = db.prepare('SELECT user_id,profile,collection,id,data FROM records').all();
      const users = new Set(this.store.users().map(user => user.id));
      for (const profile of profiles) {
        if (!users.has(profile.user_id)) fail(409, 'Ein Konto der Sicherung existiert nicht mehr.');
        const current = this.store.snapshot(profile.user_id,profile.name).crypto;
        if (current && canonical(current) !== canonical(JSON.parse(profile.crypto))) fail(409, 'Die Verschlüsselungseinstellungen der Sicherung stimmen nicht überein.');
      }
      for (const row of records) {
        const value = JSON.parse(row.data);
        if (!['notes','notebooks','tags','files'].includes(row.collection) || value.id !== row.id || value.type !== row.collection) fail(400, 'Sicherung enthält ungültige Datensätze.');
      }
      return {profiles,records};
    } catch (error) {
      if (error.status) throw error;
      fail(400, 'Sicherung konnte nicht geprüft werden.');
    } finally { db?.close(); }
  }
  async restore(id) {
    if (this.busy) fail(409, 'Eine Sicherung oder Wiederherstellung läuft bereits.');
    this.busy = true;
    try {
      const {profiles,records} = await this.inspect(id);
      const safety = await this.snapshot('before-restore');
      const db = this.store.db, now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const profile of profiles) {
          db.prepare('INSERT OR IGNORE INTO profiles VALUES(?,?,?)').run(profile.user_id,profile.name,profile.crypto);
          const saved = records.filter(row => row.user_id === profile.user_id && row.profile === profile.name);
          const keys = new Set(saved.map(row => row.collection + '/' + row.id));
          const current = this.store.snapshot(profile.user_id,profile.name).records;
          for (const row of current) if (!keys.has(row.collection + '/' + row.id) && Number(row.data.trash) !== 2) {
            this.store.write(profile.user_id,profile.name,row.collection,row.id,canonical({...row.data,trash:2,updated:now}));
          }
          for (const row of saved) this.store.write(row.user_id,row.profile,row.collection,row.id,canonical({...JSON.parse(row.data),updated:now}));
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return {ok:true,safetyBackup:safety.id,restored:records.length};
    } finally { this.busy = false; }
  }
  async close() { clearInterval(this.timer); await this.operation?.catch(() => {}); }
}
