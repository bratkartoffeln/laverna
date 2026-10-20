/* Apply before styles load, including on the NAS sign-in screen. */
(function() {
    'use strict';
    var key = 'laverna.appearance', dark = false;
    try { dark = localStorage.getItem(key) === 'dark'; } catch (error) { /* Storage may be unavailable. */ }
    function apply() {
        document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
        window.dispatchEvent(new CustomEvent('laverna:appearance', {detail:{dark:dark}}));
    }
    window.LavernaAppearance = {
        isDark: function() { return dark; },
        setDark: function(value) {
            dark = Boolean(value);
            try { localStorage.setItem(key, dark ? 'dark' : 'light'); } catch (error) { /* Keep the selection for this page. */ }
            apply();
        },
        toggle: function() { this.setDark(!dark); }
    };
    window.addEventListener('storage', function(event) {
        if (event.key === key || event.key === null) { dark = event.newValue === 'dark'; apply(); }
    });
    apply();
}());
