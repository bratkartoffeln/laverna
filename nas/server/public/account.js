'use strict';
let session;
const el = id => document.getElementById(id);
function message(text, error = false) { el('message').textContent = text; el('message').classList.toggle('error', error); }
async function api(path, body) {
  const headers = {'X-Laverna-Request':'1'};
  if (session) { headers['X-Laverna-User'] = session.user.id; headers['X-CSRF-Token'] = session.csrf; }
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch('/api/' + path, {method:body ? 'POST' : 'GET', headers, body:body && JSON.stringify(body)});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Verbindung fehlgeschlagen.');
  return data;
}
function form(id, handler) {
  el(id).addEventListener('submit', async event => {
    event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true; message('');
    try { await handler(Object.fromEntries(new FormData(event.target))); event.target.reset(); }
    catch (e) { message(e.message, true); } finally { button.disabled = false; }
  });
}
async function users() {
  const data = await api('users'); el('users').replaceChildren();
  for (const user of data.users) {
    const row = document.createElement('div'); row.className = 'user';
    const title = document.createElement('strong'); title.textContent = user.username + (user.admin ? ' · Administrator' : '') + (user.disabled ? ' · gesperrt' : ''); row.append(title, document.createElement('br'));
    if (user.id !== session.user.id) {
      const toggle = document.createElement('button'); toggle.className = 'secondary'; toggle.textContent = user.disabled ? 'Freigeben' : 'Sperren';
      toggle.onclick = async () => { try { await api('users', {action:'disable',id:user.id,disabled:!user.disabled}); await users(); } catch (e) {message(e.message,true);} };
      const reset = document.createElement('form');
      const label = document.createElement('label'); label.textContent = 'Neues Passwort für ' + user.username;
      const password = document.createElement('input'); password.type = 'password'; password.autocomplete = 'new-password'; password.minLength = 12; password.required = true; label.append(password);
      const save = document.createElement('button'); save.textContent = 'Passwort zurücksetzen'; save.className = 'secondary';
      reset.append(label,save); reset.onsubmit = async e => { e.preventDefault(); save.disabled=true; try {await api('users',{action:'reset-password',id:user.id,password:password.value}); password.value='';message('Passwort geändert. Bisherige Sitzungen wurden abgemeldet.');}catch(err){message(err.message,true);}finally{save.disabled=false;} };
      const details = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = 'Passwort zurücksetzen'; details.append(summary,reset); row.append(toggle,details);
    }
    el('users').append(row);
  }
}
form('login-form', async body => { session = await api('login', body); location.assign('/'); });
form('setup-form', async body => { session = await api('setup', body); location.assign('/account'); });
form('create-form', async body => { await api('users', {...body,action:'create'}); message('Konto angelegt.'); await users(); });
form('password-form', async body => { await api('password',body); location.assign('/account'); });
el('logout').onclick = async () => { try { await api('logout',{}); location.assign('/account'); } catch (e) {message(e.message,true);} };
(async () => {
  const status = await api('status');
  if (status.setupRequired) { el('setup').hidden = false; return; }
  try { session = await api('me'); } catch { el('login').hidden = false; return; }
  el('account').hidden = false; el('identity').textContent = session.user.username;
  if (session.user.admin) { el('admin').hidden = false; await users(); }
})().catch(e => message(e.message,true));
