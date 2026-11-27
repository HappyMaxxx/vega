/* Toolbar button popup: open a VEGA tab, or jump straight to settings. */
(function () {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const S = globalThis.VEGA.S;
  const open = query => {
    api.tabs.create({ url: api.runtime.getURL('index.html') + query });
    window.close();
  };
  const el = id => document.getElementById(id);
  el('open').textContent = S.popupOpen;
  el('settings').textContent = S.popupSettings;
  el('open').addEventListener('click', () => open(''));
  el('settings').addEventListener('click', () => open('?settings'));
})();
