/* global define */
define(['underscore','jquery','marionette','backbone.radio','modules/nas/tools','text!apps/settings/show/templates/backups.html'], function(_, $, Marionette, Radio, Tools, Tmpl) {
    'use strict';
    return Marionette.ItemView.extend({
        template:_.template(Tmpl),
        events:{'click #backup-create':'createBackup','submit #backup-schedule-form':'schedule','submit #backup-restore-form':'restore','click #backup-restore-cancel':'cancelRestore'},
        onShow:function() { this.load(); },
        message:function(text,error) { if (!this.isDestroyed) this.$('#backup-message').prop('hidden',false).toggleClass('alert-danger',Boolean(error)).toggleClass('alert-success',!error).text(text); },
        load:async function() {
            try {
                var data = await Tools.api('backups'), self = this;
                if (this.isDestroyed) return;
                this.$('#backup-controls').prop('hidden',false); this.$('#backup-interval').val(data.intervalHours);
                this.$('#backup-next').text(data.lastError || (data.next ? 'Nächste Sicherung: ' + new Date(data.next).toLocaleString() : 'Automatische Sicherung ist ausgeschaltet.'));
                var list = this.$('#backup-list').empty();
                if (!data.files.length) list.append($('<p>').text('Noch keine Sicherungen vorhanden.'));
                data.files.forEach(function(file) {
                    var row = $('<div class="list-group-item">').append($('<p>').text(new Date(file.created).toLocaleString() + ' · ' + (file.size / 1048576).toFixed(2) + ' MiB')).appendTo(list);
                    $('<button type="button" class="btn btn-default">').text('Herunterladen').appendTo(row).on('click',function() { self.download(file.id).catch(function(error) { self.message(error.message,true); }); });
                    $('<button type="button" class="btn btn-default">').text('Wiederherstellen').appendTo(row).on('click',function() {
                        self.restoreId = file.id; self.$('#backup-restore-name').text(new Date(file.created).toLocaleString());
                        self.$('#backup-restore-form').prop('hidden',false)[0].reset(); self.$('#backup-password').trigger('focus');
                    });
                });
            } catch (error) { this.message(error.message,true); }
        },
        run:async function(event,callback) {
            event.preventDefault(); var button = $(event.currentTarget).is('button') ? $(event.currentTarget) : $(event.currentTarget).find('button[type=submit]');
            if (button.prop('disabled')) return; button.prop('disabled',true);
            try { await callback.call(this); await this.load(); } catch (error) { this.message(error.message,true); } finally { button.prop('disabled',false); }
        },
        createBackup:function(event) { this.run(event,async function() { await Tools.api('backups',{action:'create'}); this.message('Sicherung erfolgreich erstellt.'); }); },
        schedule:function(event) { this.run(event,async function() { await Tools.api('backups',{action:'schedule',intervalHours:Number(this.$('#backup-interval').val())}); this.message('Sicherungsintervall gespeichert.'); }); },
        cancelRestore:function() { this.$('#backup-restore-form').prop('hidden',true)[0].reset(); this.restoreId = null; },
        restore:function(event) { this.run(event,async function() {
            var result = await Tools.api('backups',{action:'restore',id:this.restoreId,password:this.$('#backup-password').val(),confirmation:this.$('#backup-confirmation').val()});
            this.cancelRestore(); this.message(result.restored + ' Datensätze wiederhergestellt. Eine Sicherung des vorherigen Standes wurde angelegt.'); Radio.request('sync','start');
        }); },
        download:async function(id) {
            var session = window.LAVERNA_NAS;
            var response = await fetch('/api/backups/download?id=' + encodeURIComponent(id),{headers:{'X-Laverna-User':session.user.id}});
            if (!response.ok) throw new Error('Sicherung konnte nicht heruntergeladen werden.');
            var url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a'); anchor.href = url; anchor.download = id; anchor.click(); setTimeout(function() { URL.revokeObjectURL(url); },1000);
        }
    });
});
