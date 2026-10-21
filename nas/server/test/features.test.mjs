import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { createRequire } from 'node:module';
import { application } from '../app.mjs';
const Search = createRequire(import.meta.url)('../../../app/scripts/helpers/note-search.js');
const password = 'backup-feature-password-123', crypto = {encrypt:'0'};
const change = (id,title,baseRev = 0,extra = {}) => ({collection:'notes',id,baseRev,data:{id,type:'notes',title,content:'Content',trash:0,updated:Date.now(),...extra}});
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(),'laverna-feature-test-'));
  const web = join(directory,'web'); await mkdir(web); await writeFile(join(web,'ready.json'),'{}');
  const app = await application({dataDirectory:join(directory,'data'),webDirectory:web,secureCookies:false});
  await app.store.createUser('owner',password,true,app.store.setupToken);
  await app.store.createUser('alice',password);
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {
    await app.close();
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('laverna-feature-test-'));
    await rm(directory,{recursive:true,force:true});
  });
  async function request(path,body,session) {
    const response = await fetch(origin + path,{method:body ? 'POST' : 'GET',headers:{Origin:origin,'Content-Type':'application/json','X-Laverna-Request':'1',...(session ? {Cookie:session.cookie,'X-Laverna-User':session.user.id,'X-CSRF-Token':session.csrf} : {})},body:body && JSON.stringify(body)});
    const bytes = Buffer.from(await response.arrayBuffer());
    let data; try { data = JSON.parse(bytes.toString()); } catch { data = bytes; }
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0]};
  }
  async function login(username) { const result = await request('/api/login',{username,password}); return {...result.data,cookie:result.cookie}; }
  return {app,directory,request,owner:await login('owner'),alice:await login('alice')};
}
test('Search combines literal phrases, exclusions, tag/notebook names and local calendar dates',() => {
  const note = {title:'Release [Plan]',content:'A detailed phrase with work',tags:['t'],notebookId:'b',updated:new Date('2026-10-21T12:00:00').getTime(),trash:0};
  const context = {tags:{t:'arbeit'},notebooks:{b:'Projekt Alpha'}};
  assert.equal(Search.matches(note,Search.parse('"detailed phrase" [Plan] tag:arbeit notebook:"Projekt Alpha" updated:2026-10-21 before:2026-10-22 -absent'),context),true);
  for (const query of ['-work','tag:privat','after:2026-10-22','updated:invalid','[anything]']) assert.equal(Search.matches(note,Search.parse(query),context),false,query);
  assert.equal(Search.matches({...note,trash:1},Search.parse('work'),context),false);
});
test('Backups are admin-only, downloadable, scheduled and restored as new revisions with a safety snapshot',async t => {
  const {app,request,owner,alice} = await fixture(t);
  assert.equal((await request('/api/backups',null,alice)).status,404);
  assert.equal((await request('/api/backups',{action:'create'},alice)).status,404);
  const save = changes => request('/api/sync',{profile:'notes-db',crypto,changes},owner);
  const initial = await save([change('n','Before backup')]);
  const created = await request('/api/backups',{action:'create'},owner); assert.equal(created.status,201);
  const id = created.data.id;
  const legacyId = 'laverna-2026-10-20T10-00-00.000Z.sqlite';
  await app.store.backup(join(app.store.directory,'backups',legacyId));
  assert.ok((await app.backups.list()).files.some(file => file.id === legacyId));
  const download = await request('/api/backups/download?id=' + encodeURIComponent(id),null,owner);
  assert.equal(download.status,200); assert.equal(download.data.subarray(0,15).toString(),'SQLite format 3');
  assert.equal((await request('/api/backups/download?id=..%2Flaverna.sqlite',null,owner)).status,400);
  assert.equal((await request('/api/backups',{action:'schedule',intervalHours:24},owner)).status,200);
  assert.equal((await request('/api/backups',{action:'schedule',intervalHours:1},owner)).status,400);
  await save([change('n','After backup',initial.data.results[0].rev),change('extra','Created later')]);
  const restore = extra => request('/api/backups',{action:'restore',id,password,confirmation:'WIEDERHERSTELLEN',...extra},owner);
  assert.equal((await restore({password:'wrong-password'})).status,403);
  assert.equal((await restore({confirmation:''})).status,400);
  const latest = app.store.snapshot(owner.user.id,'notes-db').records.find(row => row.id === 'n').rev;
  const restored = await restore({}); assert.equal(restored.status,200); assert.match(restored.data.safetyBackup,/before-restore/);
  const rows = app.store.snapshot(owner.user.id,'notes-db').records;
  assert.equal(rows.find(row => row.id === 'n').data.title,'Before backup');
  assert.ok(rows.find(row => row.id === 'n').rev > latest);
  assert.equal(rows.find(row => row.id === 'extra').data.trash,2);
  assert.equal(app.store.users().length,2);
  assert.equal((await request('/api/me',null,owner)).status,200);
  await app.backups.tick(Date.now() + 25 * 3600000);
  const list = await app.backups.list(); assert.ok(list.files.some(file => file.id.includes('automatic')));
});
test('Corrupt backups and incompatible encryption settings leave current data untouched',async t => {
  const {app,request,owner,directory} = await fixture(t);
  await request('/api/sync',{profile:'notes-db',crypto,changes:[change('n','Current')]},owner);
  const {id} = await app.backups.create();
  await writeFile(join(directory,'data','backups',id),'not a SQLite database');
  await assert.rejects(app.backups.restore(id),error => error.status === 400);
  assert.equal(app.store.snapshot(owner.user.id,'notes-db').records[0].data.title,'Current');
  const good = await app.backups.create();
  app.store.db.prepare('UPDATE profiles SET crypto=? WHERE user_id=?').run(JSON.stringify({encrypt:'1'}),owner.user.id);
  await assert.rejects(app.backups.restore(good.id),error => error.status === 409);
  assert.equal(app.store.snapshot(owner.user.id,'notes-db').records[0].data.title,'Current');
});
test('Conflict copies retain their original note association',async t => {
  const {app,request,owner} = await fixture(t);
  const save = changes => request('/api/sync',{profile:'notes-db',crypto,changes},owner);
  const first = await save([change('n','Initial')]);
  await save([change('n','Current',first.data.results[0].rev)]);
  const result = await save([change('n','Other device',first.data.results[0].rev)]);
  const copy = app.store.snapshot(owner.user.id,'notes-db').records.find(row => row.id === result.data.results[0].conflictId);
  assert.equal(copy.data.conflictOf,'n');
});
