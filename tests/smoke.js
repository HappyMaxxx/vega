/* VEGA smoke tests. Run: npm test  (Node 18+, jsdom is the only dev dependency).
   Covers: grid engine, state migration from the real 0.1.0 data, workspace moves and undo (in jsdom),
   theme contrast (WCAG AA), and release hygiene. */
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const grid = require('../grid.js');
const stateLib = require('../state.js');
const fixture = () => JSON.parse(read('tests/fixtures/v0.1.0-customized.json'));
const S = require('../strings.js');

// objects created inside a jsdom window have another Object.prototype: compare plain copies
const plain = x => JSON.parse(JSON.stringify(x === undefined ? null : x));
const overlaps = items => items.some((a, i) => items.some((b, j) => j > i && grid.collides(a, b)));

/* ───────────── grid engine ───────────── */
describe('grid', () => {
  const T = (id, type, x, y, w, h) => ({ id, type, x, y, w, h, cfg: {} });

  test('moving a tile onto another pushes it down, no overlaps remain', () => {
    const items = [T('a', 'notes', 0, 0, 4, 2), T('b', 'notes', 4, 0, 4, 2), T('c', 'notes', 0, 2, 4, 2)];
    const out = grid.computeLayout(items, 'a', { x: 4, y: 0 });
    assert.equal(overlaps(out), false);
    assert.deepEqual(out.find(i => i.id === 'a'), { ...items[0], x: 4, y: 0 });
    assert.ok(out.find(i => i.id === 'b').y >= 2, 'b was pushed below a');
  });

  test('cascading pushes resolve without overlap', () => {
    const items = [T('a', 'notes', 0, 0, 3, 2), T('b', 'notes', 0, 2, 3, 2), T('c', 'notes', 0, 4, 3, 2), T('d', 'notes', 0, 6, 3, 2)];
    const out = grid.computeLayout(items, 'd', { x: 0, y: 0 });
    assert.equal(overlaps(out), false);
  });

  test('size and position are clamped to module limits and the grid', () => {
    const items = [T('t', 'timer', 0, 0, 3, 3)];
    const big = grid.computeLayout(items, 't', { w: 99, h: 99, x: 50, y: -5 })[0];
    assert.deepEqual([big.w, big.h], [grid.META.timer.max[0], grid.META.timer.max[1]]);
    assert.ok(big.x >= 0 && big.x + big.w <= grid.COLS && big.y === 0);
    const small = grid.computeLayout(items, 't', { w: 0, h: 0 })[0];
    assert.deepEqual([small.w, small.h], grid.META.timer.min);
  });

  test('computeLayout does not mutate its input', () => {
    const items = [T('a', 'notes', 0, 0, 4, 2), T('b', 'notes', 4, 0, 4, 2)];
    const copy = JSON.stringify(items);
    grid.computeLayout(items, 'a', { x: 4 });
    assert.equal(JSON.stringify(items), copy);
  });

  test('firstFree finds the first row-major slot and skips occupied cells', () => {
    const items = [T('a', 'notes', 0, 0, 4, 2)];
    assert.deepEqual(grid.firstFree(items, 4, 2), { x: 4, y: 0 });
    assert.deepEqual(grid.firstFree([T('a', 'notes', 0, 0, 12, 2)], 3, 2), { x: 0, y: 2 });
    assert.deepEqual(grid.firstFree([], 3, 3), { x: 0, y: 0 });
  });

  test('place keeps a free slot and relocates a taken one', () => {
    const items = [T('a', 'notes', 0, 0, 4, 2)];
    assert.deepEqual(pos(grid.place(items, T('n', 'notes', 6, 3, 2, 2))), { x: 6, y: 3 });
    const moved = grid.place(items, T('m', 'notes', 1, 0, 2, 2));
    assert.equal(grid.collides(moved, items[0]), false);
  });

  test('autopack closes gaps upward without creating overlaps', () => {
    const items = [T('a', 'notes', 0, 5, 4, 2), T('b', 'notes', 4, 7, 4, 2), T('c', 'notes', 0, 9, 4, 2)];
    grid.autopack(items);
    assert.equal(overlaps(items), false);
    assert.deepEqual(items.map(i => i.y), [0, 0, 2]);
  });

  test('neighbour picks the nearest tile in a direction', () => {
    const a = T('a', 'notes', 0, 0, 4, 2), b = T('b', 'notes', 4, 0, 4, 2), c = T('c', 'notes', 0, 2, 4, 2);
    assert.equal(grid.neighbour([a, b, c], a, 'r').id, 'b');
    assert.equal(grid.neighbour([a, b, c], a, 'd').id, 'c');
    assert.equal(grid.neighbour([a, b, c], a, 'l'), null);
  });
  const pos = i => ({ x: i.x, y: i.y });
});

