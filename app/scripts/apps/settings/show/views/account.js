/* global define */
define(['underscore', 'marionette', 'text!apps/settings/show/templates/account.html'], function(_, Marionette, Tmpl) {
    'use strict';

    function clearKeys() {
        var prefix = 'secureKey.nas-' + window.LAVERNA_NAS.user.id + '.';
        Object.keys(sessionStorage).filter(function(k) { return k.indexOf(prefix) === 0; }).forEach(function(k) { sessionStorage.removeItem(k); });
    }

    return Marionette.ItemView.extend({
        className: 'nas-account',
        template: _.template(Tmpl),
        events: {
            'submit #account-create-form': 'createUser',
            'submit #account-password-form': 'changePassword',
            'submit .nas-account-reset': 'resetPassword',
            'click #account-logout': 'logout',
            'click [data-account-action="toggle"]': 'toggleUser',
            'click [data-account-action="reset"]': 'showReset'
        },
        initialize: function() {
            this.requests = new AbortController();
            this.usersById = {};
        },
        onShow: function() { this.load(); },
        onDestroy: function() { this.requests.abort(); },
        message: function(text, error) {
            if (this.isDestroyed) return;
            this.$('#account-message').text(text || '').toggleClass('alert-danger', Boolean(error)).toggleClass('alert-success', !error);
        },
        request: async function(path, body) {
            var session = window.LAVERNA_NAS;
            if (!session) throw new Error('Für die Kontoverwaltung ist eine NAS-Anmeldung erforderlich.');
            var headers = {'X-Laverna-Request':'1', 'X-Laverna-User':session.user.id, 'X-CSRF-Token':session.csrf};
            if (body) headers['Content-Type'] = 'application/json';
            var response = await fetch('/api/' + path, {method:body ? 'POST' : 'GET', headers:headers, body:body && JSON.stringify(body), signal:this.requests.signal});
            var data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Die Anfrage konnte nicht abgeschlossen werden.');
            return data;
        },
        load: async function() {
            try {
                var session = await this.request('me');
                this.session = session;
                this.$('#account-identity').text(session.user.username);
                this.$('#account-role').text(session.user.admin ? 'Administrator' : 'Benutzer');
                this.$('#account-details').prop('hidden', false);
                this.$('#account-admin').prop('hidden', !session.user.admin);
                if (session.user.admin) await this.loadUsers();
            } catch (error) { if (error.name !== 'AbortError') this.message(error.message, true); }
            finally { this.$('#account-loading').prop('hidden', true); }
        },
        loadUsers: async function() {
            var data = await this.request('users'), list = this.$('#account-users').empty();
            this.usersById = {};
            for (var user of data.users) {
                this.usersById[user.id] = user;
                var row = document.createElement('div');
                row.className = 'nas-account-user'; row.dataset.userId = user.id;
                var summary = document.createElement('div'); summary.className = 'row';
                var info = document.createElement('div'); info.className = 'col-sm-5';
                var name = document.createElement('div'); name.className = 'nas-account-user-name'; name.textContent = user.username;
                var meta = document.createElement('p'); meta.className = 'help-block nas-account-user-meta';
                meta.textContent = (user.admin ? 'Administrator' : 'Benutzer') + ' · ' + (user.disabled ? 'Gesperrt' : 'Aktiv') + (user.id === this.session.user.id ? ' · Dein Konto' : '');
                info.append(name, meta); summary.append(info); row.append(summary);
                if (user.id !== this.session.user.id) {
                    var actions = document.createElement('div'); actions.className = 'col-sm-7 nas-account-user-actions';
                    for (var action of ['toggle', 'reset']) {
                        var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-default';
                        button.dataset.accountAction = action;
                        button.textContent = action === 'toggle' ? (user.disabled ? 'Freigeben' : 'Sperren') : 'Passwort zurücksetzen';
                        button.setAttribute('aria-label', button.textContent + ': ' + user.username);
                        if (action === 'reset') { button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'account-reset-' + user.id); }
                        actions.append(button);
                    }
                    summary.append(actions);
                    var form = document.createElement('form'); form.className = 'nas-account-reset form-horizontal'; form.id = 'account-reset-' + user.id; form.hidden = true;
                    var group = document.createElement('div'); group.className = 'form-group';
                    var label = document.createElement('label'); label.className = 'col-sm-3 control-label'; label.htmlFor = 'account-reset-password-' + user.id; label.textContent = 'Neues Passwort';
                    var field = document.createElement('div'); field.className = 'col-sm-9';
                    var input = document.createElement('input'); input.id = label.htmlFor; input.name = 'password'; input.type = 'password'; input.className = 'form-control'; input.autocomplete = 'new-password'; input.minLength = 12; input.required = true;
                    var help = document.createElement('p'); help.className = 'help-block'; help.textContent = 'Mindestens zwölf Zeichen. Bestehende Anmeldungen dieses Kontos werden beendet.';
                    var save = document.createElement('button'); save.className = 'btn btn-success'; save.type = 'submit'; save.textContent = 'Neues Passwort speichern';
                    field.append(input, help, save); group.append(label, field); form.append(group); row.append(form);
                }
                list.append(row);
            }
        },
        runForm: async function(event, handler) {
            event.preventDefault();
            var form = event.currentTarget, button = form.querySelector('button[type="submit"]');
            if (button.disabled) return;
            button.disabled = true; this.message('');
            try { await handler.call(this, Object.fromEntries(new FormData(form))); form.reset(); }
            catch (error) { if (error.name !== 'AbortError') this.message(error.message, true); }
            finally { button.disabled = false; }
        },
        createUser: function(event) {
            this.runForm(event, async function(data) {
                await this.request('users', Object.assign({action:'create'}, data));
                await this.loadUsers(); this.message('Benutzer angelegt. Die Anmeldung ist jetzt möglich.');
            });
        },
        changePassword: function(event) {
            this.runForm(event, async function(data) {
                await this.request('password', data); clearKeys(); window.location.assign('/account?changed=1');
            });
        },
        resetPassword: function(event) {
            var id = event.currentTarget.closest('[data-user-id]').dataset.userId;
            this.runForm(event, async function(data) {
                await this.request('users', {action:'reset-password', id:id, password:data.password});
                await this.loadUsers(); this.message('Passwort zurückgesetzt. Bisherige Anmeldungen dieses Kontos wurden beendet.');
            });
        },
        showReset: function(event) {
            var button = event.currentTarget, form = button.closest('[data-user-id]').querySelector('form');
            form.hidden = !form.hidden; button.setAttribute('aria-expanded', String(!form.hidden));
            if (!form.hidden) form.querySelector('input').focus(); else form.reset();
        },
        toggleUser: async function(event) {
            var button = event.currentTarget, user = this.usersById[button.closest('[data-user-id]').dataset.userId];
            if (button.disabled) return;
            button.disabled = true; this.message('');
            try {
                await this.request('users', {action:'disable', id:user.id, disabled:!user.disabled});
                await this.loadUsers(); this.message(user.disabled ? 'Benutzer freigegeben.' : 'Benutzer gesperrt. Die Notizen bleiben erhalten.');
            } catch (error) { if (error.name !== 'AbortError') this.message(error.message, true); }
            finally { button.disabled = false; }
        },
        logout: async function(event) {
            var button = event.currentTarget; if (button.disabled) return; button.disabled = true;
            try { await this.request('logout', {}); clearKeys(); window.location.assign('/account'); }
            catch (error) { button.disabled = false; if (error.name !== 'AbortError') this.message(error.message, true); }
        }
    });
});
