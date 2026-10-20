/* global define */
define(['backbone.radio', 'modules/nas/sync'], function(Radio, Sync) {
    'use strict';
    Radio.request('init', 'add', 'module', function() {
        if (window.LAVERNA_NAS) new Sync();
    });
    return Sync;
});
