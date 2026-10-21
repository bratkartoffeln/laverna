/* global define */
(function(factory) {
    if (typeof define === 'function' && define.amd) define([], factory);
    else if (typeof module === 'object') module.exports = factory();
}(function() {
    'use strict';
    function parse(query) {
        return (String(query || '').match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(function(token) {
            var negative = token.charAt(0) === '-';
            if (negative) token = token.slice(1);
            var filter = /^(tag|notebook|updated|before|after):(.+)$/i.exec(token);
            return {negative:negative,field:filter ? filter[1].toLowerCase() : 'text',value:(filter ? filter[2] : token).replace(/"/g, '').toLowerCase()};
        }).filter(function(token) { return token.value; });
    }
    function matches(note, tokens, context) {
        context = context || {};
        if (Number(note.trash) !== 0) return false;
        return tokens.every(function(token) {
            var found, value = token.value, timestamp;
            if (token.field === 'tag') found = (note.tags || []).some(function(tag) { return String((context.tags || {})[tag] || tag).toLowerCase() === value; });
            else if (token.field === 'notebook') found = String((context.notebooks || {})[note.notebookId] || note.notebookId).toLowerCase() === value;
            else if (['updated','before','after'].indexOf(token.field) !== -1) {
                timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + 'T00:00:00').getTime() : NaN;
                found = Number.isFinite(timestamp) && (token.field === 'before' ? note.updated < timestamp : note.updated >= timestamp);
            } else found = (String(note.title) + '\n' + String(note.content)).toLowerCase().indexOf(value) !== -1;
            return token.negative ? !found : found;
        });
    }
    function highlight(root, query) {
        var terms = parse(query).filter(function(token) { return token.field === 'text' && !token.negative; }).map(function(token) { return token.value; });
        if (!root || !terms.length) return;
        var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [], node;
        while ((node = walker.nextNode())) if (node.parentElement && !node.parentElement.closest('mark,script,style,textarea,input,button')) nodes.push(node);
        nodes.forEach(function(textNode) {
            var text = textNode.nodeValue, lower = text.toLowerCase(), position = 0, fragment = document.createDocumentFragment(), changed = false;
            while (position < text.length) {
                var hit = -1, word = '';
                terms.forEach(function(term) { var index = lower.indexOf(term, position); if (index !== -1 && (hit === -1 || index < hit || (index === hit && term.length > word.length))) { hit = index; word = term; } });
                if (hit === -1) { fragment.appendChild(document.createTextNode(text.slice(position))); break; }
                fragment.appendChild(document.createTextNode(text.slice(position,hit)));
                var mark = document.createElement('mark'); mark.className = 'search-hit'; mark.textContent = text.slice(hit,hit + word.length); fragment.appendChild(mark);
                changed = true; position = hit + word.length;
            }
            if (changed) textNode.replaceWith(fragment);
        });
    }
    return {parse:parse,matches:matches,highlight:highlight};
}));
