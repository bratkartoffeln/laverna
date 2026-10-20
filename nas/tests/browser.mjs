import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { application } from '../server/app.mjs';

const directory = await mkdtemp(join(tmpdir(),'laverna-browser-'));
const app = await application({dataDirectory:directory,webDirectory:fileURLToPath(new URL('../../release/laverna-nas/web', import.meta.url)),secureCookies:false});
await app.store.createUser('alice','test-browser-password-123',true,app.store.setupToken);
await app.store.createUser('bob','other-browser-password-123');
await app.store.createUser('charlie','encrypted-account-password-123');
await new Promise(r => app.server.listen(0,'127.0.0.1',r));
const origin = 'http://127.0.0.1:' + app.server.address().port;
const browser = await chromium.launch({headless:true,...(process.env.LAVERNA_BROWSER ? {executablePath:process.env.LAVERNA_BROWSER} : {})});
const errors=[];
async function device(username='alice',password='test-browser-password-123') {
  const context = await browser.newContext(); const page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.locator('#login-form input[name=username]').fill(username);await page.locator('#login-form input[name=password]').fill(password);await page.locator('#login-form button').click();
  await page.waitForSelector('#header--add');
  await page.waitForFunction(()=>window.requirejs&&requirejs.defined('modules/nas/sync'));
  return {context,page};
}
async function create(page,title,content='Test text') {
  return page.evaluate(async({title,content})=>{
    const Radio=window.requirejs('backbone.radio');
    const model=await Radio.request('notes','get:model',{id:'0',profile:'notes-db'});
    const saved=await Radio.request('notes','save',model,{title,content,tags:[],trash:0});
    return saved.id;
  },{title,content});
}
async function local(page,id) {
  return page.evaluate(async id=>{
    const data=await requirejs('backbone.radio').request('notes','fetch',{encrypt:true,profile:'notes-db'});
    return (data.fullCollection||data).get(id)?.toJSON()||null;
  },id);
}
async function waitNote(page,id,title) {
  for(let i=0;i<100;i++){if((await local(page,id))?.title===title)return;await page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));await new Promise(r=>setTimeout(r,150));}
  throw Error('Note did not synchronize: '+title);
}
try {
  const one=await device(),two=await device(),bob=await device('bob','other-browser-password-123');
  await one.page.locator('#header--add').click();await one.page.locator('#editor--input--title').fill('Two devices');await one.page.locator('.CodeMirror').click();await one.page.keyboard.insertText('Created in the editor');await one.page.locator('.editor--save').click();await one.page.getByText('Two devices',{exact:true}).first().waitFor();
  const id=await one.page.evaluate(async()=>{const c=await requirejs('backbone.radio').request('notes','fetch',{encrypt:true});return (c.fullCollection||c).findWhere({title:'Two devices'}).id;});
  await waitNote(two.page,id,'Two devices');
  await two.page.getByText('Two devices',{exact:true}).first().waitFor({timeout:5000});
  assert.equal(await local(bob.page,id),null);
  const fileId=await one.page.evaluate(async id=>{const R=requirejs('backbone.radio'),f=await R.request('files','get:model',{id:'0'});const saved=await R.request('files','save',f,{name:'test.txt',fileType:'text/plain',src:'data:text/plain;base64,SGVsbG8gTkFT'});const note=await R.request('notes','get:model',{id});await R.request('notes','save',note,{title:'Two devices',content:'Attachment',files:[saved.id],tags:[]});return saved.id;},id);
  for(let i=0;i<100;i++){const value=await two.page.evaluate(async id=>{const c=await requirejs('backbone.radio').request('files','fetch',{encrypt:true});const f=c.get(id);return f?.get('src') instanceof Blob ? await f.get('src').text() : null;},fileId);if(value==='Hello NAS')break;if(i===99)throw Error('Attachment did not synchronize');await two.page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));await new Promise(r=>setTimeout(r,150));}
  await two.context.setOffline(true);
  await two.page.evaluate(async id=>{const R=requirejs('backbone.radio'),m=await R.request('notes','get:model',{id});await R.request('notes','save',m,{title:'Offline edit',content:'Changed without network',tags:[]});},id);
  await two.context.setOffline(false);await two.page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));await waitNote(one.page,id,'Offline edit');
  // Simultaneous offline edits keep both versions.
  await one.context.setOffline(true);await two.context.setOffline(true);
  for(const [device,title] of [[one,'First concurrent'],[two,'Second concurrent']])await device.page.evaluate(async({id,title})=>{const R=requirejs('backbone.radio'),m=await R.request('notes','get:model',{id});await R.request('notes','save',m,{title,content:title,tags:[]});},{id,title});
  await one.context.setOffline(false);await one.page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));
  for(let i=0;i<60;i++){const rows=app.store.snapshot(app.store.users().find(u=>u.username==='alice').id,'notes-db').records;if(rows.some(r=>r.data.title==='First concurrent'))break;await new Promise(r=>setTimeout(r,100));}
  await two.context.setOffline(false);await two.page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));
  for(let i=0;i<80;i++){const rows=app.store.snapshot(app.store.users().find(u=>u.username==='alice').id,'notes-db').records;if(rows.some(r=>r.data.title==='Second concurrent (Konfliktkopie)'))break;await new Promise(r=>setTimeout(r,100));}
  const rows=app.store.snapshot(app.store.users().find(u=>u.username==='alice').id,'notes-db').records;
  assert.ok(rows.some(r=>r.data.title==='First concurrent'));assert.ok(rows.some(r=>r.data.title==='Second concurrent (Konfliktkopie)'));
  await two.page.reload();await two.page.waitForSelector('#header--add');await waitNote(two.page,id,'First concurrent');
  // Cookie switch in the same browser must select a new IndexedDB namespace.
  await one.page.goto(origin+'/account');await one.page.locator('#account-logout').click();await one.page.waitForSelector('#login-form input[name=username]');
  await one.page.locator('#login-form input[name=username]').fill('bob');await one.page.locator('#login-form input[name=password]').fill('other-browser-password-123');await one.page.locator('#login-form button').click();await one.page.waitForSelector('#header--add');
  await one.page.waitForFunction(()=>window.LAVERNA_NAS?.user.username==='bob');
  assert.equal(await local(one.page,id),null);
  // The optional existing Laverna encryption also protects attachment uploads.
  const encryptedOne=await device('charlie','encrypted-account-password-123'),encryptedTwo=await device('charlie','encrypted-account-password-123');
  for (const device of [encryptedOne,encryptedTwo]) await device.page.evaluate(async()=>{
    const R=requirejs('backbone.radio'),values={encrypt:'1',encryptPass:'separate-encryption-password',encryptSalt:[123,456,789,234,567],encryptIter:'10000',encryptTag:'128',encryptKeySize:'256'};
    for(const [name,value]of Object.entries(values))await R.request('configs','save:object',{name,value});
    R.request('encrypt','change:configs');await R.request('encrypt','save:secureKey','separate-encryption-password');
  });
  const encryptedId=await create(encryptedOne.page,'Encrypted title','Encrypted content');
  const encryptedFileId=await encryptedOne.page.evaluate(async()=>{const R=requirejs('backbone.radio'),f=await R.request('files','get:model',{id:'0'});return(await R.request('files','save',f,{name:'private.txt',fileType:'text/plain',src:'data:text/plain;base64,U2VjcmV0IGZpbGU='})).id;});
  for(let i=0;i<100;i++){
    const value=await encryptedTwo.page.evaluate(async({id,fileId})=>{const R=requirejs('backbone.radio'),n=await R.request('notes','fetch',{encrypt:false}),f=await R.request('files','fetch',{encrypt:true});return {title:(n.fullCollection||n).get(id)?.get('title'),file:f.get(fileId)?.get('src') instanceof Blob?await f.get(fileId).get('src').text():null};},{id:encryptedId,fileId:encryptedFileId});
    if(value.title==='Encrypted title'&&value.file==='Secret file')break;
    if(i===99)throw Error('Encrypted note/attachment did not synchronize');await encryptedTwo.page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));await new Promise(r=>setTimeout(r,150));
  }
  const encryptedRows=JSON.stringify(app.store.snapshot(app.store.users().find(u=>u.username==='charlie').id,'notes-db'));
  for(const plaintext of ['Encrypted title','Encrypted content','private.txt','U2VjcmV0IGZpbGU='])assert.ok(!encryptedRows.includes(plaintext));
  const encryptedUser=app.store.users().find(u=>u.username==='charlie').id;
  const revisionsBefore=app.store.snapshot(encryptedUser,'notes-db').records.map(r=>r.rev);
  for(const device of [encryptedOne,encryptedTwo])await device.page.evaluate(()=>requirejs('backbone.radio').request('sync','start'));
  await new Promise(r=>setTimeout(r,1500));
  assert.deepEqual(app.store.snapshot(encryptedUser,'notes-db').records.map(r=>r.rev),revisionsBefore);
  // NAS account switching must remain accessible while note encryption is locked.
  await encryptedOne.page.evaluate(()=>requirejs('backbone.radio').request('encrypt','delete:secureKey'));
  await encryptedOne.page.reload();
  await encryptedOne.page.locator('.nas-session-link').click();
  await encryptedOne.page.locator('#session:not([hidden])').waitFor();
  await encryptedOne.page.locator('#logout').click();
  await encryptedOne.page.locator('#login-form').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Browser tests passed: login, editor save, two devices, attachments, offline/conflicting edits, reload, account isolation, encrypted notes and attachments.');
} finally {await browser.close();await app.close();await rm(directory,{recursive:true,force:true});}
