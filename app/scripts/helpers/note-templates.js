/* global define */
define(['backbone.radio'], function(Radio) {
    'use strict';
    var defaults = [
        {id:'meeting',name:'Besprechung',title:'Besprechung · {{date}}',content:'# Besprechung\n\nDatum: {{date}}\nTeilnehmer: \n\n## Themen\n\n- \n\n## Entscheidungen\n\n- \n\n## Aufgaben\n\n- [ ] '},
        {id:'tasks',name:'Aufgaben',title:'Aufgaben · {{date}}',content:'# Aufgaben\n\n## Heute\n\n- [ ] \n\n## Später\n\n- [ ] '},
        {id:'journal',name:'Tagesjournal',title:'Journal · {{date}}',content:'# {{date}}\n\n## Ziele\n\n- \n\n## Notizen\n\n\n## Rückblick\n\n'}
    ];
    function custom() { var value = Radio.request('configs','get:config','noteTemplates'); return Array.isArray(value) ? value.filter(function(item) { return item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.content === 'string'; }) : []; }
    function fill(value) { return value.replace(/\{\{date\}\}/g, new Date().toLocaleDateString('de-DE')); }
    return {defaults:defaults,custom:custom,all:function() { return defaults.concat(custom()); },fill:fill};
});
