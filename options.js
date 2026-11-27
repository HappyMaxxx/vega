/* "Preferences" in the browser's add-ons list: VEGA's settings live in its own page.
   Reuse an open VEGA tab if there is one, otherwise go to the settings page. */
(function () {
  'use strict';
  const api = globalThis.browser ?? globalThis.chrome;
  (async () => {
    try {
      for (const visibleOnly of [true, false]) {
        const r = await api.runtime.sendMessage({ type: 'vega:open-settings', visibleOnly });
        if (r && r.tabId != null) {
          await api.tabs.update(r.tabId, { active: true });
          if (r.windowId != null) await api.windows.update(r.windowId, { focused: true });
          const me = await api.tabs.getCurrent();
          if (me) return api.tabs.remove(me.id);
          return;
        }
      }
    } catch { /* no VEGA page is open */ }
    location.replace('index.html?settings');
  })();
})();
