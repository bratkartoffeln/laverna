import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { application } from '../server/app.mjs';

const directory = await mkdtemp(join(tmpdir(), 'laverna-account-browser-'));
const screenshots = fileURLToPath(new URL('../../.tmp/nas-account-qa/', import.meta.url));
await mkdir(screenshots, {recursive:true});
const app = await application({dataDirectory:directory,webDirectory:fileURLToPath(new URL('../../release/laverna-nas/web', import.meta.url)),secureCookies:false});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + app.server.address().port;
const browser = await chromium.launch({headless:true,...(process.env.LAVERNA_BROWSER ? {executablePath:process.env.LAVERNA_BROWSER} : {})});
const errors = [];
const password = 'account-browser-password-123';
const resetPassword = 'account-reset-password-456';
const ownPassword = 'account-own-password-789';
async function device() {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  return {context,page};
}
async function login(page, username, pass = password) {
  await page.goto(origin + '/account');
  await page.locator('#login-username').fill(username);
  await page.locator('#login-password').fill(pass);
  await page.locator('#login-form button').click();
  await page.locator('#header--add').waitFor();
}
async function account(page) {
  await page.goto(origin + '/account');
  await page.locator('#account-details:not([hidden])').waitFor();
  assert.equal(new URL(page.url()).hash, '#/settings/account');
}
async function theme(page, expected) {
  await page.waitForFunction(value => document.documentElement.dataset.theme === value, expected);
}
async function screenshot(page, name) { await page.screenshot({path:join(screenshots, name + '.png'),animations:'disabled'}); }
async function readable(page, selector) {
  const contrast = await page.locator(selector).first().evaluate(el => {
    const rgb = value => value.match(/[\d.]+/g).slice(0,3).map(Number);
    const luminance = color => rgb(color).map(n => n/255).map(n => n <= .04045 ? n/12.92 : ((n+.055)/1.055)**2.4).reduce((sum,n,i) => sum+n*[.2126,.7152,.0722][i],0);
    const foreground = luminance(getComputedStyle(el).color);
    let parent = el, background;
    do { background = getComputedStyle(parent).backgroundColor; parent = parent.parentElement; }
    while (background === 'rgba(0, 0, 0, 0)' && parent);
    const back = luminance(background);
    return (Math.max(foreground, back)+.05)/(Math.min(foreground, back)+.05);
  });
  assert.ok(contrast >= 4.5, selector + ': insufficient text contrast (' + contrast.toFixed(2) + ':1)');
}
async function noOverflow(page) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page overflows horizontally');
  assert.ok(await page.locator('#content .layout--body').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Settings overflow horizontally');
}
try {
  const admin = await device();
  await admin.page.goto(origin);
  await admin.page.locator('#setup-form').waitFor();
  assert.equal(await admin.page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(0, 113, 100)');
  await screenshot(admin.page, 'setup-light');
  await admin.page.locator('#setup-token').fill(app.store.setupToken);
  await admin.page.locator('#setup-username').fill('owner');
  await admin.page.locator('#setup-password').fill(password);
  await admin.page.locator('#setup-form button').click();
  await admin.page.locator('#account-create-form').waitFor();
  assert.equal(new URL(admin.page.url()).hash, '#/settings/account');
  assert.equal(await admin.page.locator('#account-identity').textContent(), 'owner');
  assert.equal(await admin.page.locator('form form').count(), 0);
  assert.equal(await admin.page.locator('.settings--save').count(), 0);

  // Existing settings continue to save after the content region gained real account forms.
  await admin.page.locator('.list--settings[href$="settings/general"]').click();
  await admin.page.locator('#pagination').fill('17');
  await admin.page.locator('.settings--save').click();
  await admin.page.locator('#header--add').waitFor();
  await admin.page.goto(origin + '/#/settings/general');
  await admin.page.locator('#pagination').waitFor();
  assert.equal(await admin.page.locator('#pagination').inputValue(), '17');
  await admin.page.evaluate(() => { window.accountNavigationMarker = true; });
  await admin.page.locator('.list--settings[href$="settings/account"]').click();
  await admin.page.locator('#account-create-form').waitFor();
  assert.equal(await admin.page.evaluate(() => window.accountNavigationMarker), true);

  await admin.page.locator('#account-username').fill('alice');
  await admin.page.locator('#account-start-password').fill(password);
  await admin.page.locator('#account-create-form button').click();
  await admin.page.locator('#account-message').filter({hasText:'Benutzer angelegt'}).waitFor();
  const aliceId = app.store.users().find(user => user.username === 'alice').id;
  const row = admin.page.locator('[data-user-id="' + aliceId + '"]');
  await row.waitFor();
  await admin.page.locator('#account-username').fill('alice');
  await admin.page.locator('#account-start-password').fill(password);
  await admin.page.locator('#account-create-form button').click();
  await admin.page.locator('#account-message.alert-danger').filter({hasText:'bereits vergeben'}).waitFor();
  assert.equal(await admin.page.locator('#account-username').inputValue(), 'alice');
  assert.equal(app.store.users().length, 2);
  await admin.page.locator('#account-create-form').evaluate(form => form.reset());

  const alice = await device();
  await login(alice.page, 'alice');
  await alice.page.locator('#header--add').click();
  await alice.page.locator('#editor--input--title').fill('Private notes survive account changes');
  await alice.page.locator('.CodeMirror').click();
  await alice.page.keyboard.insertText('Only Alice can see this note.');
  await alice.page.locator('.editor--save').click();
  await alice.page.getByText('Private notes survive account changes', {exact:true}).first().waitFor();
  await account(alice.page);
  assert.equal(await alice.page.locator('#account-admin').isVisible(), false);
  const unauthorized = await alice.page.evaluate(async () => (await fetch('/api/users', {headers:{'X-Laverna-User':window.LAVERNA_NAS.user.id}})).status);
  assert.equal(unauthorized, 404);

  // Disabling and resetting passwords revoke existing browser sessions, preserving notes.
  await row.locator('[data-account-action="toggle"]').click();
  await row.locator('.nas-account-user-meta').filter({hasText:'Gesperrt'}).waitFor();
  assert.equal(await alice.page.evaluate(async () => (await fetch('/api/me')).status), 401);
  await row.locator('[data-account-action="toggle"]').click();
  await row.locator('.nas-account-user-meta').filter({hasText:'Aktiv'}).waitFor();
  await login(alice.page, 'alice');
  await alice.page.getByText('Private notes survive account changes', {exact:true}).first().waitFor();
  await row.locator('[data-account-action="reset"]').click();
  await row.locator('input[name=password]').fill(resetPassword);
  await row.locator('button[type=submit]').click();
  await admin.page.locator('#account-message').filter({hasText:'Passwort zurückgesetzt'}).waitFor();
  assert.equal(await alice.page.evaluate(async () => (await fetch('/api/me')).status), 401);
  await alice.page.goto(origin + '/account');
  await alice.page.locator('#login-username').fill('alice');
  await alice.page.locator('#login-password').fill(password);
  await alice.page.locator('#login-form button').click();
  await alice.page.locator('#message.error').filter({hasText:'falsch'}).waitFor();
  await alice.page.locator('#login-password').fill(resetPassword);
  await alice.page.locator('#login-form button').click();
  await alice.page.locator('#header--add').waitFor();
  await account(alice.page);
  await alice.page.locator('#account-current-password').fill('wrong-password');
  await alice.page.locator('#account-new-password').fill(ownPassword);
  await alice.page.locator('#account-password-form button').click();
  await alice.page.locator('#account-message.alert-danger').filter({hasText:'Bisheriges Passwort falsch'}).waitFor();
  await alice.page.locator('#account-current-password').fill(resetPassword);
  await alice.page.locator('#account-password-form button').click();
  await alice.page.locator('#login-form').waitFor();
  assert.match(await alice.page.locator('#message').textContent(), /Passwort geändert/);
  await login(alice.page, 'alice', ownPassword);
  await alice.page.getByText('Private notes survive account changes', {exact:true}).first().waitFor();

  // Appearance settings apply immediately, survive reload/logout and synchronize browser tabs.
  await admin.page.locator('.list--settings[href$="settings/appearance"]').click();
  await admin.page.locator('#appearance-dark-mode').check();
  await theme(admin.page, 'dark');
  const secondTab = await admin.context.newPage();
  await secondTab.goto(origin + '/#/settings/appearance');
  await secondTab.locator('#appearance-dark-mode:checked').waitFor();
  await secondTab.locator('#appearance-dark-mode').uncheck();
  await theme(admin.page, 'light');
  assert.equal(await admin.page.locator('#appearance-dark-mode').isChecked(), false);
  await secondTab.close();
  await admin.page.locator('#appearance-dark-mode').check();
  await admin.page.reload();
  await admin.page.locator('#appearance-dark-mode:checked').waitFor();
  await admin.page.locator('.list--settings[href$="settings/account"]').click();
  await admin.page.locator('#account-create-form').waitFor();
  await noOverflow(admin.page);
  await screenshot(admin.page, 'account-dark-desktop');
  await admin.page.setViewportSize({width:390,height:844});
  await noOverflow(admin.page);
  assert.ok(await admin.page.locator('#content .header').evaluate(el => el.getBoundingClientRect().height <= 52), 'Mobile account header wraps');
  await screenshot(admin.page, 'account-dark-mobile');
  await admin.page.locator('#show--sidebar').click();
  await admin.page.locator('.list--settings[href$="settings/appearance"]').click();
  await admin.page.locator('#appearance-dark-mode').uncheck();
  await theme(admin.page, 'light');
  await screenshot(admin.page, 'appearance-light-mobile');
  await admin.page.setViewportSize({width:1440,height:1000});
  await admin.page.locator('.list--settings[href$="settings/account"]').click();
  await admin.page.locator('#account-create-form').waitFor();
  await screenshot(admin.page, 'account-light-desktop');
  await admin.page.locator('button.settings--cancel').click();
  await admin.page.locator('#header--add').waitFor();
  await admin.page.locator('.sidemenu--open').click();
  await admin.page.locator('#header--dark-mode').click();
  await theme(admin.page, 'dark');
  assert.equal(await admin.page.locator('#header--dark-mode').getAttribute('aria-pressed'), 'true');
  assert.equal(await admin.page.locator('.sidemenu').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(29, 40, 43)');
  await screenshot(admin.page, 'menu-dark-desktop');
  await admin.page.locator('.sidemenu--close').click();
  await admin.page.locator('#header--add').click();
  await admin.page.locator('#editor--input--title').fill('Dark editor');
  await admin.page.locator('.CodeMirror').click();
  await admin.page.keyboard.insertText('# Heading\n\nA [link](https://example.com).\n\n```js\nconst value = "readable";\n```');
  assert.equal(await admin.page.locator('.CodeMirror').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(20, 27, 29)');
  await screenshot(admin.page, 'editor-dark-desktop');
  await admin.page.locator('.editor--save').click();
  await admin.page.getByText('Dark editor', {exact:true}).first().waitFor();
  await readable(admin.page, '.list-group-item-heading');
  await admin.page.locator('.list--item.-note').filter({hasText:'Dark editor'}).click();
  await admin.page.locator('#content pre code').waitFor();
  await readable(admin.page, '#content pre code');
  await readable(admin.page, '.note--date');
  await screenshot(admin.page, 'note-dark-desktop');
  await admin.page.evaluate(() => requirejs('backbone.radio').request('Confirm','start',{title:'Dark dialog',content:'Readable confirmation'}));
  await admin.page.locator('.modal-content').waitFor();
  await readable(admin.page, '.modal-content');
  await screenshot(admin.page, 'dialog-dark-desktop');
  await admin.page.locator('.modal-content [data-event="cancel"]').click();
  await account(admin.page);
  await admin.page.evaluate(() => {
    sessionStorage.setItem('secureKey.nas-' + window.LAVERNA_NAS.user.id + '.notes-db', 'test-key');
    sessionStorage.setItem('other-key', 'keep');
  });
  await admin.page.locator('#account-logout').click();
  await admin.page.locator('#login-form').waitFor();
  await theme(admin.page, 'dark');
  assert.equal(await admin.page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('secureKey.nas-'))), false);
  assert.equal(await admin.page.evaluate(() => sessionStorage.getItem('other-key')), 'keep');
  await screenshot(admin.page, 'login-dark-desktop');
  await admin.page.setViewportSize({width:390,height:844});
  await screenshot(admin.page, 'login-dark-mobile');
  await login(admin.page, 'owner');
  await admin.page.goto(origin + '/account?session');
  await admin.page.locator('#session:not([hidden])').waitFor();
  assert.equal(await admin.page.locator('#identity').textContent(), 'owner');
  await admin.page.locator('#logout').click();
  await admin.page.locator('#login-form').waitFor();
  assert.deepEqual(errors, []);
  console.log('Account/appearance browser tests passed: setup, native settings/navigation, saved general settings, create/duplicate/disable/enable/reset, user permissions, password change, logout, light/dark settings and menu, reload, cross-tab updates, desktop/mobile layouts.');
} catch (error) {
  for (const [index, page] of browser.contexts().flatMap(context => context.pages()).entries()) {
    await screenshot(page, 'failure-' + index).catch(() => {});
  }
  throw error;
} finally {
  await browser.close(); await app.close(); await rm(directory, {recursive:true,force:true});
}