/* ───────────── state: normalize, load, migration ───────────── */
describe('state', () => {
  // every value in `a` must be present, equal, in `b` (b may have extra keys)
  const subset = (a, b, p = '') => {
    if (a && typeof a === 'object') {
      assert.ok(b && typeof b === 'object', `${p}: missing`);
      for (const k of Object.keys(a)) subset(a[k], b[k], `${p}.${k}`);
    } else assert.equal(b, a, p);
  };

  test('0.1.0 fixture survives normalize() with nothing lost', () => {
    const fx = fixture();
    const out = stateLib.normalize(JSON.parse(JSON.stringify(fx)));
    const { rev, ...fxNoRev } = fx;
    subset(fxNoRev, out);
    assert.equal(out.ws.length, fx.ws.length);
    assert.equal(out.tasks.length, 3);
    assert.deepEqual(out.data, fx.data);
    assert.equal(out.groups[0].links.at(-1).color, '#ff00ff');
    assert.equal(out.settings.focusMin, 30);
  });

  test('new settings get defaults without touching the old ones', () => {
    const out = stateLib.normalize(fixture());
    assert.equal(out.settings.theme, 'gruvbox');
    assert.equal(out.settings.accent, '');
    assert.equal(out.settings.linkTheme, false);
    assert.equal(out.rev, stateLib.REV);
    assert.equal(out.v, 1);
  });

  test('0.3 settings get safe defaults and bad values are repaired', () => {
    const out = stateLib.normalize(fixture()).settings;
    assert.deepEqual([out.bgFit, out.bgLocal, out.bgSharpen, out.focusPage, out.focusForget], ['cover', false, false, false, false]);
    const bad = fixture(); Object.assign(bad.settings, { bgFit: 'zoom', bgLocal: 'yes', focusPage: 1 });
    const fixed = stateLib.normalize(bad).settings;
    assert.deepEqual([fixed.bgFit, fixed.bgLocal, fixed.focusPage], ['cover', true, true]);
  });

  test('normalize is idempotent', () => {
    const once = stateLib.normalize(fixture());
    assert.deepEqual(stateLib.normalize(JSON.parse(JSON.stringify(once))), once);
  });

  test('unknown tile types are kept, not dropped', () => {
    const fx = fixture();
    fx.ws[0].items.push({ id: 'future1', type: 'github', x: 0, y: 20, w: 4, h: 3, cfg: { repo: 'x' } });
    const out = stateLib.normalize(fx);
    const kept = out.ws[0].items.find(i => i.id === 'future1');
    assert.ok(kept);
    assert.deepEqual(kept.cfg, { repo: 'x' });
  });

  test('bad numbers and duplicate ids are repaired, tiles stay', () => {
    const fx = fixture();
    const first = fx.ws[0].items[0];
    fx.ws[0].items.push({ ...first, x: 'oops', y: -3, w: 99 });
    const out = stateLib.normalize(fx);
    const ids = out.ws.flatMap(w => w.items.map(i => i.id));
    assert.equal(new Set(ids).size, ids.length);
    for (const i of out.ws.flatMap(w => w.items)) assert.ok(i.x >= 0 && i.y >= 0 && i.w >= 1 && i.x + i.w <= grid.COLS);
  });

  test('garbage input falls back to defaults', () => {
    for (const bad of [null, 5, 'x', [], { ws: [] }, { ws: 3 }]) assert.equal(stateLib.normalize(bad).ws.length, 3);
  });

  const store = (init = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
  };

  test('load() backs up the 0.1.0 data before first migration, then leaves the backup alone', () => {
    const raw = read('tests/fixtures/v0.1.0-customized.json');
    const st = store({ [stateLib.KEY]: raw });
    stateLib.load(st);
    assert.equal(st.getItem(stateLib.BACKUP), raw);
    // after the app saves current-revision data, a reload must not overwrite the backup
    st.setItem(stateLib.KEY, JSON.stringify(stateLib.normalize(JSON.parse(raw))));
    stateLib.load(st);
    assert.equal(st.getItem(stateLib.BACKUP), raw);
  });

  test('load() keeps a copy of corrupt or unusable data instead of silently resetting', () => {
    const st = store({ [stateLib.KEY]: '{not json' });
    const s = stateLib.load(st);
    assert.equal(st.getItem(stateLib.BACKUP), '{not json');
    assert.equal(s.ws.length, 3);
    const st2 = store({ [stateLib.KEY]: JSON.stringify({ v: 9, ws: [] }), [stateLib.BACKUP]: 'older good data' });
    stateLib.load(st2);
    assert.equal(st2.getItem(stateLib.BACKUP), 'older good data');
    assert.equal(st2.getItem(stateLib.BAD), JSON.stringify({ v: 9, ws: [] }));
  });

  test('fresh installs get neutral starter links whose dots follow the theme', () => {
    const d = stateLib.defaults();
    assert.equal(d.settings.linkTheme, true);
    assert.ok(d.groups.length >= 8 && d.groups.every(g => g.links.length && g.links.every(l => !l.color)));
    assert.equal(d.settings.place, 'Kyiv');
  });

  test('data saved by older builds keeps per-link colours (the new default must not flip it)', () => {
    assert.equal(stateLib.normalize(fixture()).settings.linkTheme, false);
    const explicit = fixture(); explicit.settings.linkTheme = true;
    assert.equal(stateLib.normalize(explicit).settings.linkTheme, true);
  });

  test('load() with nothing stored returns defaults and writes no backup', () => {
    const st = store();
    assert.equal(stateLib.load(st).ws.length, 3);
    assert.equal(st.getItem(stateLib.BACKUP), null);
  });
});

