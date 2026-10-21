/* global define */
define(['jquery','underscore','backbone.radio'], function($, _, Radio) {
    'use strict';
    async function api(path, body) {
        var session = window.LAVERNA_NAS;
        if (!session) throw new Error('NAS-Anmeldung erforderlich.');
        var response = await fetch('/api/' + path, {method:body ? 'POST' : 'GET',headers:{'Content-Type':'application/json','X-Laverna-User':session.user.id,'X-CSRF-Token':session.csrf,'X-Laverna-Request':'1'},body:body && JSON.stringify(body)});
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'NAS nicht erreichbar.');
        return data;
    }
    function profile() { return Radio.request('uri','profile') || 'notes-db'; }
    function modal(title) {
        var previous = document.activeElement;
        var dialog = $('<div class="modal fade nas-tools-dialog" tabindex="-1" role="dialog" aria-modal="true"><div class="modal-dialog modal-lg"><div class="modal-content"><div class="modal-header"><button type="button" class="close" data-dismiss="modal" aria-label="Schließen">&times;</button><h2 class="modal-title h4"></h2></div><div class="modal-body"><div class="nas-tool-message alert" role="status" hidden></div><div class="nas-tool-body"></div></div><div class="modal-footer"><button type="button" class="btn btn-default" data-dismiss="modal">Schließen</button></div></div></div></div>');
        dialog.find('.modal-title').text(title).attr('id','nas-tool-title'); dialog.attr('aria-labelledby','nas-tool-title');
        dialog.on('hidden.bs.modal',function() { dialog.remove(); if (previous && previous.isConnected) previous.focus(); });
        dialog.appendTo(document.body).modal('show');
        return {root:dialog,body:dialog.find('.nas-tool-body'),footer:dialog.find('.modal-footer'),error:function(error) { dialog.find('.nas-tool-message').prop('hidden',false).addClass('alert-danger').text(error.message); }};
    }
    function action(dialog, label, callback, className) {
        return $('<button type="button" class="btn">').addClass(className || 'btn-default').text(label).prependTo(dialog.footer).on('click',async function() {
            var button = $(this); button.prop('disabled',true);
            try { await callback(); } catch (error) { dialog.error(error); } finally { button.prop('disabled',false); }
        });
    }
    function pane(parent, heading, text, editable) {
        var section = $('<div class="col-sm-6 nas-compare-pane">').appendTo(parent);
        var label = $('<label class="control-label">').text(heading).appendTo(section);
        return $('<textarea class="form-control" rows="14">').attr('aria-label',heading).prop('readOnly',!editable).val(text || '').appendTo(label);
    }
    async function decode(data) {
        if (!data.encryptedData) return data;
        var plain = await Radio.request('encrypt','decrypt',data.encryptedData);
        if (!plain) throw new Error('Diese Fassung konnte nicht entschlüsselt werden.');
        return Object.assign({},data,typeof plain === 'string' ? JSON.parse(plain) : plain);
    }
    async function save(model, values) {
        var result = await Radio.request('notes','save',model,values);
        if (!result) throw new Error('Die Notiz konnte nicht gespeichert werden.');
        Radio.request('sync','start'); return result;
    }
    async function history(model, view) {
        var dialog = modal('Notizverlauf'), target = dialog.body;
        try {
            var response = await api('history?collection=notes&profile=' + encodeURIComponent(profile()) + '&id=' + encodeURIComponent(model.id));
            if (!response.revisions.length) { target.append($('<p>').text('Noch keine synchronisierten Fassungen vorhanden.')); return; }
            var label = $('<label>').text('Gespeicherte Fassung ').appendTo(target);
            var select = $('<select class="form-control" id="note-history-revision">').appendTo(label);
            response.revisions.forEach(function(row,index) { select.append($('<option>').val(index).text(new Date(row.created).toLocaleString() + ' · Fassung ' + row.rev)); });
            var compare = $('<div class="row nas-compare">').appendTo(target), selected;
            var currentPane = pane(compare,'Aktuelle Fassung',model.get('title') + '\n\n' + model.get('content'));
            var oldPane = pane(compare,'Gespeicherte Fassung','');
            var generation = 0;
            async function show() {
                var version = ++generation;
                restore.prop('disabled',true);
                try {
                    var data = await decode(response.revisions[Number(select.val())].data);
                    if (version !== generation) return;
                    selected = data; oldPane.val(data.title + '\n\n' + data.content);
                    restore.prop('disabled',Number(data.trash) === 2);
                } catch (error) { dialog.error(error); }
            }
            var restore = action(dialog,'Als neue Fassung wiederherstellen',async function() {
                if (!selected) return;
                await save(model,Object.assign(_.pick(selected,'title','content','tags','tasks','taskAll','taskCompleted','files','notebookId','isFavorite'),{trash:0}));
                if (view && !view.isDestroyed) view.options.content = await Radio.request('markdown','render',model);
                dialog.root.modal('hide');
                model.trigger('synced');
            },'btn-success').attr('id','note-history-restore');
            select.on('change',show); await show();
        } catch (error) { dialog.error(error); }
    }
    async function conflicts(model) {
        var dialog = modal('Konflikte vergleichen');
        try {
            var collection = await Radio.request('notes','fetch',{profile:profile()});
            var notes = collection.fullCollection || collection;
            var copies = notes.filter(function(note) { return Number(note.get('trash')) === 0 && note.get('conflictOf') && (!model || note.id === model.id || note.get('conflictOf') === model.id); });
            var list = $('<div class="list-group">').appendTo(dialog.body), area = $('<div>').appendTo(dialog.body);
            if (!copies.length) {
                dialog.body.prepend($('<p>').text('Keine zugeordneten Konflikte. Für ältere Konfliktkopien kannst du eine andere Notiz zum Vergleich auswählen.'));
                if (model) {
                    var label = $('<label>').text('Andere Notiz vergleichen').appendTo(list), select = $('<select class="form-control">').append($('<option>').val('').text('Notiz auswählen …')).appendTo(label);
                    notes.each(function(note) { if (note.id !== model.id && Number(note.get('trash')) === 0) select.append($('<option>').val(note.id).text(note.get('title'))); });
                    select.on('change',function() { if (select.val()) show(notes.get(select.val()),model).catch(dialog.error); });
                }
                return;
            }
            copies.forEach(function(copy) {
                $('<button type="button" class="list-group-item">').text(copy.get('title')).appendTo(list).on('click',function() { show(copy).catch(dialog.error); });
            });
            async function show(copy, partner) {
                var original = partner || await Radio.request('notes','get:model',{id:copy.get('conflictOf'),profile:profile()});
                if (!original || Number(original.get('trash')) !== 0) throw new Error('Die ursprüngliche Notiz ist nicht mehr aktiv. Stelle sie gegebenenfalls zuerst aus dem Papierkorb wieder her.');
                area.empty(); dialog.footer.find('.nas-conflict-action').remove();
                var row = $('<div class="row nas-compare">').appendTo(area);
                pane(row,'Aktuelle Fassung',original.get('title') + '\n\n' + original.get('content'));
                pane(row,'Konfliktfassung',copy.get('title') + '\n\n' + copy.get('content'));
                var title = $('<input class="form-control" aria-label="Zusammengeführter Titel">').val(original.get('title')).appendTo(area);
                $('<label>').text('Zusammengeführter Inhalt').appendTo(area);
                var merged = $('<textarea class="form-control" rows="10" aria-label="Zusammengeführter Inhalt">').val(original.get('content')).appendTo(area);
                async function resolve(values) {
                    if (values) await save(original,values);
                    await save(copy,{trash:1});
                    dialog.root.modal('hide');
                }
                action(dialog,'Zusammengeführte Fassung speichern',function() { return resolve({title:title.val(),content:merged.val()}); },'btn-success').addClass('nas-conflict-action').attr('id','conflict-save-merged');
                action(dialog,'Konfliktfassung übernehmen',function() { return resolve(Object.assign(_.pick(copy.toJSON(),'title','content','tags','tasks','taskAll','taskCompleted','files','notebookId'),{title:copy.get('title').replace(/ \(Konfliktkopie\)$/,'')})); },'btn-primary').addClass('nas-conflict-action');
                action(dialog,'Aktuelle Fassung behalten',function() { return resolve(); }).addClass('nas-conflict-action');
            }
            await show(copies[0]);
        } catch (error) { dialog.error(error); }
    }
    return {api:api,history:history,conflicts:conflicts};
});
