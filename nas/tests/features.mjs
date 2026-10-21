import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { application } from '../server/app.mjs';

const directory = await mkdtemp(join(tmpdir(),'laverna-features-browser-'));
const screenshots = fileURLToPath(new URL('../../.tmp/nas-features-qa/',import.meta.url));
await mkdir(screenshots,{recursive:true});
const app = await application({dataDirectory:directory,webDirectory:fileURLToPath(new URL('../../release/laverna-nas/web',import.meta.url)),secureCookies:false});
const pass = 'feature-browser-password-123';
const owner = await app.store.createUser('owner',pass,true,app.store.setupToken);
await app.store.createUser('bob',pass);
const encryptedUser = await app.store.createUser('charlie',pass);
await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + app.server.address().port;
const port = app.server.address().port;
const browser = await chromium.launch({headless:true,...(process.env.LAVERNA_BROWSER ? {executablePath:process.env.LAVERNA_BROWSER} : {})});
const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
const page = await context.newPage(), errors = [];
page.setDefaultTimeout(20000);
page.on('pageerror',error => errors.push(error.message));
const R = 'backbone.radio';
async function login(username) {
  await page.goto(origin);
  await page.locator('#login-form input[name=username]').fill(username);
  await page.locator('#login-form input[name=password]').fill(pass);
  await page.locator('#login-form button').click();
  await page.locator('#header--add').waitFor();
}
async function create(title,content,extra = {}) {
  return page.evaluate(async ({title,content,extra}) => {
    const radio = requirejs('backbone.radio'), model = await radio.request('notes','get:model',{id:'0'});
    return (await radio.request('notes','save',model,{title,content,tags:[],trash:0,...extra})).id;
  },{title,content,extra});
}
async function serverNote(id,predicate) {
  for (let index = 0; index < 150; index++) {
    const record = app.store.snapshot(owner.id,'notes-db').records.find(row => row.id === id);
    if (record && predicate(record.data)) return record;
    await page.evaluate(() => requirejs('backbone.radio').request('sync','start'));
    await new Promise(resolve => setTimeout(resolve,100));
  }
  throw Error('Note did not reach expected server state: ' + id);
}
async function offlineReady() {
  await page.waitForFunction(() => window.LavernaOffline?.ready || window.LavernaOffline?.error,{},{timeout:90000});
  assert.equal(await page.evaluate(() => window.LavernaOffline.error),undefined);
}
async function noOverflow() {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),'Horizontal overflow');
}
async function screenshot(name) {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.modal.in')).every(element => getComputedStyle(element).opacity === '1'));
  await page.screenshot({path:join(screenshots,name),animations:'disabled'});
}
async function disconnect() { await context.setOffline(true); await new Promise(resolve => app.server.close(resolve)); }
async function connect() { await new Promise(resolve => app.server.listen(port,'127.0.0.1',resolve)); await context.setOffline(false); }
try {
  await login('owner');
  await page.evaluate(() => window.LavernaAppearance.setDark(true));
  await page.evaluate(async () => {
    const radio = requirejs('backbone.radio');
    await radio.request('configs','save:object',{name:'pagination',value:'5'});
    const notebook = await radio.request('notebooks','get:model',{id:'0'});
    window.featureNotebook = (await radio.request('notebooks','save',notebook,{name:'Projekt Alpha',parentId:'0'})).id;
  });
  const notebookId = await page.evaluate(() => window.featureNotebook);
  const searchable = await create('Delta [Plan]','A detailed phrase for work',{notebookId,tags:['arbeit'],created:1});
  for (let index = 0; index < 12; index++) await create('Filler ' + index,'Other content',{created:Date.now() + index});
  await page.evaluate(() => requirejs('backbone.radio').request('uri','navigate',{filter:'search',query:'"detailed phrase" [Plan] tag:arbeit notebook:"Projekt Alpha" -absent'}));
  await page.locator('.list--item.-note').filter({hasText:'Delta [Plan]'}).waitFor();
  assert.equal(await page.locator('.list--item.-note').count(),1);
  assert.ok(await page.locator('#sidebar--content mark.search-hit').count() > 0);
  await page.locator('.list--item.-note').click();
  await page.locator('#content mark.search-hit').first().waitFor();
  await serverNote(searchable,data => data.title === 'Delta [Plan]');

  const historyId = await create('History note','Version one');
  await serverNote(historyId,data => data.content === 'Version one');
  await page.evaluate(async id => {
    const radio = requirejs('backbone.radio'), model = await radio.request('notes','get:model',{id});
    await radio.request('notes','save',model,{title:'History note',content:'Version two'});
  },historyId);
  await serverNote(historyId,data => data.content === 'Version two');
  await page.goto(origin + '/#/notes/show/' + historyId);
  await page.locator('.note--history').click();
  const versions = page.locator('#note-history-revision');
  await versions.waitFor();
  await versions.selectOption({index:(await versions.locator('option').count()) - 1});
  await page.waitForFunction(() => document.querySelector('[aria-label="Gespeicherte Fassung"]')?.value.includes('Version one'));
  await screenshot('history-dark.png');
  await page.locator('#note-history-restore').click();
  await page.locator('.nas-tools-dialog').waitFor({state:'detached'});
  await serverNote(historyId,data => data.content === 'Version one');
  await page.locator('#content').getByText('Version one',{exact:true}).waitFor();

  const current = app.store.snapshot(owner.id,'notes-db').records.find(row => row.id === historyId);
  const conflict = app.store.save(owner.id,'notes-db',{crypto:{encrypt:'0'},changes:[{collection:'notes',id:historyId,baseRev:0,data:{...current.data,title:'Other device',content:'Alternate content',updated:Date.now()}}]}).results[0].conflictId;
  await page.evaluate(() => requirejs('backbone.radio').request('sync','start'));
  await page.waitForFunction(async id => {
    const notes = await requirejs('backbone.radio').request('notes','fetch',{});
    return Boolean((notes.fullCollection || notes).get(id));
  },conflict);
  await page.locator('.note--conflicts').click();
  await page.setViewportSize({width:390,height:844}); await noOverflow();
  assert.ok(await page.locator('#content .header').evaluate(element => element.getBoundingClientRect().height <= 52),'Mobile note header wraps');
  await screenshot('conflicts-mobile.png');
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('Zusammengeführter Titel',{exact:true}).fill('Resolved note');
  await page.getByLabel('Zusammengeführter Inhalt',{exact:true}).fill('Version one\nAlternate content');
  await screenshot('conflicts-desktop.png');
  await page.locator('#conflict-save-merged').click();
  await page.locator('.nas-tools-dialog').waitFor({state:'detached'});
  await serverNote(historyId,data => data.title === 'Resolved note' && data.content.includes('Alternate content'));
  await serverNote(conflict,data => data.trash === 1);

  await page.goto(origin + '/#/settings/templates');
  await page.locator('#template-name').fill('Custom test');
  await page.locator('#template-title').fill('Template {{date}}');
  await page.locator('#template-content').fill('# Custom {{date}}\n\n- [ ] Review');
  await page.locator('#template-form button[type=submit]').click();
  await page.locator('#template-message').filter({hasText:'gespeichert'}).waitFor();
  await page.reload();
  await page.locator('#template-list').getByText('Custom test',{exact:true}).waitFor();
  await page.goto(origin + '/#/notes');
  await page.locator('#header--add').click();
  await page.locator('.CodeMirror').waitFor();
  await page.locator('#editor--template').selectOption({label:'Custom test'});
  assert.match(await page.locator('#editor--input--title').inputValue(),/^Template \d/);
  await page.waitForFunction(() => document.querySelector('.CodeMirror').CodeMirror.getValue().includes('# Custom'));
  await page.waitForFunction(() => requirejs('backbone.radio').request('notesForm','model').id);
  const templateId = await page.evaluate(() => requirejs('backbone.radio').request('notesForm','model').id);
  await serverNote(templateId,data => data.content.includes('# Custom'));
  await offlineReady();
  assert.ok(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));
  await disconnect();
  await page.locator('.CodeMirror').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nOffline addition');
  await page.waitForFunction(() => window.LavernaSyncStatus?.state === 'offline');
  await page.locator('.nas-editor-status').filter({hasText:'Lokal gespeichert'}).waitFor();
  await screenshot('editor-offline.png');
  await page.goto(origin + '/#/notes/show/' + templateId);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('Offline addition',{exact:false}).last().waitFor();
  assert.equal(await page.evaluate(() => window.LAVERNA_NAS.offline),true);
  const privateIdentity = await page.evaluate(async () => {
    const response = await (await caches.open('laverna-offline-session')).match('/__offline_identity__'); return response.json();
  });
  assert.equal(privateIdentity.csrf,'');
  await connect();
  await serverNote(templateId,data => data.content.includes('Offline addition'));

  await page.goto(origin + '/account'); await page.locator('#account-logout').click();
  await page.locator('#login-form').waitFor();
  assert.equal(await page.evaluate(() => caches.has('laverna-offline-session')),false);
  await page.locator('#login-form input[name=username]').fill('bob');
  await page.locator('#login-form input[name=password]').fill(pass);
  await page.locator('#login-form button').click(); await page.locator('#header--add').waitFor();
  await offlineReady(); await disconnect(); await page.reload(); await page.locator('#header--add').waitFor();
  assert.equal(await page.evaluate(() => window.LAVERNA_NAS.user.username),'bob');
  assert.equal(await page.locator('.list--item.-note').count(),0);
  await connect(); await page.goto(origin + '/account'); await page.locator('#account-logout').click(); await page.locator('#login-form').waitFor();
  await login('owner');
  await page.goto(origin + '/#/settings/backups');
  await page.locator('#backup-create').click();
  await page.locator('#backup-message').filter({hasText:'erfolgreich erstellt'}).waitFor();
  const download = page.waitForEvent('download');
  await page.locator('#backup-list').getByRole('button',{name:'Herunterladen'}).first().click();
  assert.match((await download).suggestedFilename(),/\.sqlite$/);
  await page.locator('#backup-interval').selectOption('24');
  await page.locator('#backup-schedule-form button').click();
  await page.locator('#backup-message').filter({hasText:'Intervall gespeichert'}).waitFor();
  await page.locator('#backup-list').getByRole('button',{name:'Wiederherstellen',exact:true}).first().click();
  await page.locator('#backup-password').fill(pass); await page.locator('#backup-confirmation').fill('WIEDERHERSTELLEN');
  await page.locator('#backup-restore-form button[type=submit]').click();
  await page.locator('#backup-message').filter({hasText:'Datensätze wiederhergestellt'}).waitFor();
  await screenshot('backups-desktop.png');
  await page.setViewportSize({width:390,height:844}); await noOverflow();
  assert.ok(await page.locator('#content .header').evaluate(element => element.getBoundingClientRect().height <= 52),'Mobile backup header wraps');
  await screenshot('backups-mobile.png');
  // History must decrypt in the browser and restore through the encryption path.
  const encryptedContext = await browser.newContext(), encryptedPage = await encryptedContext.newPage();
  encryptedPage.on('pageerror',error => errors.push(error.message));
  await encryptedPage.goto(origin);
  await encryptedPage.locator('#login-form input[name=username]').fill('charlie');
  await encryptedPage.locator('#login-form input[name=password]').fill(pass);
  await encryptedPage.locator('#login-form button').click(); await encryptedPage.locator('#header--add').waitFor();
  const encryptedId = await encryptedPage.evaluate(async () => {
    const radio = requirejs('backbone.radio');
    for (const [name,value] of Object.entries({encrypt:'1',encryptPass:'history-encryption-password',encryptSalt:[123,234,345,456],encryptIter:'10000',encryptTag:'128',encryptKeySize:'256'})) await radio.request('configs','save:object',{name,value});
    radio.request('encrypt','change:configs'); await radio.request('encrypt','save:secureKey','history-encryption-password');
    const model = await radio.request('notes','get:model',{id:'0'});
    return (await radio.request('notes','save',model,{title:'Secret history',content:'Secret version one',tags:[],trash:0})).id;
  });
  async function encryptedRevisions(count) {
    for (let index = 0; index < 200; index++) {
      if (app.store.history(encryptedUser.id,'notes-db','notes',encryptedId).length >= count) return;
      await new Promise(resolve => setTimeout(resolve,100));
    }
    throw Error('Encrypted history did not synchronize');
  }
  await encryptedRevisions(1);
  await encryptedPage.evaluate(async id => {
    const radio = requirejs('backbone.radio'), model = await radio.request('notes','get:model',{id});
    await radio.request('notes','save',model,{title:'Secret history',content:'Secret version two'});
  },encryptedId);
  await encryptedRevisions(2);
  await encryptedPage.goto(origin + '/#/notes/show/' + encryptedId);
  await encryptedPage.locator('.note--history').click();
  await encryptedPage.locator('#note-history-revision').selectOption({index:1});
  await encryptedPage.waitForFunction(() => document.querySelector('[aria-label="Gespeicherte Fassung"]')?.value.includes('Secret version one'));
  await encryptedPage.locator('#note-history-restore').click();
  await encryptedPage.locator('.nas-tools-dialog').waitFor({state:'detached'});
  await encryptedPage.locator('#content').getByText('Secret version one',{exact:true}).waitFor();
  await encryptedRevisions(3);
  const encoded = JSON.stringify(app.store.snapshot(encryptedUser.id,'notes-db'));
  assert.ok(!encoded.includes('Secret history') && !encoded.includes('Secret version'));
  await encryptedContext.close();
  assert.deepEqual(errors,[]);
  console.log('Feature browser tests passed: filtered search across pages, highlighting, history restore, conflict merge, persistent custom templates, editor status, offline restart/edit/reconnect, account isolation, backup download/schedule/restore, encrypted history restore, mobile layouts.');
} catch (error) {
  await page.screenshot({path:join(screenshots,'failure.png')}).catch(() => {});
  console.error('Page:',page.url()); throw error;
} finally {
  await browser.close(); await app.close();
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep) && basename(directory).startsWith('laverna-features-browser-'));
  await rm(directory,{recursive:true,force:true});
}