/* ───────────── app in jsdom: moves, delete, undo, menu ───────────── */
async function boot(seed, pre) {
  const html = read('index.html');
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  if (pre) pre(w);
  if (seed) w.localStorage.setItem(stateLib.KEY, typeof seed === 'string' ? seed : JSON.stringify(seed));
  for (const m of html.matchAll(/<script src="([^"]+)"><\/script>/g)) w.eval(read(m[1]));
  const key = (code, opts = {}) => w.document.dispatchEvent(new w.KeyboardEvent('keydown', { code, key: opts.key || '', bubbles: true, ...opts }));
  const saved = () => { w.dispatchEvent(new w.Event('pagehide')); return JSON.parse(w.localStorage.getItem(stateLib.KEY)); };
  // let in-flight async work (weather fetch etc.) settle before tearing the window down
  return { w, key, saved, close: async () => { await new Promise(r => setTimeout(r, 25)); w.close(); } };
}
const counts = s => s.ws.map(x => x.items.length);

describe('app (jsdom)', () => {
  test('boots from the 0.1.0 fixture and renders its tiles', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      assert.equal(a.w.document.querySelectorAll('.tile').length, 9);
      assert.equal(a.w.document.documentElement.dataset.theme, 'gruvbox');
      const s = a.saved();
      assert.deepEqual(counts(s), [9, 3, 2, 0]);
      assert.deepEqual(s.tasks, fixture().tasks);
      assert.deepEqual(s.data, fixture().data);
    } finally { await a.close(); }
  });

  test('Shift+Digit moves the focused tile, keeps identity and notes, and undo restores it', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      const before = a.saved();
      const notes = before.ws[0].items.find(i => i.type === 'notes' && before.data[i.id]);
      a.w.document.querySelector(`.tile[data-type="notes"]`); // rendered
      // focus the notes tile that holds the note: click its header via pointerdown
      const idx = before.ws[0].items.filter(i => i.type === 'notes').findIndex(i => i.id === notes.id);
      a.w.document.querySelectorAll('.tile[data-type="notes"]')[idx].dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
      a.key('Digit3', { shiftKey: true });
      let s = a.saved();
      assert.deepEqual(counts(s), [8, 3, 3, 0]);
      const moved = s.ws[2].items.find(i => i.id === notes.id);
      assert.ok(moved, 'same tile id in the target workspace');
      assert.equal(moved.w, notes.w); assert.equal(moved.h, notes.h);
      assert.deepEqual(moved.cfg, notes.cfg);
      assert.equal(overlaps(s.ws[2].items), false);
      assert.deepEqual(s.data[notes.id], before.data[notes.id], 'notes follow the tile');
      a.key('KeyZ');
      s = a.saved();
      assert.deepEqual(counts(s), [9, 3, 2, 0]);
      assert.ok(s.ws[0].items.find(i => i.id === notes.id));
      assert.equal(overlaps(s.ws[0].items), false);
    } finally { await a.close(); }
  });

  test('moving into a full workspace falls back to a slot below the visible rows', async () => {
    const fx = fixture();
    fx.ws[2].items = [{ id: 'full', type: 'notes', x: 0, y: 0, w: 12, h: 8, cfg: {} }];
    const a = await boot(fx);
    try {
      a.key('Digit1');
      a.key('Digit3', { shiftKey: true });
      const s = a.saved();
      const moved = s.ws[2].items.find(i => i.id !== 'full');
      assert.ok(moved && moved.y >= 8);
      assert.equal(overlaps(s.ws[2].items), false);
    } finally { await a.close(); }
  });

  test('deleting a tile moves its notes into undo (no orphans); undo puts them back', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      const before = a.saved();
      const noteTile = before.ws[0].items.find(i => before.data[i.id]);
      const idx = before.ws[0].items.filter(i => i.type === 'notes').findIndex(i => i.id === noteTile.id);
      a.w.document.querySelectorAll('.tile[data-type="notes"]')[idx].dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
      a.key('KeyX');
      let s = a.saved();
      assert.equal(s.ws[0].items.some(i => i.id === noteTile.id), false);
      assert.deepEqual(s.data, {}, 'no orphaned per-tile data');
      a.key('KeyZ');
      s = a.saved();
      assert.deepEqual(s.data, before.data);
      assert.ok(s.ws[0].items.find(i => i.id === noteTile.id));
    } finally { await a.close(); }
  });

  test('undo stack is capped at 20 and unwinds in order', async () => {
    const fx = fixture();
    fx.ws[0].items = Array.from({ length: 24 }, (_, i) => ({ id: 't' + i, type: 'notes', x: (i % 6) * 2, y: Math.floor(i / 6) * 2, w: 2, h: 2, cfg: {} }));
    const a = await boot(fx);
    try {
      a.key('Digit1');
      for (let i = 0; i < 24; i++) a.key('KeyX');
      assert.equal(a.saved().ws[0].items.length, 0);
      for (let i = 0; i < 30; i++) a.key('KeyZ');
      assert.equal(a.saved().ws[0].items.length, 20);
    } finally { await a.close(); }
  });

  test('unknown tile types are not rendered but survive a save round-trip', async () => {
    const fx = fixture();
    fx.ws[0].items.push({ id: 'future1', type: 'github', x: 0, y: 30, w: 4, h: 3, cfg: { repo: 'x' } });
    const a = await boot(fx);
    try {
      a.key('Digit1');
      assert.equal(a.w.document.querySelectorAll('.tile').length, 9);
      assert.ok(a.saved().ws[0].items.find(i => i.id === 'future1'));
    } finally { await a.close(); }
  });

  test('tile menu opens on m, lists move targets, Escape closes it', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      a.key('KeyM');
      const items = [...a.w.document.querySelectorAll('.menu .mi')].map(e => e.textContent);
      assert.ok(items.some(t => t.includes(S.tileDuplicate)));
      assert.ok(items.some(t => t.includes('Move to chill')));
      assert.ok(items.some(t => t.includes(S.tileDelete)));
      a.key('Escape', { key: 'Escape' });
      assert.equal(a.w.document.querySelector('.menu'), null);
    } finally { await a.close(); }
  });

  test('Enter goes inside a tile (notes get the caret), hotkeys pause, Esc comes back', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      const d = a.w.document, notes = d.querySelector('.tile[data-type="notes"]');
      notes.dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
      a.key('Enter');
      assert.equal(d.activeElement.tagName, 'TEXTAREA');
      assert.ok(notes.classList.contains('inside'));
      assert.match(d.querySelector('#mode').textContent, /inside/);
      const before = d.querySelector('.tile.focus').dataset.id;
      a.key('KeyH'); a.key('KeyJ');                                   // typing context: no tile navigation
      assert.equal(d.querySelector('.tile.focus').dataset.id, before);
      a.key('Escape', { key: 'Escape' });
      assert.equal(d.activeElement, d.body);
      assert.equal(d.querySelector('.tile.inside'), null);
      a.key('KeyX');                                                   // tile-level hotkeys work again
      assert.equal(d.querySelectorAll('.tile').length, 8);
    } finally { await a.close(); }
  });

  test('Enter inside tasks focuses the input; arrows reach the list; the list survives redraws', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      const d = a.w.document;
      d.querySelector('.tile[data-type="tasks"]').dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
      a.key('Enter');
      assert.equal(d.activeElement.className, 'ti');
      d.activeElement.dispatchEvent(new a.w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      assert.equal(d.activeElement.className, 'cb');
      d.activeElement.click();                                         // toggles the first task, list is redrawn
      assert.equal(d.activeElement.className, 'cb', 'keyboard position is restored after the redraw');
      assert.equal(a.saved().tasks.filter(t => t.done).length, 2, 'fixture had one done task, the keyboard toggle made it two');
    } finally { await a.close(); }
  });

  describe('focus the page on a new tab (extension API mocked)', () => {
    const mock = (calls, tabId = 7) => w => {
      w.browser = {
        runtime: { id: 'x', getURL: p => 'moz-extension://abc/' + p },
        tabs: { getCurrent: async () => ({ id: tabId, index: 3 }), create: async o => { calls.push(['create', o]); }, remove: async id => { calls.push(['remove', id]); } },
        permissions: { contains: async () => false },
        sessions: { getRecentlyClosed: async () => [{ tab: { url: 'http://localhost/#from=7.1', windowId: 1, sessionId: '9' } }, { tab: { url: 'https://other.example/', windowId: 1, sessionId: '10' } }], forgetClosedTab: async (win, id) => { calls.push(['forget', win, id]); } },
      };
      w.performance.getEntriesByType = () => [{ type: 'navigate' }];
    };
    const withSettings = (extra) => { const fx = fixture(); Object.assign(fx.settings, extra); return fx; };
    const settle = () => new Promise(r => setTimeout(r, 30));

    test('off by default: nothing is re-opened', async () => {
      const calls = []; const a = await boot(fixture(), mock(calls));
      try { await settle(); assert.deepEqual(calls, []); } finally { await a.close(); }
    });

    test('on: re-opens the page in a new tab right after the current one, with a time-stamped marker', async () => {
      const calls = []; const a = await boot(withSettings({ focusPage: true }), mock(calls));
      try {
        await settle();
        assert.equal(calls.length, 1);
        const [, o] = calls[0];
        assert.equal(o.index, 4); assert.equal(o.active, true);
        assert.match(o.url, /^http:\/\/localhost\/#from=7\.\d+$/);
      } finally { await a.close(); }
    });

    test('a reload is left alone', async () => {
      const calls = []; const a = await boot(withSettings({ focusPage: true }), w => { mock(calls)(w); w.performance.getEntriesByType = () => [{ type: 'reload' }]; });
      try { await settle(); assert.deepEqual(calls, []); } finally { await a.close(); }
    });

    test('the re-opened tab closes the original and strips the marker', async () => {
      const calls = [];
      const a = await boot(fixture(), w => { mock(calls)(w); w.history.replaceState(null, '', '/#from=7.' + Date.now()); });
      try { await settle(); assert.deepEqual(calls, [['remove', 7]]); assert.equal(a.w.location.hash, ''); } finally { await a.close(); }
    });

    test('a stale marker never closes a tab', async () => {
      const calls = [];
      const a = await boot(fixture(), w => { mock(calls)(w); w.history.replaceState(null, '', '/#from=7.' + (Date.now() - 60000)); });
      try { await settle(); assert.deepEqual(calls, []); assert.equal(a.w.location.hash, ''); } finally { await a.close(); }
    });

    test('with the sessions permission the helper tab is forgotten, and only that one', async () => {
      const calls = [];
      const a = await boot(withSettings({ focusPage: true, focusForget: true }), w => { mock(calls)(w); w.history.replaceState(null, '', '/#from=7.' + Date.now()); });
      try { await settle(); assert.deepEqual(calls, [['remove', 7], ['forget', 1, '9']]); } finally { await a.close(); }
    });
  });

  describe('city search for the weather location', () => {
    const settle = () => new Promise(r => setTimeout(r, 40));
    const results = { results: [{ name: 'Lviv', admin1: 'Lviv Oblast', country: 'Ukraine', latitude: 49.8397, longitude: 24.0297 }, { name: 'Lviv', admin1: '', country: 'Elsewhere', latitude: 1.5, longitude: 2.5 }] };
    // only the geocoding call is answered; the weather tile's own request fails like an offline network
    const mockFetch = urls => async u => { if (!String(u).includes('geocoding')) throw new Error('offline'); urls.push(String(u)); return { ok: true, json: async () => results }; };
    const search = async (a, q) => {
      a.key('Comma');
      const d = a.w.document, input = d.querySelector('input[aria-label="Find a city"]');
      input.value = q;
      [...d.querySelectorAll('.mbox button')].find(b => b.textContent === 'Search').click();
      await settle();
      return d;
    };

    test('finds cities and fills the label and coordinates', async () => {
      const urls = []; const a = await boot(fixture(), w => { w.fetch = mockFetch(urls); });
      try {
        const d = await search(a, 'Lviv');
        assert.match(urls.at(-1), /^https:\/\/geocoding-api\.open-meteo\.com\/v1\/search\?name=Lviv&count=8&language=en/);
        const rows = [...d.querySelectorAll('.city-res .mi')];
        assert.equal(rows.length, 2);
        assert.match(rows[0].textContent, /Lviv, Lviv Oblast, Ukraine/);
        rows[0].click();
        const values = [...d.querySelectorAll('.mbox input')].map(i => i.value);
        assert.ok(values.includes('Lviv') && values.includes('49.8397') && values.includes('24.0297'));
      } finally { await a.close(); }
    });

    test('in the extension the optional host permission is requested first; a refusal stops the search', async () => {
      const urls = [], asked = [];
      const a = await boot(fixture(), w => {
        w.fetch = mockFetch(urls);
        w.browser = { runtime: { id: 'x', getURL: p => p }, permissions: { contains: async () => false, request: async o => { asked.push(o); return false; } } };
      });
      try {
        const d = await search(a, 'Lviv');
        assert.deepEqual(plain(asked), [{ origins: ['https://geocoding-api.open-meteo.com/*'] }]);
        assert.deepEqual(urls, [], 'no request without the permission');
        assert.match(d.querySelector('.city-res').textContent, /Permission was not granted/);
      } finally { await a.close(); }
    });

    test('a short query does nothing; a failed request shows a message', async () => {
      const a = await boot(fixture(), w => { w.fetch = async () => { throw new Error('offline'); }; });
      try {
        let d = await search(a, 'L');
        assert.equal(d.querySelector('.city-res').children.length, 0);
        d = await search(a, 'Lviv');
        assert.match(d.querySelector('.city-res').textContent, /Search failed/);
      } finally { await a.close(); }
    });
  });

  describe('toolbar popup reuses an open VEGA tab (no duplicates)', () => {
    const settle = () => new Promise(r => setTimeout(r, 30));
    async function runPopup(replies, buttonId) {
      const calls = [];
      const dom = new JSDOM(read('popup.html'), { url: 'http://localhost/popup.html', runScripts: 'outside-only' });
      const w = dom.window;
      w.browser = {
        runtime: { getURL: p => 'moz-extension://abc/' + p, sendMessage: async m => { calls.push(['msg', m.type, m.visibleOnly]); const r = replies.shift(); if (r === 'throw') throw new Error('no receiver'); return r; } },
        tabs: { update: async (id, o) => calls.push(['update', id, o]), create: async o => calls.push(['create', o.url]) },
        windows: { update: async (id, o) => calls.push(['window', id, o]) },
      };
      const realClose = w.close.bind(w);
      w.close = () => calls.push(['close']);
      w.eval(read('strings.js')); w.eval(read('popup.js'));
      w.document.getElementById(buttonId).click();
      await settle(); realClose();
      return calls;
    }

    test('an open VEGA tab is focused, nothing new is created', async () => {
      const calls = await runPopup([{ tabId: 5, windowId: 2 }], 'settings');
      assert.deepEqual(calls.map(c => c[0]), ['msg', 'update', 'window', 'close']);
      assert.deepEqual(plain(calls[0]), ['msg', 'vega:open-settings', true]);
      assert.deepEqual(plain(calls[1]), ['update', 5, { active: true }]);
    });

    test('visible pages are asked first, then any page', async () => {
      const calls = await runPopup([undefined, { tabId: 9, windowId: 1 }], 'open');
      assert.deepEqual(plain(calls.filter(c => c[0] === 'msg').map(c => [c[1], c[2]])), [['vega:focus', true], ['vega:focus', false]]);
      assert.deepEqual(plain(calls.find(c => c[0] === 'update')), ['update', 9, { active: true }]);
      assert.equal(calls.some(c => c[0] === 'create'), false);
    });

    test('with no VEGA tab open a new one is created (settings keep their ?settings marker)', async () => {
      const calls = await runPopup(['throw', 'throw'], 'settings');
      assert.deepEqual(plain(calls.filter(c => c[0] === 'create')), [['create', 'moz-extension://abc/index.html?settings']]);
    });
  });

  describe('a VEGA page answers the popup', () => {
    const settle = () => new Promise(r => setTimeout(r, 30));
    const boot2 = async (visibility) => {
      let listener = null;
      const a = await boot(fixture(), w => {
        w.browser = { runtime: { id: 'x', getURL: p => p, onMessage: { addListener: f => { listener = f; } } }, tabs: { getCurrent: async () => ({ id: 7, windowId: 2, index: 0 }) }, permissions: { contains: async () => false } };
        if (visibility) Object.defineProperty(w.document, 'visibilityState', { value: visibility, configurable: true });
      });
      return { a, ask: msg => new Promise(res => { let sync = listener(msg, {}, res); if (!sync) res(undefined); }) };
    };

    test('open-settings opens the dialog and returns this tab id', async () => {
      const { a, ask } = await boot2();
      try {
        const r = await ask({ type: 'vega:open-settings', visibleOnly: true });
        assert.deepEqual(plain(r), { tabId: 7, windowId: 2 });
        assert.ok(a.w.document.querySelector('.mbox'));
      } finally { await a.close(); }
    });

    test('a hidden tab stays silent when only visible tabs were asked', async () => {
      const { a, ask } = await boot2('hidden');
      try {
        assert.equal(await ask({ type: 'vega:open-settings', visibleOnly: true }), undefined);
        assert.equal(a.w.document.querySelector('.mbox'), null);
        assert.deepEqual(plain(await ask({ type: 'vega:focus', visibleOnly: false })), { tabId: 7, windowId: 2 });
      } finally { await a.close(); }
    });

    test('unrelated messages are ignored', async () => {
      const { a, ask } = await boot2();
      try { assert.equal(await ask({ type: 'something-else' }), undefined); } finally { await a.close(); }
    });
  });

  test('?settings opens the settings dialog (toolbar button and add-ons Preferences)', async () => {
    const a = await boot(fixture(), w => w.history.replaceState(null, '', '/index.html?settings'));
    try {
      assert.ok(a.w.document.querySelector('.mbox'));
      assert.equal(a.w.location.search, '');
    } finally { await a.close(); }
  });

  test('palette hides theme and move commands until the query asks for them', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      a.key('Slash', { key: '/' });
      const input = a.w.document.querySelector('.pi');
      const rows = q => { input.value = q; input.dispatchEvent(new a.w.Event('input')); return [...a.w.document.querySelectorAll('.pr .plb')].map(e => e.textContent); };
      assert.equal(rows('gi').some(t => t.startsWith('Theme:') || t.startsWith('Move tile')), false);
      assert.ok(rows('theme nord').some(t => t.includes('Nord')));
      assert.ok(rows('move tile to chill').some(t => t.includes('chill')));
    } finally { await a.close(); }
  });

  test('new workspace gets a short name, toast has no stray "null"', async () => {
    const a = await boot(null);
    try {
      a.w.document.querySelector('#wsbar .wsb:last-child').click();
      const st = a.saved();
      assert.equal(st.ws.at(-1).name, S.wsDefaultName);
      assert.equal(a.w.document.querySelector('#toast').textContent.includes('null'), false);
    } finally { await a.close(); }
  });

  test('theme-boot applies the saved theme and accent before the app runs', () => {
    const html = read('index.html');
    const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only' });
    dom.window.localStorage.setItem(stateLib.KEY, JSON.stringify({ settings: { theme: 'nord', accent: '#ff8800' } }));
    dom.window.eval(read('theme-boot.js'));
    const root = dom.window.document.documentElement;
    assert.equal(root.dataset.theme, 'nord');
    assert.equal(root.style.getPropertyValue('--accent'), '#ff8800');
    dom.window.close();
  });
});

