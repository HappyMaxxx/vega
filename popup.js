/* Toolbar button popup: open or focus a VEGA tab, or jump straight to settings.
   If a VEGA page is already open, it is reused (no duplicate tab). Works without the "tabs" permission:
   VEGA pages answer a runtime message with their own tab id. */
(function () {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  const S = globalThis.VEGA.S;

  // Ask open VEGA pages to act. Pages that are visible (the active tab of a window) answer first.
  async function ask(type) {
    for (const visibleOnly of [true, false]) {
      try {
        const r = await api.runtime.sendMessage({ type, visibleOnly });
        if (r && r.tabId != null) return r;
      } catch { /* nobody is listening */ }
    }
    return null;
  }

  async function go(type, query) {
    const r = await ask(type);
    if (r) {
      try { await api.tabs.update(r.tabId, { active: true }); if (r.windowId != null) await api.windows.update(r.windowId, { focused: true }); } catch { /* ignore */ }
    } else {
      await api.tabs.create({ url: api.runtime.getURL('index.html') + query });
    }
    window.close();
  }

  const el = id => document.getElementById(id);
  el('open').textContent = S.popupOpen;
  el('settings').textContent = S.popupSettings;
  el('open').addEventListener('click', () => go('vega:focus', ''));
  el('settings').addEventListener('click', () => go('vega:open-settings', '?settings'));
})();
