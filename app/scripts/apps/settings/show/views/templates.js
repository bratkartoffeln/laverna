/* global define */
define(['underscore','jquery','marionette','backbone.radio','helpers/note-templates','text!apps/settings/show/templates/templates.html'], function(_, $, Marionette, Radio, Templates, Tmpl) {
    'use strict';
    return Marionette.ItemView.extend({
        template:_.template(Tmpl),
        events:{'submit #template-form':'saveTemplate','click #template-new':'newTemplate'},
        onRender:function() { this.draw(); },
        newTemplate:function() { this.editing = null; },
        draw:function() {
            var self = this, list = this.$('#template-list').empty();
            Templates.defaults.forEach(function(item) { $('<div class="list-group-item">').text(item.name + ' · Mitgelieferte Vorlage').appendTo(list); });
            Templates.custom().forEach(function(item) {
                var row = $('<div class="list-group-item">').append($('<strong>').text(item.name)).appendTo(list);
                $('<button type="button" class="btn btn-default btn-sm">').text('Bearbeiten').appendTo(row).on('click',function() {
                    self.editing = item.id;
                    ['name','title','content'].forEach(function(key) { self.$('#template-' + key).val(item[key]); });
                });
                $('<button type="button" class="btn btn-default btn-sm">').text('Löschen').appendTo(row).on('click',async function() {
                    try { await self.persist(Templates.custom().filter(function(value) { return value.id !== item.id; })); self.newTemplate(); self.$('#template-form')[0].reset(); }
                    catch (error) { self.message(error.message,true); }
                });
            });
        },
        message:function(text,error) { this.$('#template-message').prop('hidden',false).toggleClass('alert-danger',Boolean(error)).toggleClass('alert-success',!error).text(text); },
        persist:async function(values) {
            var saved = await Radio.request('configs','save:object',{name:'noteTemplates',value:values});
            if (!saved) throw new Error('Vorlagen konnten nicht gespeichert werden.');
            this.draw(); this.message('Vorlagen gespeichert.');
        },
        saveTemplate:async function(event) {
            event.preventDefault();
            var button = this.$('button[type=submit]').prop('disabled',true);
            try {
                var values = Templates.custom().slice(), item = Object.fromEntries(new FormData(event.currentTarget));
                item.name = item.name.trim(); if (!item.name || !item.content.trim()) throw new Error('Name und Inhalt sind erforderlich.');
                item.id = this.editing || 'custom-' + Date.now() + '-' + Math.random().toString(36).slice(2);
                values = values.filter(function(value) { return value.id !== item.id; }); values.push(item);
                await this.persist(values); this.editing = item.id;
            } catch (error) { this.message(error.message,true); } finally { button.prop('disabled',false); }
        }
    });
});
