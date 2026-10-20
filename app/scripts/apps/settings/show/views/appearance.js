/* global define */
define(['underscore', 'marionette', 'text!apps/settings/show/templates/appearance.html'], function(_, Marionette, Tmpl) {
    'use strict';
    return Marionette.ItemView.extend({
        template: _.template(Tmpl),
        events: {'change #appearance-dark-mode':'changeTheme'},
        initialize: function() {
            this.refreshTheme = this.refreshTheme.bind(this);
            window.addEventListener('laverna:appearance', this.refreshTheme);
        },
        onRender: function() { this.refreshTheme(); },
        onDestroy: function() { window.removeEventListener('laverna:appearance', this.refreshTheme); },
        refreshTheme: function() { this.$('#appearance-dark-mode').prop('checked', window.LavernaAppearance.isDark()); },
        changeTheme: function(event) { window.LavernaAppearance.setDark(event.currentTarget.checked); }
    });
});
