/**
 * Copyright (C) 2015 Laverna project Authors.
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */
/* global define */
define([
    'underscore',
    'marionette',
    'constants',
    'apps/settings/show/formBehavior',
    'text!apps/settings/show/templates/sync.html'
], function(_, Marionette, constants, FormBehavior, Tmpl) {
    'use strict';

    /**
     * Sync settings.
     */
    var View = Marionette.ItemView.extend({
        template: _.template(Tmpl),

        events: {
            'click #nas-import-local': function() {
                var self = this;
                if (!window.confirm('Die bisherigen lokalen Notizen dieses Browserprofils in dein angemeldetes NAS-Konto übernehmen?')) return;
                this.$('#nas-import-local').prop('disabled', true);
                requirejs(['modules/nas/sync'], function(Sync) {
                    Sync.importLegacy().then(function() {
                        self.$('#nas-import-result').text('Übernommen. Die Synchronisierung startet automatisch.');
                    }).catch(function(error) {
                        self.$('#nas-import-result').text(error.message || 'Import fehlgeschlagen.');
                    }).finally(function() { self.$('#nas-import-local').prop('disabled', false); });
                });
            }
        },

        behaviors: {
            FormBehavior: {
                behaviorClass: FormBehavior
            }
        },

        serializeData: function() {
            return {
                models         : this.collection.getConfigs(),
                dropboxKeyNeed : constants.DROPBOXKEYNEED
            };
        }
    });

    return View;
});
