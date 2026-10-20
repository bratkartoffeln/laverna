'use strict';
let session;
const el = id => document.getElementById(id);
function message(text, error = false) {
  el('message').textContent = text;
  el('message').classList.toggle('error', error);
}
async function api(path, body) {
  const headers = {'X-Laverna-Request':'1'};
  if (session) { headers['X-Laverna-User'] = session.user.id; headers['X-CSRF-Token'] = session.csrf; }
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch('/api/' + path, {method:body ? 'POST' : 'GET', headers, body:body && JSON.stringify(body)});
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'Verbindung fehlgeschlagen.'); error.status = response.status; throw error; }
  return data;
}
function form(id, handler) {
  el(id).addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    if (button.disabled) return;
    button.disabled = true; message('');
    try { await handler(Object.fromEntries(new FormData(event.target))); event.target.reset(); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
}
form('login-form', async body => { session = await api('login', body); location.assign('/'); });
form('setup-form', async body => { session = await api('setup', body); location.assign('/#/settings/account'); });
el('logout').onclick = async () => {
  const button = el('logout');
  if (button.disabled) return;
  button.disabled = true;
  try {
    await api('logout', {});
    const prefix = 'secureKey.nas-' + session.user.id + '.';
    Object.keys(sessionStorage).filter(key => key.startsWith(prefix)).forEach(key => sessionStorage.removeItem(key));
    location.assign('/account');
  } catch (error) { message(error.message, true); button.disabled = false; }
};
(async () => {
  const status = await api('status');
  if (status.setupRequired) { el('setup').hidden = false; el('setup-token').focus(); return; }
  try { session = await api('me'); }
  catch (error) {
    if (error.status !== 401) throw error;
    el('login').hidden = false;
    if (new URLSearchParams(location.search).has('changed')) message('Passwort geändert. Bitte melde dich erneut an.');
    el('login-username').focus(); return;
  }
  el('session').hidden = false;
  el('identity').textContent = session.user.username;
})().catch(error => message(error.message, true));