/* ───────────── themes: WCAG AA ───────────── */
describe('themes', () => {
  const css = read('themes.css');
  const themes = {};
  for (const m of css.matchAll(/(?::root, )?\[data-theme="(\w+)"\]\s*\{([^}]*)\}/g)) {
    themes[m[1]] = Object.fromEntries([...m[2].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map(x => [x[1], x[2]]));
  }
  const lum = hex => {
    const c = [1, 3, 5].map(i => { const v = parseInt(hex.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  test('the theme list in strings.js matches themes.css', () => {
    assert.deepEqual(Object.keys(themes).sort(), Object.keys(S.themes).sort());
    assert.ok(Object.keys(themes).length >= 7);
  });

  for (const [name, t] of Object.entries(themes)) {
    test(`${name}: every token is defined`, () => {
      for (const k of ['bg', 'surface', 'raise', 'fg', 'hi', 'dim', 'accent', 'hot', 'red', 'yellow', 'green', 'aqua', 'blue', 'purple', 'on-accent', 'on-hot', 'shade']) assert.ok(t[k], `--${k}`);
    });
    test(`${name}: text and dim text pass AA on bg, surface and raise`, () => {
      for (const fg of ['fg', 'hi', 'dim']) for (const bg of ['bg', 'surface', 'raise']) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${fg}/${bg} = ${ratio(t[fg], t[bg]).toFixed(2)}`);
    });
    test(`${name}: accent and highlight pass AA as text on panel surfaces`, () => {
      for (const fg of ['accent', 'hot']) for (const bg of ['bg', 'surface', 'raise']) assert.ok(ratio(t[fg], t[bg]) >= 4.5, `${fg}/${bg} = ${ratio(t[fg], t[bg]).toFixed(2)}`);
    });
    test(`${name}: button text passes AA on accent and highlight fills`, () => {
      assert.ok(ratio(t['on-accent'], t.accent) >= 4.5, 'on-accent');
      assert.ok(ratio(t['on-hot'], t.hot) >= 4.5, 'on-hot');
    });
    test(`${name}: semantic colours are distinguishable on the surface (>= 3:1)`, () => {
      for (const k of ['red', 'yellow', 'green', 'aqua', 'blue', 'purple']) assert.ok(ratio(t[k], t.surface) >= 3, `${k} = ${ratio(t[k], t.surface).toFixed(2)}`);
    });
  }
});

/* ───────────── release hygiene ───────────── */
describe('release', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const html = read('index.html');

  test('manifest keeps the gecko id and data_collection_permissions, version is bumped', () => {
    assert.equal(manifest.browser_specific_settings.gecko.id, 'vega@happymaxxx.local');
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
    assert.equal(manifest.manifest_version, 3);
    const [a, b] = manifest.version.split('.').map(Number);
    assert.ok(a > 0 || b >= 3, `version ${manifest.version} must be at least 0.3.0`);
    assert.equal(manifest.permissions, undefined, 'no new required permissions');
  });

  test('manifest icons exist and are PNGs of the declared size', () => {
    const icons = manifest.icons;
    assert.ok(icons && Object.keys(icons).length >= 4, 'icons declared');
    for (const [size, file] of Object.entries(icons)) {
      const buf = fs.readFileSync(path.join(ROOT, file));
      assert.equal(buf.subarray(1, 4).toString(), 'PNG', file);
      assert.deepEqual([buf.readUInt32BE(16), buf.readUInt32BE(20)], [+size, +size], `${file} is ${size}x${size}`);
    }
    assert.match(html, /<link rel="icon"[^>]+href="icons\/icon-32\.png"/);
  });

  test('no page has inline scripts, inline handlers or remote code (extension CSP)', () => {
    for (const f of pages) {
      const h = read(f);
      assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(h), false, `${f}: inline <script>`);
      assert.equal(/\son[a-z]+\s*=/i.test(h), false, `${f}: inline handler`);
      assert.equal(/<script[^>]+src="https?:/i.test(h), false, `${f}: remote script`);
      assert.equal(/<link[^>]+href="https?:/i.test(h), false, `${f}: remote stylesheet`);
    }
  });

  test('theme-boot.js is a plain script in <head> before the stylesheets finish painting', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    assert.match(head, /<script src="theme-boot\.js"><\/script>/);
  });

  // every file the extension can load: referenced by the manifest, or by an html page that is
  const manifestFiles = (() => { const out = []; const walk = v => { if (typeof v === 'string' && /\.(html|png|js|css)$/.test(v)) out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; walk(manifest); return out; })();
  const pages = [...new Set(['index.html', ...manifestFiles.filter(f => f.endsWith('.html'))])];
  const pageRefs = f => [...read(f).matchAll(/(?:src|href)="([^"#?]+)/g)].map(m => m[1]);

  test('every file the extension loads exists, and no stray root file is forgotten', () => {
    const shipped = new Set(['manifest.json', ...manifestFiles, ...pages, ...pages.flatMap(pageRefs)]);
    for (const f of shipped) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} is referenced but missing`);
    const dev = new Set(['README.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE', 'package.json', 'package-lock.json', '.gitignore']);
    for (const f of fs.readdirSync(ROOT, { withFileTypes: true })) {
      if (!f.isFile() || f.name.startsWith('.') || dev.has(f.name) || f.name.endsWith('.zip')) continue;
      assert.ok(shipped.has(f.name), `${f.name} is in the repo root but nothing loads it: it would be missing from (or pointless in) the release zip`);
    }
  });

  test('toolbar popup and options entry point are wired to existing pages', () => {
    assert.equal(manifest.action.default_popup, 'popup.html');
    assert.equal(manifest.options_ui.page, 'options.html');
    assert.match(read('options.js'), /index\.html\?settings/);
    assert.match(read('popup.js'), /\?settings/);
  });

  test('optional permissions: sessions is optional only, never required', () => {
    assert.ok(manifest.optional_permissions.includes('sessions'));
    assert.equal((manifest.permissions || []).includes('sessions'), false);
  });

  test('no literal colours outside themes.css (except ink tokens and seed data)', () => {
    const lit = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    const css = read('style.css').split('\n').filter(l => !l.includes('--ink-'));
    css.forEach((l, i) => assert.equal(lit.test(l), false, `style.css:${i + 1}: ${l.trim()}`));
    read('app.js').split('\n').forEach((l, i) => assert.equal(lit.test(l.replace(/'#' *\+/g, '')), false, `app.js:${i + 1}: ${l.trim()}`));
  });

  test('no personal data in tracked files (links, accounts, places, e-mail)', () => {
    // Words are assembled from pieces so this file does not contain them itself.
    const banned = [['py', 'tek'], ['vn', 'tu.edu'], ['jet', 'iq'], ['Він', 'ниц'], ['Vin', 'nytsia'], ['mpa', 'tik'], ['gmail', '.com>']].map(p => p.join(''));
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const files = walk(ROOT).filter(f => /\.(js|json|css|html|md|txt)$/.test(f) && !f.endsWith('package-lock.json'));
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const w of banned) assert.equal(text.includes(w), false, `${path.relative(ROOT, f)} contains "${w}"`);
    }
  });

  test('all hotkeys use event.code (layout independent)', () => {
    const app = read('app.js');
    assert.ok(/e\.code/.test(app));
    assert.equal(/e\.key\s*===\s*'[a-z]'/.test(app), false, 'letter hotkeys must not use e.key');
  });
});
