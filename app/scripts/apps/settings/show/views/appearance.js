/* global define */
define(['underscore', 'marionette', 'text!apps/settings/show/templates/appearance.html'], function(_, Marionette, Tmpl) {
    'use strict';
    return Marionette.ItemView.extend({
        template: _.template(Tmpl),
        events: {'change #appearance-dark-mode':'changeTheme','click #offline-install':'install'},
        initialize: function() {
            this.refreshTheme = this.refreshTheme.bind(this);
            window.addEventListener('laverna:appearance', this.refreshTheme);
            this.refreshOffline = this.refreshOffline.bind(this);
            window.addEventListener('laverna:offline-ready',this.refreshOffline);
        },
        onRender: function() { this.refreshTheme(); this.refreshOffline(); },
        onDestroy: function() { window.removeEventListener('laverna:appearance', this.refreshTheme); window.removeEventListener('laverna:offline-ready',this.refreshOffline); },
        refreshOffline:function() {
            var state = window.LavernaOffline || {};
            this.$('#offline-status').text(window.LAVERNA_NAS && window.LAVERNA_NAS.offline ? 'Offline gestartet · Änderungen werden lokal gespeichert.' : state.ready ? 'Laverna ist für dieses Konto offline verfügbar.' : state.error || (!window.isSecureContext ? 'Offline-Funktion benötigt HTTPS oder localhost.' : 'Offline-Dateien werden vorbereitet …'));
            this.$('#offline-install').prop('hidden',!state.installPrompt);
        },
        install:async function() { var prompt = window.LavernaOffline.installPrompt; if (prompt) { await prompt.prompt(); await prompt.userChoice; window.LavernaOffline.installPrompt = null; this.refreshOffline(); } },
        refreshTheme: function() { this.$('#appearance-dark-mode').prop('checked', window.LavernaAppearance.isDark()); },
        changeTheme: function(event) { window.LavernaAppearance.setDark(event.currentTarget.checked); }
    });
});
