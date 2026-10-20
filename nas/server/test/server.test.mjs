import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { application } from '../app.mjs';
import { Store } from '../store.mjs';

const pass = 'a-long-test-password-123';
const crypto = {encrypt:'0'};
const change = (id, title, baseRev = 0, extra = {}) => ({collection:'notes',id,baseRev,data:{type:'notes',id,title,content:'text',updated:Date.now(),trash:0,...extra}});
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'laverna-server-test-'));
  const web = join(dir,'web'); await mkdir(web); await writeFile(join(web,'ready.json'),JSON.stringify({ok:true,application:'Laverna'})); await writeFile(join(web,'index.html'),'<html><head></head><body>Notes</body></html>');
  const app = await application({dataDirectory:join(dir,'data'),webDirectory:web,secureCookies:false,revision:'a'.repeat(40)});
  await new Promise(r => app.server.listen(0,'127.0.0.1',r));
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {await app.close(); await rm(dir,{recursive:true,force:true});});
  async function request(path, body, session, more = {}) {
    const headers = {Origin:origin,'X-Laverna-Request':'1',...more};
    if(body)headers['Content-Type']='application/json';
    if(session)Object.assign(headers,{Cookie:session.cookie,'X-Laverna-User':session.user.id,'X-CSRF-Token':session.csrf});
    const response = await fetch(origin+path,{method:body?'POST':'GET',headers,body:body&&JSON.stringify(body),redirect:'manual'});
    const text=await response.text(); let data;try{data=JSON.parse(text);}catch{data=text;}
    return {status:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
  }
  const setupToken = (await readFile(join(dir,'data/setup-token'),'utf8')).trim();
  const setup = await request('/api/setup',{username:'owner',password:pass,setupToken});assert.equal(setup.status,200);
  const owner = {...setup.data,cookie:setup.cookie};
  return {app,dir,request,owner,origin};
}
test('Setup key is one-time; sessions protect the app and cookies are HttpOnly',async t=>{
  const {request,owner,app}=await fixture(t);
  assert.equal((await request('/')).status,302);
  assert.equal((await request('/',null,owner)).status,200);
  assert.equal((await request('/nas-session.js',null,owner)).data.includes(owner.user.id),true);
  assert.equal((await request('/api/sync')).status,401);
  assert.equal((await request('/api/setup',{username:'thief',password:pass,setupToken:'wrong'})).status,403);
  assert.equal(app.store.users().length,1);
  const login=await request('/api/login',{username:'OWNER',password:pass});
  assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await request('/api/login',{username:'owner',password:'wrong'})).status,401);
});
test('Users cannot read, modify, enumerate or receive another account’s records/history',async t=>{
  const {request,owner}=await fixture(t);
  const created=await request('/api/users',{action:'create',username:'alice',password:pass},owner);assert.equal(created.status,201);
  const login=await request('/api/login',{username:'alice',password:pass});const alice={...login.data,cookie:login.cookie};
  const saved=await request('/api/sync',{profile:'notes-db',crypto,changes:[change('secret','Private')]},owner);assert.equal(saved.status,200);
  assert.equal((await request('/api/sync?profile=notes-db',null,alice)).data.records.length,0);
  assert.equal((await request('/api/history?id=secret&collection=notes',null,alice)).data.revisions.length,0);
  assert.equal((await request('/api/users',null,alice)).status,404);
  const forged={...alice,user:owner.user};assert.equal((await request('/api/sync',null,forged)).status,409);
  assert.equal((await request('/api/sync',{profile:'notes-db',crypto,changes:[change('secret','Alice')]},alice)).status,200);
  assert.equal((await request('/api/sync',null,owner)).data.records[0].data.title,'Private');
});

