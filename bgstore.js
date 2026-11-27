/* Local wallpaper storage. Large files do not fit in localStorage (~5 MB), so a chosen image or video
   lives in IndexedDB (database "vega"). Only the background uses it; everything else stays in localStorage. */
(function (g) {
'use strict';
const DB = 'vega', STORE = 'files';

const open = () => new Promise((resolve, reject) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  });
}

const out = {
  put: (key, blob, meta) => run('readwrite', s => s.put({ blob, ...meta }, key)),
  get: key => run('readonly', s => s.get(key)),
  del: key => run('readwrite', s => s.delete(key)),
};
(g.VEGA = g.VEGA || {}).bgstore = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
