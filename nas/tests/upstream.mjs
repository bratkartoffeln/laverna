import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { application } from '../server/app.mjs';

const directory = await mkdtemp(join(tmpdir(), 'laverna-upstream-browser-'));
const app = await application({dataDirectory:directory,webDirectory:fileURLToPath(new URL('../../release/laverna-nas/web', import.meta.url)),secureCookies:false});
await app.store.createUser('owner', 'upstream-browser-password-123', true, app.store.setupToken);
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + app.server.address().port;
let browser;
try {
  browser = await chromium.launch({headless:true,...(process.env.LAVERNA_BROWSER ? {executablePath:process.env.LAVERNA_BROWSER} : {})});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Exercise the bundled SDK and adapter without a Dropbox account or network requests.
  await page.route('https://**.dropboxapi.com/**', route => {
    errors.push('Unexpected Dropbox request: ' + new URL(route.request().url()).pathname);
    return route.abort();
  });
  await page.goto(origin);
  await page.locator('#login-form input[name=username]').fill('owner');
  await page.locator('#login-form input[name=password]').fill('upstream-browser-password-123');
  await page.locator('#login-form button').click();
  await page.locator('#header--add').waitFor();

  for (const locale of ['ja', 'gl']) {
    const response = await page.request.get(origin + '/locales/' + locale + '/translation.json');
    assert.equal(response.status(), 200);
    assert.ok(Object.keys(await response.json()).length > 0);
  }

  const result = await page.evaluate(async () => {
    const load = name => new Promise((resolve, reject) => requirejs([name], resolve, reject));
    const [Dropbox, Sync, Adapter] = await Promise.all([
      load('dropbox'), load('modules/dropbox/classes/sync'), load('modules/dropbox/classes/adapter')
    ]);
    const Radio = requirejs('backbone.radio');
    const record = {id:'upstream-note',updated:123,title:'Private title',content:'Private content',encryptedData:'ciphertext'};
    let upload;
    const adapter = Object.create(Adapter);
    adapter.init({
      filesUpload: async options => { upload = options; return {name:'upstream-note.json'}; },
      filesListFolder: async () => ({entries:[{name:'upstream-note.json',path_lower:'/notes-db/notes/upstream-note.json'}]}),
      filesDownload: async () => ({fileBlob:new Blob([JSON.stringify(record)])})
    }, 'notes-db');
    await adapter.save('notes', record, ['title', 'content']);
    const records = await adapter.getAll('notes');
    adapter.client.filesListFolder = async () => { throw {status:409}; };
    const missingFolder = await adapter.getAll('notebooks');

    const sync = Object.create(Sync.prototype);
    sync.configs = {accessToken:''};
    sync.client = new Dropbox({clientId:'local-upstream-test'});
    await sync.saveAccessToken('upstream-test-access-token');
    const token = sync.client.getAccessToken();
    const configuredToken = sync.configs.accessToken;
    const savedToken = Radio.request('configs', 'get:config', 'dropboxAccessToken');
    const cached = Object.create(Sync.prototype);
    cached.configs = {accessToken:savedToken};
    cached.client = new Dropbox({clientId:'local-upstream-test'});
    const authenticated = await cached.checkAuth();
    return {upload,records,missingFolder,token,configuredToken,savedToken,authenticated,cachedToken:cached.client.getAccessToken()};
  });
  assert.equal(result.upload.path, '/notes-db/notes/upstream-note.json');
  assert.equal(result.upload.mode['.tag'], 'overwrite');
  const uploaded = JSON.parse(result.upload.contents);
  assert.equal(uploaded.encryptedData, 'ciphertext');
  assert.equal(uploaded.title, undefined);
  assert.equal(uploaded.content, undefined);
  assert.equal(result.records[0].id, 'upstream-note');
  assert.deepEqual(result.missingFolder, []);
  for (const key of ['token', 'configuredToken', 'savedToken', 'cachedToken']) assert.equal(result[key], 'upstream-test-access-token', key);
  assert.equal(result.authenticated, true);
  assert.deepEqual(errors, []);
  console.log('Upstream browser tests passed: new locales, bundled Dropbox v2 SDK, encrypted upload, download, missing folders, OAuth callback and saved authentication.');
} finally {
  await browser?.close();
  await app.close();
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep) || !basename(directory).startsWith('laverna-upstream-browser-')) throw Error('Unexpected temporary data path');
  await rm(directory, {recursive:true,force:true});
}