test('Account entry opens native settings while session switching remains available before unlocking notes',async t=>{
  const {request,owner}=await fixture(t);
  const login=await request('/account');
  assert.equal(login.status,200);
  assert.match(login.data,/\/styles\/core\.css/);
  assert.match(login.data,/\/styles\/theme-default\.css/);
  const account=await request('/account',null,owner);
  assert.equal(account.status,302);
  assert.equal(account.headers.get('location'),'/#/settings/account');
  const session=await request('/account?session',null,owner);
  assert.equal(session.status,200);
  assert.match(session.data,/id="logout"/);
  assert.match(session.headers.get('content-security-policy'),/font-src 'self' data:/);
});
test('Cross-site requests, missing CSRF and a changed browser account fail closed',async t=>{
  const {request,owner}=await fixture(t);
  const body={profile:'notes-db',crypto,changes:[change('n','Title')]};
  assert.equal((await request('/api/sync',body,owner,{Origin:'https://other.example'})).status,403);
  assert.equal((await request('/api/sync',body,{...owner,csrf:'bad'})).status,403);
  assert.equal((await request('/api/sync',body,{...owner,user:{id:'old-account'}})).status,409);
});
test('Concurrent offline edits and stale deletions preserve newer data and revision history',async t=>{
  const {request,owner}=await fixture(t);
  const save=changes=>request('/api/sync',{profile:'notes-db',crypto,changes},owner);
  const a=await save([change('n','First')]);const rev=a.data.results[0].rev;
  const b=await save([change('n','Second',rev)]);const latest=b.data.results[0].rev;
  const conflict=await save([change('n','Offline',rev)]);assert.equal(conflict.data.results[0].conflict,true);
  const records=(await request('/api/sync',null,owner)).data.records;
  assert.equal(records.length,2);assert.equal(records.find(r=>r.id==='n').data.title,'Second');assert.ok(records.some(r=>r.data.title==='Offline (Konfliktkopie)'));
  await save([change('n','',rev,{trash:2})]);
  assert.equal((await request('/api/sync',null,owner)).data.records.find(r=>r.id==='n').rev,latest);
  assert.equal((await request('/api/history?id=n&collection=notes',null,owner)).data.revisions.length,3);
  const deleted=await save([change('n','',latest,{trash:2})]);assert.equal(deleted.status,200);
  assert.equal((await request('/api/sync',null,owner)).data.records.find(r=>r.id==='n').data.trash,2);
});
test('Encrypted payloads never persist decrypted fields; metadata mismatch and plaintext are rejected',async t=>{
  const {request,owner,app}=await fixture(t);
  const encrypted={encrypt:'1',encryptSalt:[1,2,3],encryptIter:'10000',encryptTag:'128',encryptKeySize:'256'};
  const body={profile:'encrypted',crypto:encrypted,changes:[change('n','PLAINTEXT',0,{encryptedData:'opaque-ciphertext'})]};
  assert.equal((await request('/api/sync',body,owner)).status,200);
  const raw=app.store.snapshot(owner.user.id,'encrypted').records[0].data;
  assert.equal(raw.title,undefined);assert.equal(raw.content,undefined);assert.equal(raw.encryptedData,'opaque-ciphertext');
  assert.equal((await request('/api/sync',{...body,changes:[change('other','plaintext')]},owner)).status,409);
  assert.equal((await request('/api/sync',{...body,crypto,changes:[]},owner)).status,409);
  assert.equal((await request('/api/sync',{profile:'bad',crypto:{encrypt:1},changes:[]},owner)).status,400);
  const attachment={collection:'files',id:'attachment',baseRev:0,data:{type:'files',id:'attachment',updated:Date.now(),trash:0,src:'PRIVATE FILE',fileType:'text/plain',name:'SECRET',encryptedData:'encrypted-file'}};
  assert.equal((await request('/api/sync',{...body,changes:[attachment]},owner)).status,200);
  const file=app.store.snapshot(owner.user.id,'encrypted').records.find(r=>r.id==='attachment').data;
  assert.equal(file.src,undefined);assert.equal(file.name,undefined);assert.equal(file.fileType,undefined);
});
test('A batch is atomic; account disable/reset revoke existing sessions',async t=>{
  const {request,owner}=await fixture(t);
  const body={profile:'notes-db',crypto,changes:[change('n','First'),{...change('bad','Bad'),collection:'configs'}]};
  assert.equal((await request('/api/sync',body,owner)).status,400);
  assert.equal((await request('/api/sync',null,owner)).data.records.length,0);
  const created=await request('/api/users',{action:'create',username:'alice',password:pass},owner);
  const login=await request('/api/login',{username:'alice',password:pass});const alice={...login.data,cookie:login.cookie};
  await request('/api/users',{action:'disable',id:created.data.user.id,disabled:true},owner);
  assert.equal((await request('/api/me',null,alice)).status,401);
  assert.equal((await request('/api/login',{username:'alice',password:pass})).status,401);
  assert.equal((await request('/api/users',{action:'disable',id:owner.user.id,disabled:true},owner)).status,400);
});
test('Maintenance freezes writes, SQLite backup is consistent and persists across reopen',async t=>{
  const {request,owner,app,dir}=await fixture(t);
  await request('/api/sync',{profile:'notes-db',crypto,changes:[change('n','Keep me')]},owner);
  assert.equal((await request('/internal/maintenance?action=enter',{})).status,200);
  assert.equal((await request('/api/sync',{profile:'notes-db',crypto,changes:[change('x','blocked')]},owner)).status,503);
  const backup=join(dir,'backup.sqlite');await app.store.backup(backup);
  const reopened=new Store(backup);assert.equal(reopened.snapshot(owner.user.id,'notes-db').records[0].data.title,'Keep me');reopened.close();
  await request('/internal/maintenance?action=exit',{});
  assert.equal((await request('/api/sync',{profile:'notes-db',crypto,changes:[]},owner)).status,200);
});
