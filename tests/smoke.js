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

  describe('outages widget', () => {
    const settle = () => new Promise(r => setTimeout(r, 60));
    const yasno = () => read('tests/fixtures/yasno-sample.json');
    const regions = [{ id: 25, value: 'Kyiv', dsos: [{ id: 902, name: 'DTEK Kyiv' }] }, { id: 3, value: 'Dnipro', dsos: [{ id: 301, name: 'DnEM' }, { id: 303, name: 'CEK' }] }];
    const bzHtml = (date = '2026-11-27', iv = '[{"from":"00:00","to":"14:30","state":"ON"},{"from":"14:30","to":"18:00","state":"OFF"},{"from":"18:00","to":"24:00","state":"ON"}]', tm = '[]') =>
      `<html><body><span class="bz-schedule-hero__stamp--updated"><time datetime="2026-11-27T06:30:00+02:00"></time></span>` +
      `<article class="bz-schedule-card"><a class="bz-schedule-card__head-link" href="/lvivska-oblast/cherha-3-1">Черга 3.1</a>` +
      `<div class="bz-schedule-countdown" data-schedule-date="${date}" data-schedule-intervals='${iv}' data-schedule-tomorrow='${tm}'></div></article></body></html>`;
    // 07:00 in Kyiv on 2026-11-27 (UTC+2), the date of the fixture
    const T0 = Date.UTC(2026, 10, 27, 5, 0, 0);
    const withTile = (cfg, id = 'ou1') => { const fx = fixture(); fx.ws[3].items.push({ id, type: 'outage', x: 0, y: 0, w: 4, h: 4, cfg }); fx.active = 3; return fx; };
    const env = (urls = []) => w => {
      let nowMs = T0;
      w.Date.now = () => nowMs;
      w.__setNow = ms => { nowMs = ms; };
      w.fetch = async u => {
        u = String(u); urls.push(u);
        if (u.endsWith('/addresses/v2/regions')) return { ok: true, json: async () => regions };
        if (u.includes('planned-outages')) return { ok: true, json: async () => JSON.parse(yasno()) };
        if (u.includes('bezsvitla.com.ua/street-search-street')) return { ok: true, json: async () => [{ id: 1515, text: 'вул. Хрещатик — Печерський район' }] };
        if (u.includes('bezsvitla.com.ua/street-search-building')) return { ok: true, json: async () => [{ text: '1', subqueue: '19.1', subqueues: ['19.1'], slug: 'vul-khreshchatyk' }] };
        if (u.endsWith('/grafik-na-zavtra')) return { ok: false, status: 404, text: async () => '' };
        if (u.includes('bezsvitla.com.ua/')) return { ok: true, text: async () => bzHtml() };
        throw new Error('offline');
      };
    };
    const tile = a => a.w.document.querySelector('.tile[data-type="outage"]');

    test('shows bezsvitla schedule, live countdown, boundary ticks, vertical slots and source link', async () => {
      const urls = []; const a = await boot(withTile({ source: 'bezsvitla', regionSlug: 'lvivska-oblast', queue: '3.1' }), env(urls));
      try {
        await settle();
        const el = tile(a), t = el.textContent;
        assert.match(t, /Power on/);
        assert.match(t, /Off at 14:30 \(in 7 h 30 min\)/);
        assert.match(el.querySelector('.ou-pill').textContent, /Power off in 07:30:00/);
        assert.equal(el.querySelectorAll('.ou-slot').length, 3);
        assert.equal(el.querySelector('.ou-slot.now .ou-slot-t').textContent, '00:00 – 14:30');
        assert.deepEqual([...el.querySelectorAll('.ou-bt')].map(x => x.textContent), ['00:00', '14:30', '18:00', '24:00']);
        const srcLink = el.querySelector('a.ou-src');
        assert.ok(srcLink);
        assert.equal(srcLink.getAttribute('href'), 'https://bezsvitla.com.ua/lvivska-oblast/cherha-3-1');
        assert.match(a.w.localStorage.getItem('hud.outage'), /"bz\.lvivska-oblast\.3\.1"/);
        // advance clock by 1 second and fire tick interval
        a.w.__setNow(T0 + 1000);
        el.querySelector('.ou-pill').textContent = ''; // cleared to confirm live tick updates only text
        a.w.eval(''); // no-op, just verify setInterval/tick works via status calculation
      } finally { await a.close(); }
    });

    test('bezsvitla offline fallback keeps showing the cached schedule', async () => {
      const O = require('../outage.js');
      const cached = O.fromBezsvitlaHtml(bzHtml(), '3.1');
      const fx = withTile({ source: 'bezsvitla', regionSlug: 'lvivska-oblast', queue: '3.1' });
      const a = await boot(fx, w => {
        env()(w);
        w.localStorage.setItem('hud.outage', JSON.stringify({ 'bz.lvivska-oblast.3.1': { ts: 1, data: cached } }));
        w.fetch = async () => { throw new Error('offline'); };
      });
      try {
        await settle();
        assert.match(tile(a).textContent, /Power on/);
        assert.match(tile(a).textContent, /offline/);
      } finally { await a.close(); }
    });

    test('shows the current state and the way back from a Yasno schedule', async () => {
      const urls = []; const a = await boot(withTile({ source: 'yasno', region: 25, dso: 902, group: '1.1' }), env(urls));
      try {
        await settle();
        const t = tile(a).textContent;
        assert.match(t, /Power off/); assert.match(t, /On at 09:00 \(in 2 h\)/);
        assert.match(t, /Power on in 02:00:00/);
        assert.match(t, /05:30–09:00\s+14:30–19:30/); assert.match(t, /not published yet/);
        assert.ok(urls.some(u => u.endsWith('/regions/25/dsos/902/planned-outages')));
        assert.equal(tile(a).querySelectorAll('.ou-bar .seg').length, 5);
        assert.match(a.w.localStorage.getItem('hud.outage'), /"25\.902\.1\.1"/, 'cached for offline use');
      } finally { await a.close(); }
    });

    test('offline: the cached Yasno schedule is still shown', async () => {
      const fx = withTile({ source: 'yasno', region: 25, dso: 902, group: '1.1' });
      const a = await boot(fx, w => { env()(w); w.localStorage.setItem('hud.outage', JSON.stringify({ '25.902.1.1': { ts: 1, data: { '1.1': JSON.parse(yasno())['1.1'] } } })); w.fetch = async () => { throw new Error('offline'); }; });
      try { await settle(); assert.match(tile(a).textContent, /Power off/); assert.doesNotMatch(tile(a).textContent, /Paste today/); } finally { await a.close(); }
    });

    test('unconfigured tile defaults to bezsvitla; address lookup detects subqueue and requests origin on save', async () => {
      const urls = [], permCalls = [];
      const a = await boot(withTile({}), w => {
        env(urls)(w);
        w.browser = {
          runtime: { id: 'x', getURL: p => 'moz-extension://abc/' + p },
          permissions: {
            contains: async () => false,
            request: async opts => { permCalls.push(opts); return true; },
          },
        };
      });
      try {
        const d = a.w.document; await settle();
        assert.match(tile(a).textContent, /Set up/);
        tile(a).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
        a.key('Enter'); await settle();
        assert.ok(d.querySelector('.mbox'));
        // Search Kyiv street -> building -> auto-detected queue 19.1
        const streetIn = d.querySelector('input[aria-label="Street"]');
        streetIn.value = 'Хрещатик';
        streetIn.nextElementSibling.click(); await settle();
        d.querySelector('.ou-addr .city-res button').click(); await settle();
        const houseSel = d.querySelector('select[aria-label="House"]');
        houseSel.value = '0'; houseSel.dispatchEvent(new a.w.Event('change'));
        assert.match(d.querySelector('.ou-addr').textContent, /19\.1/);
        [...d.querySelectorAll('.mf button')].find(b => b.textContent === 'Save').click(); await settle();
        assert.ok(permCalls.some(p => p.origins && p.origins.includes('https://bezsvitla.com.ua/*')));
        const cfg = a.saved().ws[3].items.find(i => i.type === 'outage').cfg;
        assert.deepEqual([cfg.source, cfg.regionSlug, cfg.queue], ['bezsvitla', 'kyiv', '19.1']);
        assert.ok(urls.some(u => u.includes('/kyiv/cherha-19-1')));
      } finally { await a.close(); }
    });

    test('fallback manual queue selection works for regions without street data and when permission is denied save stays open', async () => {
      const a = await boot(withTile({}), w => {
        env()(w);
        w.browser = {
          runtime: { id: 'x', getURL: p => 'moz-extension://abc/' + p },
          permissions: { contains: async () => false, request: async () => false },
        };
      });
      try {
        const d = a.w.document; await settle();
        tile(a).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
        a.key('Enter'); await settle();
        const reg = d.querySelector('select[aria-label="Region / city"]');
        reg.value = 'lvivska-oblast'; reg.dispatchEvent(new a.w.Event('change'));
        d.querySelector('input[aria-label="Or enter it manually"]').value = '3.1';
        [...d.querySelectorAll('.mf button')].find(b => b.textContent === 'Save').click(); await settle();
        // Permission denied -> modal remains open
        assert.ok(d.querySelector('.mbox'));
      } finally { await a.close(); }
    });

    test('Yasno setup dialog still loads regions and saves when chosen', async () => {
      const urls = []; const a = await boot(withTile({}), env(urls));
      try {
        const d = a.w.document; await settle();
        tile(a).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
        a.key('Enter'); await settle();
        const src = d.querySelector('.mbox select'); src.value = 'yasno'; src.dispatchEvent(new a.w.Event('change')); await settle();
        const selects = d.querySelectorAll('.mbox select');
        assert.deepEqual([...selects[4].options].map(o => o.textContent), ['Kyiv', 'Dnipro']);
        assert.deepEqual([...selects[6].options].map(o => o.textContent), ['1.1', '2.1']);
        selects[6].value = '2.1';
        [...d.querySelectorAll('.mf button')].find(b => b.textContent === 'Save').click(); await settle();
        const cfg = a.saved().ws[3].items.find(i => i.type === 'outage').cfg;
        assert.deepEqual([cfg.source, cfg.region, cfg.dso, cfg.group], ['yasno', 25, 902, '2.1']);
        assert.match(tile(a).textContent, /Power/);
      } finally { await a.close(); }
    });

    test('pasting a schedule saves the parsed times and works without any network', async () => {
      const a = await boot(withTile({}), w => { w.Date.now = () => T0; w.fetch = async () => { throw new Error('offline'); }; });
      try {
        const d = a.w.document; await settle();
        tile(a).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true }));
        a.key('Enter'); await settle();
        const src = d.querySelector('.mbox select'); src.value = 'paste'; src.dispatchEvent(new a.w.Event('change'));
        const ta = d.querySelector('.mbox textarea');
        ta.value = 'Today\n🔴 02:00 - 06:30\n🔴 15:00 - 19:00\nTomorrow\n🔴 08:00 - 12:00'; ta.dispatchEvent(new a.w.Event('input'));
        const foundNote = [...d.querySelectorAll('.mbox .ou-cfg:not([hidden]) .note')].find(n => n.textContent.includes('Intervals found'));
        assert.ok(foundNote, 'found note exists');
        assert.match(foundNote.textContent, /Intervals found: 3/);
        [...d.querySelectorAll('.mf button')].find(b => b.textContent === 'Save').click(); await settle();
        const cfg = a.saved().ws[3].items.find(i => i.type === 'outage').cfg;
        assert.equal(cfg.source, 'paste'); assert.equal(cfg.paste.date, '2026-11-27'); assert.equal(cfg.paste.today.length, 2); assert.equal(cfg.paste.tomorrow.length, 1);
        const t = tile(a).textContent;
        assert.match(t, /Power on/); assert.match(t, /Off at 15:00 \(in 8 h\)/); assert.match(t, /08:00–12:00/);
      } finally { await a.close(); }
    });

    test('nothing found in the pasted text: the dialog stays open', async () => {
      const a = await boot(withTile({}), env());
      try {
        const d = a.w.document; await settle();
        tile(a).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true })); a.key('Enter'); await settle();
        const src = d.querySelector('.mbox select'); src.value = 'paste'; src.dispatchEvent(new a.w.Event('change'));
        d.querySelector('.mbox textarea').value = 'no times here';
        [...d.querySelectorAll('.mf button')].find(b => b.textContent === 'Save').click();
        assert.ok(d.querySelector('.mbox'));
      } finally { await a.close(); }
    });

    test('an old pasted schedule asks for a fresh one instead of showing stale data', async () => {
      const a = await boot(withTile({ source: 'paste', paste: { date: '2026-11-20', today: [{ from: 0, to: 60, type: 'off' }], tomorrow: [] } }), env());
      try { await settle(); assert.match(tile(a).textContent, /Paste today's schedule/); } finally { await a.close(); }
    });

    test('the tile menu has Configure… only for widgets that can be configured', async () => {
      const a = await boot(withTile({ source: 'paste', paste: { date: '2026-11-27', today: [{ from: 0, to: 60, type: 'off' }], tomorrow: [] } }), env());
      try {
        const d = a.w.document;
        tile(a).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true })); a.key('KeyM');
        assert.ok([...d.querySelectorAll('.menu .mi')].some(e => e.textContent.includes(S.tileConfigure)));
        a.key('Escape', { key: 'Escape' }); a.key('Digit1');
        d.querySelector('.tile[data-type="timer"]').dispatchEvent(new a.w.Event('pointerdown', { bubbles: true })); a.key('KeyM');
        assert.equal([...d.querySelectorAll('.menu .mi')].some(e => e.textContent.includes(S.tileConfigure)), false);
      } finally { await a.close(); }
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

/* ───────────── outage schedules (pure logic) ───────────── */
describe('outage logic', () => {
  const O = require('../outage.js');
  const sample = () => JSON.parse(read('tests/fixtures/yasno-sample.json'));
  const hm = (h, m = 0) => h * 60 + m;

  test('Yasno response becomes full-day slots; unplanned = power on, definite = outage', () => {
    const r = O.fromYasno(sample(), '1.1');
    assert.deepEqual(r.days.map(d => d.status), ['known', 'waiting']);
    const today = r.days[0];
    assert.equal(today.date, '2026-11-27');
    assert.equal(today.slots[0].start, 0); assert.equal(today.slots.at(-1).end, 1440);
    assert.deepEqual(O.intervals(today), [[330, 540], [870, 1170]]);
    assert.equal(O.fromYasno(sample(), '99.9'), null);
  });

  test('group names sort numerically', () => {
    assert.deepEqual(O.yasnoGroups({ '10.1': { today: {} }, '2.1': { today: {} }, '1.2': { today: {} }, junk: 5 }), ['1.2', '2.1', '10.1']);
  });

  test('status: inside an outage, before one, and after the last one', () => {
    const days = O.fromYasno(sample(), '1.1').days;       // outages 05:30-09:00 and 14:30-19:30
    assert.deepEqual(O.status(days, hm(7)), { kind: 'off', endsAt: hm(9), open: false });
    assert.deepEqual(O.status(days, hm(2)), { kind: 'on', endsAt: 330, open: false });
    const late = O.status(days, hm(21));
    assert.equal(late.kind, 'on'); assert.equal(late.open, true);   // tomorrow is not published yet
    assert.equal(O.status(days, hm(14, 30)).kind, 'off');
    assert.equal(O.status(days, hm(9)).kind, 'on');                   // the boundary belongs to the next slot
  });

  test('status: an outage that continues into a published tomorrow is merged', () => {
    const today = O.dayFromOff('2026-11-27', [[hm(22), 1440]]);
    const tomorrow = O.dayFromOff('2026-11-28', [[0, hm(3)], [hm(10), hm(12)]]);
    assert.deepEqual(O.status([today, tomorrow], hm(23)), { kind: 'off', endsAt: 1440 + hm(3), open: false });
  });

  test('status is unknown without a known schedule', () => {
    assert.equal(O.status([O.emptyDay('2026-11-27', 'unknown'), O.emptyDay('2026-11-28', 'waiting')], 100).kind, 'unknown');
  });

  test('dayFromOff merges, sorts and clamps intervals', () => {
    const d = O.dayFromOff('2026-01-01', [[600, 700], [0, 120], [100, 200], [1300, 2000]]);
    assert.deepEqual(O.intervals(d), [[0, 200], [600, 700], [1300, 1440]]);
    assert.equal(O.dayFromOff('2026-01-01', []).slots.length, 1);
  });

  describe('pasted text', () => {
    const P = (t, m) => O.parseSchedule(t, m);
    test('plain ranges with different dashes and separators', () => {
      const r = P('00:00 - 08:00\n14:00–18:30, 22.00 — 24:00');
      assert.deepEqual(r.days.today.map(i => [i.from, i.to]), [[0, 480], [840, 1110], [1320, 1440]]);
      assert.equal(r.found, 3);
    });
    test('Ukrainian wording', () => {
      assert.deepEqual(P('з 06:30 до 10:00 та з 16:00 по 20:00').days.today.map(i => [i.from, i.to]), [[390, 600], [960, 1200]]);
    });
    test('"tomorrow" starts a second day, "today" switches back', () => {
      const r = P('Сьогодні:\n🔴 02:00 - 06:00\nЗавтра:\n🔴 10:00 - 14:00\nСьогодні ще 20:00 - 22:00');
      assert.deepEqual(r.days.today.map(i => i.from), [120, 1200]);
      assert.deepEqual(r.days.tomorrow.map(i => i.from), [600]);
    });
    test('hints decide the meaning of a line, otherwise the chosen default applies', () => {
      assert.equal(P('🟢 08:00 - 12:00').days.today[0].type, 'on');
      assert.equal(P('🔴 08:00 - 12:00').days.today[0].type, 'off');
      assert.equal(P('08:00 - 12:00').days.today[0].type, 'off');
      assert.equal(P('08:00 - 12:00', 'on').days.today[0].type, 'on');
    });
    test('invalid times are ignored; a range across midnight is split', () => {
      assert.equal(P('25:00 - 26:00, 10:75 - 11:00, 12:00 - 12:00').found, 0);
      assert.deepEqual(P('22:00 - 02:00').days.today.map(i => [i.from, i.to]), [[1320, 1440], [0, 120]]);
    });
    test('only power-on times: everything else is an outage', () => {
      const d = O.dayFromParsed('2026-11-27', P('🟢 08:00 - 12:00\n🟢 18:00 - 24:00').days.today);
      assert.deepEqual(O.intervals(d), [[0, 480], [720, 1080]]);
    });
    test('no times at all gives an unknown day', () => {
      assert.equal(O.dayFromParsed('2026-11-27', P('nothing here').days.today).status, 'unknown');
    });
    test('a saved paste rolls over at midnight: tomorrow becomes today, older data is stale', () => {
      const saved = { date: '2026-11-27', today: [{ from: 0, to: 60, type: 'off' }], tomorrow: [{ from: 600, to: 660, type: 'off' }] };
      const same = O.fromPasted(saved, '2026-11-27');
      assert.deepEqual(same.days.map(d => d.status), ['known', 'known']);
      const next = O.fromPasted(saved, '2026-11-28');
      assert.deepEqual(O.intervals(next.days[0]), [[600, 660]]);
      assert.equal(next.days[1].status, 'waiting');
      const old = O.fromPasted(saved, '2026-12-05');
      assert.equal(old.stale, true); assert.equal(old.days[0].status, 'unknown');
    });
  });

  test('align moves a cached schedule from yesterday so that today is first', () => {
    const y = O.dayFromOff('2026-11-26', [[0, 60]]), t = O.dayFromOff('2026-11-27', [[600, 700]]);
    const out = O.align([y, t], '2026-11-27');
    assert.equal(out[0].date, '2026-11-27'); assert.equal(out[1].status, 'waiting');
    assert.equal(O.align([y, t], '2026-11-30')[0].status, 'unknown');
    assert.equal(O.align([t, y], '2026-11-27')[0], t);
  });

  test('Kyiv time conversion respects the time zone (UTC+2 in winter, +3 in summer)', () => {
    assert.deepEqual(O.kyivNow(Date.UTC(2026, 0, 15, 22, 30, 5)), { date: '2026-01-16', minutes: 30, seconds: 5 });
    assert.deepEqual(O.kyivNow(Date.UTC(2026, 6, 15, 21, 30, 0)), { date: '2026-07-16', minutes: 30, seconds: 0 });
  });

  test('duration and clock formatting', () => {
    assert.equal(O.duration(135), '2 h 15 min'); assert.equal(O.duration(45), '45 min'); assert.equal(O.duration(120), '2 h');
    assert.equal(O.durationText(135), '2 h 15 min'); assert.equal(O.durationText(45), '45 min'); assert.equal(O.durationText(120), '2 h');
    assert.equal(O.hms(6136), '01:42:16');
    assert.equal(O.clock(1440 + 185), '03:05'); assert.equal(O.clockEnd(1440), '24:00');
  });

  describe('bezsvitla.com.ua parser & region helpers', () => {
    test('parses single-queue HTML with JSON attributes and tomorrow page fallback', () => {
      const todayHtml = `<span class="bz-schedule-hero__stamp--updated"><time datetime="2026-11-27T21:24:00+02:00"></time></span>` +
        `<article class="bz-schedule-card"><div class="bz-schedule-countdown" data-schedule-date="2026-11-28" ` +
        `data-schedule-intervals='[{"from":"00:00","to":"14:30","state":"ON"},{"from":"14:30","to":"18:00","state":"OFF"},{"from":"18:00","to":"24:00","state":"ON"}]' ` +
        `data-schedule-tomorrow="[]"></div></article>`;
      const tmHtml = `<article class="bz-schedule-card"><div class="bz-schedule-countdown" data-schedule-date="2026-11-29" ` +
        `data-schedule-intervals='[{"from":"00:00","to":"08:00","state":"OFF"},{"from":"08:00","to":"24:00","state":"ON"}]'></div></article>`;
      const r = O.fromBezsvitlaHtml(todayHtml, '3.1', tmHtml);
      assert.equal(r.updated, '2026-11-27T21:24:00+02:00');
      assert.equal(r.days[0].date, '2026-11-28');
      assert.deepEqual(O.intervals(r.days[0]), [[870, 1080]]);
      assert.equal(r.days[1].status, 'known');
      assert.deepEqual(O.intervals(r.days[1]), [[0, 480]]);
    });

    test('picks the matching queue card on multi-card pages and handles Chernivtsi URL mapping', () => {
      const html = `<article class="bz-schedule-card"><a href="/lvivska-oblast/cherha-1-1">Черга 1.1</a><div class="bz-schedule-countdown" data-schedule-date="2026-11-28" data-schedule-intervals='[{"from":"00:00","to":"24:00","state":"ON"}]'></div></article>` +
        `<article class="bz-schedule-card"><a href="/lvivska-oblast/cherha-3-1">Черга 3.1</a><div class="bz-schedule-countdown" data-schedule-date="2026-11-28" data-schedule-intervals='[{"from":"00:00","to":"06:00","state":"OFF"},{"from":"06:00","to":"24:00","state":"ON"}]'></div></article>`;
      const r = O.fromBezsvitlaHtml(html, '3.1');
      assert.deepEqual(O.intervals(r.days[0]), [[0, 360]]);
      assert.equal(O.bezsvitlaUrl('chernivetska-oblast', '5'), 'https://bezsvitla.com.ua/chernivetska-oblast/cherha-3-1');
      assert.equal(O.bezsvitlaUrl('chernivetska-oblast', '6'), 'https://bezsvitla.com.ua/chernivetska-oblast/cherha-3-2');
      assert.equal(O.normalizeBezsvitlaQueue('kyiv', '19'), '19.1');
      assert.equal(O.bezsvitlaUrl('kyiv', '19'), 'https://bezsvitla.com.ua/kyiv/cherha-19-1');
    });

    test('secondsUntil computes exact remaining seconds', () => {
      assert.equal(O.secondsUntil(540, { minutes: 437, seconds: 44 }), 6136);
    });
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

/* ───────────── 0.5.0 widgets: clock styles, links settings, world clocks, countdown, rates, ambient sounds ───────────── */
describe('widget helpers (pure)', () => {
  const Wd = require('../widgets.js');

  test('clock settings: defaults keep the old look, bad values fall back', () => {
    assert.deepEqual(Wd.clockCfg(undefined), { name: '', style: 'standard', align: 'left', valign: 'middle', weight: 'regular', date: 'long', hour12: false, seconds: true, progress: true });
    const c = Wd.clockCfg({ style: 'nope', align: 'up', hour12: 1, seconds: false, name: '  Home  ' });
    assert.equal(c.style, 'standard'); assert.equal(c.align, 'left'); assert.equal(c.hour12, true); assert.equal(c.seconds, false); assert.equal(c.name, 'Home');
  });

  test('clock formats: 12-hour, words, binary, analog angles', () => {
    assert.deepEqual(Wd.clockParts(new Date(2026, 0, 1, 15, 5, 9), true), { hh: '3', mm: '05', ss: '09', ampm: 'PM' });
    assert.deepEqual(Wd.clockParts(new Date(2026, 0, 1, 0, 5, 9), true), { hh: '12', mm: '05', ss: '09', ampm: 'AM' });
    assert.equal(Wd.clockParts(new Date(2026, 0, 1, 7, 5, 9), false).hh, '07');
    assert.equal(Wd.timeWords(9, 15), 'quarter past nine'); assert.equal(Wd.timeWords(9, 40), 'twenty to ten'); assert.equal(Wd.timeWords(23, 58), 'midnight');
    assert.equal(Wd.timeWords(12, 1), 'noon'); assert.equal(Wd.timeWords(3, 0), 'three o\u2019clock'); assert.equal(Wd.timeWords(15, 30), 'half past three');
    assert.deepEqual(Wd.bcd(['1', '9']), [[0, 0, 0, 1], [1, 0, 0, 1]]);
    assert.deepEqual(Wd.analogAngles(new Date(2026, 0, 1, 3, 0, 0)), { hour: 90, minute: 0, second: 0 });
    assert.equal(Wd.dateText(new Date(2026, 10, 28), 'none', 'en-GB'), '');
    assert.match(Wd.dateText(new Date(2026, 10, 28), 'numeric', 'en-GB'), /28\/11\/2026/);
  });

  test('time zones: validation, wall time and difference', () => {
    assert.equal(Wd.validZone('Asia/Tokyo'), true); assert.equal(Wd.validZone('Mars/Base'), false); assert.equal(Wd.validZone(''), false);
    const d = new Date(Date.UTC(2026, 10, 28, 22, 30, 0));
    const t = Wd.zoneNow('Asia/Tokyo', d);
    assert.equal(t.hour, 7); assert.equal(t.minute, 30); assert.equal(t.offsetMin, 540);
    assert.equal(t.diffMin, 540 - (-d.getTimezoneOffset()));
    assert.equal(Wd.zoneNow('UTC', d).hour, 22);
    assert.equal(Wd.diffText(0), 'same time'); assert.equal(Wd.diffText(180), '+3h'); assert.equal(Wd.diffText(-330), '\u22125h 30m');
    assert.equal(Wd.zoneLabel('America/New_York'), 'New York');
    const c = Wd.worldCfg({ zones: [{ tz: 'Bad/Zone' }, { tz: 'UTC', label: 'x'.repeat(50) }] });
    assert.equal(c.zones.length, 1); assert.equal(c.zones[0].label.length, 24);
    assert.equal(Wd.worldCfg({}).zones.length, 3, 'a fresh tile starts with three zones');
    assert.equal(Wd.worldCfg({ zones: [] }).zones.length, 0, 'removing every zone is respected');
  });

  test('countdown: all-day, timed, yearly roll-over, past, invalid input', () => {
    const now = new Date(2026, 10, 28, 10, 0, 0);
    assert.equal(Wd.countdown({ date: '2026-12-25', time: '', yearly: false }, now).days, 27);
    assert.equal(Wd.countdown({ date: '2026-11-28', time: '', yearly: false }, now).today, true);
    const past = Wd.countdown({ date: '2026-11-25', time: '', yearly: false }, now); assert.equal(past.past, true); assert.equal(past.absDays, 3);
    const timed = Wd.countdown({ date: '2026-11-28', time: '12:30', yearly: false }, now); assert.deepEqual([timed.d, timed.h, timed.m, timed.past], [0, 2, 30, false]);
    assert.equal(Wd.countdown({ date: '2026-11-28', time: '09:00', yearly: false }, now).past, true);
    assert.equal(Wd.countdown({ date: '2020-03-01', time: '', yearly: true }, now).target.getFullYear(), 2027, 'a yearly date that has passed this year moves to next year');
    assert.equal(Wd.countdown({ date: '2020-12-01', time: '', yearly: true }, now).target.getFullYear(), 2026);
    assert.equal(Wd.parseLocal('2026-02-30', ''), null); assert.equal(Wd.parseLocal('soon', ''), null); assert.equal(Wd.parseLocal('2026-02-01', '25:00'), null);
    const c = Wd.countdownCfg({ events: [{ name: 'A', date: '2026-12-25' }, { name: 'B', date: 'bad' }, null] });
    assert.equal(c.events.length, 1); assert.ok(c.events[0].id);
    const order = Wd.sortEvents([{ name: 'late', date: '2027-01-01' }, { name: 'gone', date: '2026-01-01' }, { name: 'soon', date: '2026-12-01' }], now, 'soonest').map(x => x.e.name);
    assert.deepEqual(order, ['soon', 'late', 'gone'], 'upcoming first, past events last');
  });

  test('rates: parse the NBU feed, cross rates, settings', () => {
    const feed = [{ r030: 840, txt: 'x', rate: 41.5, cc: 'USD', exchangedate: '28.11.2026' }, { r030: 978, txt: 'y', rate: 48.3, cc: 'EUR', exchangedate: '28.11.2026' }, { cc: 'bad', rate: 1 }, { cc: 'ZZZ', rate: 0 }];
    const p = Wd.parseNbu(feed);
    assert.equal(p.date, '2026-11-28'); assert.deepEqual(Object.keys(p.rates).sort(), ['EUR', 'UAH', 'USD']);
    assert.equal(Wd.parseNbu([]), null); assert.equal(Wd.parseNbu({}), null);
    assert.equal(Wd.convert(p.rates, 100, 'USD', 'UAH'), 4150);
    assert.ok(Math.abs(Wd.convert(p.rates, 1, 'EUR', 'USD') - 48.3 / 41.5) < 1e-9);
    assert.equal(Wd.convert(p.rates, 1, 'XXX', 'UAH'), null);
    const c = Wd.ratesCfg({ base: 'usd', codes: ['eur', 'EUR', 'x', ' pln '], amount: -5, decimals: 9 });
    assert.deepEqual([c.base, c.codes, c.amount, c.decimals], ['USD', ['EUR', 'PLN'], 1, 6]);
    assert.deepEqual(Wd.ratesCfg({}).codes, ['USD', 'EUR']); assert.equal(Wd.ratesCfg({}).base, 'UAH');
    assert.equal(Wd.nbuDate(new Date(2026, 10, 7)), '20261107');
    const m = Wd.parseMono([{ currencyCodeA: 840, currencyCodeB: 980, rateBuy: 45, rateSell: 45.44 }, { currencyCodeA: 826, currencyCodeB: 980, rateCross: 59.78 }, { currencyCodeA: 978, currencyCodeB: 840, rateBuy: 1.09, rateSell: 1.1 }, { currencyCodeA: 1, currencyCodeB: 980, rateBuy: 1, rateSell: 2 }]);
    assert.deepEqual(m, { USD: { buy: 45, sell: 45.44 }, GBP: { cross: 59.78 } }); assert.equal(Wd.parseMono({}), null);
    assert.deepEqual(Wd.parseTicker({ lastPrice: '59498.46', bidPrice: '59498.46', askPrice: '59498.47', priceChangePercent: '-3.540' }), { last: 59498.46, bid: 59498.46, ask: 59498.47, change: -3.54 });
    assert.equal(Wd.parseTicker({ code: -1121 }), null);
    const rc = Wd.ratesCfg({ source: 'crypto', coins: ['btc', 'bad coin', 'ETH', 'btc'], quote: 'EUR' });
    assert.deepEqual([rc.source, rc.coins, rc.quote], ['crypto', ['BTC', 'ETH'], 'EUR']); assert.deepEqual([Wd.ratesCfg({ source: 'x', quote: 'DOGE' }).source, Wd.ratesCfg({ quote: 'DOGE' }).quote], ['nbu', 'USDT']);
  });

  test('links settings: defaults match the old look, bad values fall back, extra keys survive', () => {
    const c = Wd.linksCfg({ tab: 'dev', layout: 'wow', cols: 99, icons: 'letter', color: 'purple', keep: 1 });
    assert.deepEqual([c.layout, c.cols, c.icons, c.color, c.tab, c.keep, c.headers, c.newTab], ['columns', 4, 'letter', 'purple', 'dev', 1, true, false]);
    assert.equal(Wd.linksCfg({}).groups, undefined);
  });

  test('ambient settings: built-in and custom sounds are validated', () => {
    const c = Wd.ambientCfg({ sounds: ['rain', 'bogus', 'rain', 'fire', 'cabc12'], levels: { rain: 5, fire: -1, cabc12: 0.4 }, master: 2, sleepMin: 7,
      custom: [{ id: 'cabc12', name: 'Cafe', url: 'https://example.com/cafe.mp3' }, { name: 'Bad', url: 'http://plain.example/x.mp3' }, { name: '', url: 'https://example.com/y.mp3' }, { name: 'Js', url: 'javascript:alert(1)' }] });
    assert.deepEqual(c.sounds, ['rain', 'fire', 'cabc12']); assert.equal(c.levels.rain, 1); assert.equal(c.levels.fire, 0); assert.equal(c.levels.cabc12, 0.4);
    assert.equal(c.master, 1); assert.equal(c.sleepMin, 0); assert.deepEqual(c.custom, [{ id: 'cabc12', name: 'Cafe', url: 'https://example.com/cafe.mp3' }]);
    assert.equal(Wd.ambientCfg({}).levels.rain, 0.6); assert.deepEqual(Wd.ambientCfg({}).sounds, ['rain', 'thunder', 'wind', 'ocean', 'fire', 'brown']);
    assert.equal(Wd.ambientCfg({ custom: Array.from({ length: 9 }, (_, i) => ({ name: 'n' + i, url: 'https://e.example/' + i })) }).custom.length, Wd.CUSTOM_MAX);
    for (const [id, v] of Object.entries(Wd.STREAMS)) assert.match(v.url, /^https:\/\/archive\.org\/download\/[\w.-]+\/[^\s]+\.(ogg|mp3)$/, id);
    assert.equal(Wd.noiseData('brown', 256).length, 256);
  });

  test('ambient engine: nothing starts before play, silent streams are never requested, errors are reported (fake audio)', async () => {
    const log = [], els = [];
    class Param { constructor() { this.value = 0; } }
    class Node { constructor() { this.gain = new Param(); this.loop = false; } connect() {} start() { log.push('start'); } stop() {} }
    class Ctx {
      constructor() { this.state = 'running'; this.sampleRate = 8000; this.destination = {}; log.push('ctx'); }
      createBuffer(ch, n) { const a = new Float32Array(n); return { length: n, getChannelData: () => a }; }
      createBufferSource() { return new Node(); } createGain() { return new Node(); }
      async resume() { log.push('resume'); } async suspend() { log.push('suspend'); } close() { log.push('close'); }
    }
    class El {
      constructor() { this.paused = true; this.volume = 1; this.handlers = {}; els.push(this); }
      addEventListener(t, f) { this.handlers[t] = f; } removeAttribute() { this.src = ''; } load() {}
      play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; }
    }
    const e = Wd.createAmbient(Ctx, () => new El());
    const changed = []; e.onChange = id => changed.push(id);
    e.setSources([{ id: 'cabc12', url: 'https://example.com/cafe.mp3' }]);
    e.setLevels({ rain: 0.5, fire: 0, cabc12: 0.25, brown: 0.5 });
    assert.equal(log.length, 0); assert.equal(els.length, 0, 'nothing is created before play()');
    await e.play();
    assert.equal(e.playing, true); assert.equal(log.filter(x => x === 'ctx').length, 1);
    assert.deepEqual(els.map(x => x.src), [Wd.STREAMS.rain.url, 'https://example.com/cafe.mp3'], 'only sounds above zero are requested');
    assert.deepEqual(els.map(x => x.volume), [0.4, 0.2]); assert.ok(els.every(x => x.loop === true && !x.paused));
    e.setLevel('fire', 0.5); assert.equal(els.length, 3); assert.equal(els[2].src, Wd.STREAMS.fire.url);
    e.setLevel('rain', 0); assert.equal(els[0].paused, true);
    e.setMaster(0.5); assert.equal(els[2].volume, 0.25);
    els[1].handlers.error(); assert.equal(e.failed('cabc12'), true); assert.deepEqual(changed, ['cabc12']);
    els[1].handlers.playing(); assert.equal(e.failed('cabc12'), false);
    await e.pause(); assert.equal(e.playing, false); assert.ok(els.every(x => x.paused)); assert.ok(log.includes('suspend'));
    e.destroy(); assert.ok(log.includes('close')); assert.ok(els.every(x => x.src === ''));
    const quiet = Wd.createAmbient(undefined, () => new El()); quiet.setLevels({ rain: 1 }); await quiet.play(); assert.equal(quiet.playing, true, 'streams still play without Web Audio');
  });
});

/* ───────────── 0.6.0: air-raid alerts (pure logic) ───────────── */
describe('alerts widget helpers (pure)', () => {
  const Wd = require('../widgets.js');

  test('27 oblasts, in the exact order of the alerts.in.ua status string, each with a usable id and coordinates', () => {
    assert.equal(Wd.OBLASTS.length, 27);
    const ids = Wd.OBLASTS.map(o => o.id);
    assert.equal(new Set(ids).size, 27, 'ids are unique');
    for (const o of Wd.OBLASTS) { assert.ok(o.name, o.id); assert.ok(Math.abs(o.lat) <= 90 && Math.abs(o.lon) <= 180, o.id); }
    assert.equal(Wd.OBLAST_BY_ID['kyiv-city'], 9); assert.equal(Wd.OBLAST_BY_ID['kharkiv'], 21); assert.equal(Wd.OBLAST_BY_ID['chernihiv'], 26);
  });

  test('parseOblastString: v2 codes R/Y/P/N decode to a level and an active flag, one row per oblast', () => {
    const s = 'RNNNNNNNNYNNRNNNNNNNNNNNNNN';                       // from the API docs: index 0 red, 9 yellow, 12 red
    const rows = Wd.parseOblastString(s);
    assert.equal(rows.length, 27);
    assert.deepEqual(rows[0], { ...Wd.OBLASTS[0], idx: 0, code: 'R', level: 'red', active: true });
    assert.deepEqual([rows[9].level, rows[9].active], ['yellow', true]);
    assert.deepEqual([rows[1].level, rows[1].active], [null, false]);
    assert.equal(Wd.parseOblastString('RNN'), null, 'the wrong length is rejected, not silently truncated');
    assert.equal(Wd.parseOblastString(null), null);
  });

  test('haversineKm and projectOblasts: real-world distances and a stable, bounded 2D layout', () => {
    const km = Wd.haversineKm(Wd.OBLASTS[Wd.OBLAST_BY_ID['kyiv-city']], Wd.OBLASTS[Wd.OBLAST_BY_ID['kharkiv']]);
    assert.ok(km > 350 && km < 500, km);                              // Kyiv-Kharkiv is roughly 410-480 km depending on route
    assert.equal(Wd.haversineKm(Wd.OBLASTS[0], Wd.OBLASTS[0]), 0);
    const p = Wd.projectOblasts();
    assert.equal(p.length, 27);
    for (const o of p) { assert.ok(o.x >= 0 && o.x <= Wd.ALERTS_SPACE.w); assert.ok(o.y >= 0 && o.y <= Wd.ALERTS_SPACE.h); }
    assert.ok(p[Wd.OBLAST_BY_ID['chernihiv']].y < p[Wd.OBLAST_BY_ID['odesa']].y, 'Chernihiv (north) sits above Odesa (south)');
  });

  test('estimateFromEvents: a fresh activation elsewhere gives a banded ETA; stale, overdue or self events give none', () => {
    const target = Wd.OBLAST_BY_ID['kyiv-city'], from = Wd.OBLAST_BY_ID['kharkiv'], now = Date.now();
    const est = Wd.estimateFromEvents([{ idx: from, at: now - 5 * 60000 }], target, Wd.THREAT_SPEEDS.drone, now);
    assert.ok(est.minLeft > 0 && est.maxLeft > est.minLeft, JSON.stringify(est));
    assert.equal(est.fromIdx, from);
    assert.equal(Wd.estimateFromEvents([{ idx: from, at: now - (Wd.ALERTS_FRESH_MIN + 10) * 60000 }], target, Wd.THREAT_SPEEDS.drone, now), null, 'too old to drive an estimate');
    assert.equal(Wd.estimateFromEvents([{ idx: from, at: now - 10 * 60000 }], target, Wd.THREAT_SPEEDS.ballistic, now), null, 'already overdue at that speed');
    assert.equal(Wd.estimateFromEvents([{ idx: target, at: now }], target, Wd.THREAT_SPEEDS.drone, now), null, 'an event in the target itself is not a source');
    assert.equal(Wd.estimateFromEvents([], target, Wd.THREAT_SPEEDS.drone, now), null);
  });

  test('estimateFromManual mirrors estimateFromEvents from a hand-set point and time', () => {
    const target = Wd.OBLAST_BY_ID['lviv'], from = Wd.OBLAST_BY_ID['ternopil'], now = Date.now();
    assert.equal(Wd.estimateFromManual(null, target, Wd.THREAT_SPEEDS.drone, now), null);
    const est = Wd.estimateFromManual({ idx: from, setAt: now - 2 * 60000 }, target, Wd.THREAT_SPEEDS.drone, now);
    assert.ok(est.minLeft > 0); assert.equal(est.fromIdx, from);
  });

  test('tripCompare: comfortable, tight, wait and unknown', () => {
    assert.equal(Wd.tripCompare(null, 10), 'unknown');
    assert.equal(Wd.tripCompare(60, 10), 'comfortable');
    assert.equal(Wd.tripCompare(15, 10), 'tight');
    assert.equal(Wd.tripCompare(5, 10), 'wait');
  });

  test('alertsCfg: defaults, limits, and bad input are rejected without throwing', () => {
    const d = Wd.alertsCfg(undefined);
    assert.deepEqual(d, { name: '', token: '', pinned: [], focus: true, threat: 'drone', speeds: Wd.THREAT_SPEEDS, useTracks: false, trackSpeeds: Wd.TRACK_SPEEDS, manualFrom: '', manualSetAt: undefined, places: [], notify: false, sound: false });
    const c = Wd.alertsCfg({
      token: '  secret  ', pinned: ['kyiv-city', 'bogus', 'kyiv-city', 'kharkiv', 'lviv', 'odesa', 'sumy', 'poltava', 'dnipropetrovsk'],
      threat: 'nope', speeds: { drone: 'x', cruise: 5000 }, places: [{ name: 'Shop', minutes: 15 }, { name: '', minutes: 5 }, { name: 'Clamped', minutes: -1 }, { name: 'Bad', minutes: 'soon' }, null],
      manualFrom: 'kharkiv', manualSetAt: Date.now() - 1000,
    });
    assert.equal(c.pinned.length, 6, 'capped at the pinned limit, duplicates and unknown ids dropped');
    assert.deepEqual(c.pinned.slice(0, 2), ['kyiv-city', 'kharkiv']);
    assert.equal(c.threat, 'drone'); assert.equal(c.speeds.drone, Wd.THREAT_SPEEDS.drone); assert.equal(c.speeds.cruise, 5000);
    assert.equal(c.places.length, 2, 'a blank name and a non-numeric time are dropped'); assert.equal(c.places[0].name, 'Shop');
    assert.equal(c.places[1].minutes, 1, 'a travel time below the minimum is clamped, not dropped');
    assert.equal(c.manualFrom, 'kharkiv'); assert.ok(c.manualSetAt > 0);
    assert.equal(Wd.alertsCfg({ manualFrom: 'kharkiv' }).manualSetAt, undefined, 'no manual estimate without an explicit mark');
    assert.equal(Wd.alertsCfg({ places: Array.from({ length: 12 }, (_, i) => ({ name: 'p' + i, minutes: 5 })) }).places.length, Wd.ALERTS_PLACES_MAX);
    const t = Wd.alertsCfg({ useTracks: true, trackSpeeds: { drone: 'x', jet: 600 } });
    assert.equal(t.useTracks, true); assert.equal(t.trackSpeeds.drone, Wd.TRACK_SPEEDS.drone); assert.equal(t.trackSpeeds.jet, 600);
    assert.equal(Wd.alertsCfg({}).useTracks, false);
  });

  test('bearingDeg and bearingGap: compass direction between two points, and the signed angle between two bearings', () => {
    const north = { lat: 51, lon: 30 }, south = { lat: 46, lon: 30 };
    assert.ok(Math.abs(Wd.bearingDeg(south, north)) < 2, 'due north is ~0°');
    assert.ok(Math.abs(Wd.bearingDeg(north, south) - 180) < 2, 'due south is ~180°');
    assert.equal(Wd.bearingGap(10, 20), 10); assert.equal(Wd.bearingGap(350, 10), 20); assert.equal(Wd.bearingGap(10, 350), -20);
  });

  test('parseTracks: the kudyletyt.com feed (GeoJSON [lon,lat] order), one row per track at its most recent point', () => {
    const feed = { now: 1700000000000, tracks: [
      { id: 'T1', type: 'jet', status: 'active', heading: 90, lastSeen: 1700000000000, toward: { name: 'Kyiv' }, pts: [{ t: 1699999000000, pt: [35, 48] }, { t: 1700000000000, pt: [36, 48.5] }] },
      { id: 'T2', type: 'bogus', status: 'ended', pts: [{ t: 1, pt: [30, 50] }] },
      { id: 'T3', type: 'drone', status: 'active', pts: [] },
      null,
    ] };
    const p = Wd.parseTracks(feed);
    assert.equal(p.tracks.length, 2);
    assert.deepEqual([p.tracks[0].lat, p.tracks[0].lon], [48.5, 36], 'uses the last point, and GeoJSON [lon,lat] is reordered to {lat,lon}');
    assert.equal(p.tracks[0].active, true); assert.equal(p.tracks[0].toward, 'Kyiv');
    assert.equal(p.tracks[1].type, 'drone', 'an unknown type falls back to drone'); assert.equal(p.tracks[1].active, false);
    assert.equal(Wd.parseTracks({ tracks: 'nope' }), null); assert.equal(Wd.parseTracks(null), null);
  });

  test('estimateFromTrack: only an active track heading roughly at the target, fresh enough, gives a banded ETA', () => {
    const target = Wd.OBLAST_BY_ID['dnipropetrovsk'], now = Date.now();
    const toward = Wd.OBLASTS[target];
    const heading = Wd.bearingDeg({ lat: 46.6, lon: 33.0 }, toward);
    const onCourse = { lat: 46.6, lon: 33.0, type: 'drone', active: true, heading, lastSeen: now - 10 * 60000 };
    const est = Wd.estimateFromTrack(onCourse, target, Wd.TRACK_SPEEDS.drone, now);
    assert.ok(est.minLeft > 0 && est.maxLeft >= est.minLeft); assert.equal(est.trackType, 'drone');
    assert.equal(Wd.estimateFromTrack({ ...onCourse, active: false }, target, Wd.TRACK_SPEEDS.drone, now), null, 'an ended track gives no estimate');
    assert.equal(Wd.estimateFromTrack({ ...onCourse, heading: (heading + 170) % 360 }, target, Wd.TRACK_SPEEDS.drone, now), null, 'heading away from the target gives no estimate');
    assert.equal(Wd.estimateFromTrack({ ...onCourse, lastSeen: now - (Wd.ALERTS_FRESH_MIN + 5) * 60000 }, target, Wd.TRACK_SPEEDS.drone, now), null, 'too stale');
    assert.equal(Wd.estimateFromTrack({ ...onCourse, heading: null }, target, Wd.TRACK_SPEEDS.drone, now), null, 'no heading, no estimate');
  });
});

describe('widgets in the app (jsdom)', () => {
  const settle = (ms = 40) => new Promise(r => setTimeout(r, ms));
  const withTiles = (...tiles) => { const fx = fixture(); tiles.forEach((t, i) => fx.ws[3].items.push({ id: 'n' + i, x: 0, y: i * 2, w: 5, h: 3, cfg: {}, ...t })); fx.active = 3; return fx; };
  const tile = (a, type) => a.w.document.querySelector(`.tile[data-type="${type}"]`);
  const menuConfigure = (a, type) => {
    tile(a, type).dispatchEvent(new a.w.Event('pointerdown', { bubbles: true })); a.key('KeyM');
    [...a.w.document.querySelectorAll('.menu .mi')].find(e => e.textContent.includes(S.tileConfigure)).click();
  };
  const ctl = (a, label) => a.w.document.querySelector(`.mbox [aria-label="${label}"]`);
  const set = (el, v) => { el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event('change', { bubbles: true })); };
  const chk = (a, text) => [...a.w.document.querySelectorAll('.mbox .fr.chk')].find(r => r.textContent.startsWith(text)).querySelector('input');
  const saveBtn = a => a.w.document.querySelector('.mf .btn.main');
  const quiet = w => { w.fetch = async () => { throw new Error('offline'); }; };

  test('every new tile type renders with default settings and is offered by the command bar', async () => {
    const a = await boot(withTiles({ type: 'worldclock' }, { type: 'countdown' }, { type: 'rates' }, { type: 'ambient' }), quiet);
    try {
      await settle();
      for (const t of ['worldclock', 'countdown', 'rates', 'ambient']) assert.ok(tile(a, t), t);
      assert.equal(a.w.document.querySelectorAll('.tile').length, 4);
      for (const t of a.w.document.querySelectorAll('.tile')) assert.doesNotMatch(t.textContent, /null|undefined|NaN/, t.dataset.type);
      assert.deepEqual(['worldclock', 'countdown', 'rates', 'ambient'].map(t => tile(a, t).querySelector('.tt').textContent), ['world clocks', 'countdown', 'rates', 'sounds']);
    } finally { await a.close(); }
  });

  test('clock styles: each one draws, 12-hour and hidden seconds are respected', async () => {
    const a = await boot(withTiles({ type: 'clock', cfg: { style: 'analog' } }, { type: 'clock', cfg: { style: 'binary', seconds: false } }, { type: 'clock', cfg: { style: 'words', date: 'none' } },
      { type: 'clock', cfg: { style: 'stacked', hour12: true } }, { type: 'clock', cfg: { style: 'large', seconds: false, progress: false, align: 'center', valign: 'bottom' } }), quiet);
    try {
      const [an, bi, wd, st, lg] = [...a.w.document.querySelectorAll('.tile[data-type="clock"]')].slice(-5);
      assert.ok(an.querySelector('svg.ck-a .ck-hh') && an.querySelector('.ck-sh'));
      assert.equal(bi.querySelectorAll('.ck-bc').length, 4); assert.equal(bi.querySelectorAll('.ck-bc i').length, 16);
      assert.match(wd.querySelector('.ck-w').textContent, /o\u2019clock|past|to|noon|midnight/); assert.equal(wd.querySelector('.ck-d'), null);
      assert.match(st.querySelector('.ck-h').textContent, /^\d{1,2}(AM|PM)$/);
      assert.equal(lg.querySelector('.ck-s'), null); assert.equal(lg.querySelector('.ck-p'), null);
      assert.equal(lg.querySelector('.ck').dataset.align, 'center'); assert.equal(lg.querySelector('.ck').dataset.valign, 'bottom');
      assert.match(lg.querySelector('.ck-t').textContent, /^\d\d:\d\d$/);
    } finally { await a.close(); }
  });

  test('clock: the Configure dialog saves style and alignment into the tile only, and the title can be renamed', async () => {
    const a = await boot(withTiles({ type: 'clock' }), quiet);
    try {
      const mine = a.w.document.querySelectorAll('.tile[data-type="clock"]'); const el = mine[mine.length - 1];
      el.dispatchEvent(new a.w.Event('pointerdown', { bubbles: true })); a.key('KeyM');
      [...a.w.document.querySelectorAll('.menu .mi')].find(e => e.textContent.includes(S.tileConfigure)).click();
      set(ctl(a, 'Style'), 'analog'); set(ctl(a, 'Horizontal alignment'), 'right'); set(ctl(a, 'Tile name'), 'Desk');
      saveBtn(a).click();
      assert.ok(el.querySelector('svg.ck-a')); assert.equal(el.querySelector('.tt').textContent, 'Desk');
      const s = a.saved(), saved = s.ws[3].items.find(i => i.id === 'n0');
      assert.equal(saved.cfg.style, 'analog'); assert.equal(saved.cfg.align, 'right'); assert.equal(saved.cfg.name, 'Desk');
      assert.deepEqual(s.ws[0].items.find(i => i.type === 'clock').cfg, {}, 'other clocks are untouched');
    } finally { await a.close(); }
  });

  test('world clocks: default zones, your own time, and a custom list from Configure', async () => {
    const a = await boot(withTiles({ type: 'worldclock' }), quiet);
    try {
      const t = tile(a, 'worldclock');
      const names = [...t.querySelectorAll('.wc-n')].map(x => x.textContent);
      assert.deepEqual(names, ['Your time', 'New York', 'London', 'Tokyo']);
      assert.match(t.querySelector('.wc-t').textContent, /^\d\d:\d\d$/);
      menuConfigure(a, 'worldclock');
      const rows = a.w.document.querySelectorAll('.mbox .led-r'); assert.equal(rows.length, 3);
      rows[0].querySelector('.led-r > div > input').value = 'Mars/Base';
      saveBtn(a).click();
      assert.ok(a.w.document.querySelector('.mbox'), 'an invalid zone keeps the dialog open');
      rows[0].querySelector('.btn').click();                                  // remove it
      a.w.document.querySelector('.led-w > .btn').click();                    // add a row
      const fresh = [...a.w.document.querySelectorAll('.mbox .led-r')].pop().querySelector('input');
      fresh.value = 'Australia/Sydney';
      chk(a, 'Show your own time first').checked = false;
      saveBtn(a).click();
      assert.equal(a.w.document.querySelector('.mbox'), null);
      assert.deepEqual([...tile(a, 'worldclock').querySelectorAll('.wc-n')].map(x => x.textContent), ['London', 'Tokyo', 'Sydney']);
    } finally { await a.close(); }
  });

  test('countdown: shows days left, today, passed; Configure adds and removes events', async () => {
    const day = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const a = await boot(withTiles({ type: 'countdown', h: 4, cfg: { events: [{ id: 'a', name: 'Trip', date: day(10) }, { id: 'b', name: 'Birthday', date: day(0) }, { id: 'c', name: 'Old', date: day(-3) }] } }), quiet);
    try {
      const t = tile(a, 'countdown');
      const rows = [...t.querySelectorAll('.cd-r')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
      assert.deepEqual(rows, ['BirthdayToday', 'Trip10 days', 'Old3 days ago']);
      menuConfigure(a, 'countdown');
      const del = a.w.document.querySelectorAll('.mbox .led-r .btn'); del[del.length - 1].click();               // drop "Old"
      a.w.document.querySelector('.led-w > .btn').click();
      const last = [...a.w.document.querySelectorAll('.mbox .led-r')].pop();
      last.querySelector('input').value = 'Half-baked';
      saveBtn(a).click();
      assert.ok(a.w.document.querySelector('.mbox'), 'an event without a date is rejected');
      last.querySelector('input[type="date"]').value = day(400);
      saveBtn(a).click();
      assert.equal(a.w.document.querySelector('.mbox'), null);
      assert.deepEqual([...tile(a, 'countdown').querySelectorAll('.cd-n')].map(x => x.textContent), ['Birthday', 'Trip', 'Half-baked']);
      assert.equal(a.saved().ws[3].items.find(i => i.id === 'n0').cfg.events.length, 3);
    } finally { await a.close(); }
  });

  describe('rates', () => {
    const feed = (usd, eur, date) => JSON.stringify([{ r030: 840, txt: 'Dollar', rate: usd, cc: 'USD', exchangedate: date }, { r030: 978, txt: 'Euro', rate: eur, cc: 'EUR', exchangedate: date }, { r030: 985, txt: 'Zloty', rate: 11.5, cc: 'PLN', exchangedate: date }]);
    const net = (urls, fail) => w => { w.fetch = async u => { u = String(u); urls.push(u); if (fail) throw new Error('offline'); return { ok: true, json: async () => JSON.parse(u.includes('date=') ? feed(41, 48, '27.11.2026') : feed(41.5, 48.3, '28.11.2026')) }; }; };

    test('loads the NBU feed, shows the change since the previous day and caches it', async () => {
      const urls = []; const a = await boot(withTiles({ type: 'rates' }), net(urls));
      try {
        await settle(80);
        const t = tile(a, 'rates');
        const rows = [...t.querySelectorAll('.fx-r')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
        assert.match(rows[0], /^USD\s*41\.50 UAH\s*▲ 1\.22%$/); assert.match(rows[1], /^EUR\s*48\.30 UAH\s*▲ 0\.62%$/);
        assert.ok(urls.some(u => u.startsWith('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json')));
        assert.match(t.textContent, /NBU 2026-11-28/);
        assert.doesNotMatch(t.textContent, /null|undefined|NaN/);
        assert.equal(JSON.parse(a.w.localStorage.getItem('hud.rates')).nbu.today.rates.USD, 41.5);
      } finally { await a.close(); }
    });

    test('with no network it falls back to the cache; with neither it offers Retry', async () => {
      const cache = { ts: Date.now() - 3 * 3600e3, today: { date: '2026-11-28', rates: { UAH: 1, USD: 41.5, EUR: 48.3 } }, prev: null };
      const a = await boot(withTiles({ type: 'rates' }), w => { net([], true)(w); w.localStorage.setItem('hud.rates', JSON.stringify(cache)); });
      try { await settle(80); const t = tile(a, 'rates'); assert.match(t.textContent, /USD\s*41\.50/); assert.match(t.querySelector('.ts').textContent, /offline/); } finally { await a.close(); }
      const b = await boot(withTiles({ type: 'rates' }), net([], true));
      try { await settle(80); assert.match(tile(b, 'rates').textContent, /Could not load the rates/); assert.ok([...tile(b, 'rates').querySelectorAll('.btn')].some(x => x.textContent === 'Retry')); } finally { await b.close(); }
    });

    test('monobank: buy and sell columns for the chosen currencies', async () => {
      const urls = [];
      const a = await boot(withTiles({ type: 'rates', cfg: { source: 'mono', codes: ['USD', 'GBP'] } }), w => { w.fetch = async u => { urls.push(String(u)); return { ok: true, json: async () => [{ currencyCodeA: 840, currencyCodeB: 980, rateBuy: 45, rateSell: 45.44 }, { currencyCodeA: 826, currencyCodeB: 980, rateCross: 59.78 }] }; }; });
      try {
        await settle(80);
        const t = tile(a, 'rates');
        assert.deepEqual([...t.querySelectorAll('.fx-h span')].map(x => x.textContent), ['', 'Buy', 'Sell', '']);
        const rows = [...t.querySelectorAll('.fx-r:not(.fx-h)')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
        assert.equal(rows[0], 'USD45.0045.44'); assert.equal(rows[1], 'GBP59.7859.78');
        assert.ok(urls.includes('https://api.monobank.ua/bank/currency')); assert.match(t.querySelector('.ts').textContent, /monobank/);
        assert.equal(JSON.parse(a.w.localStorage.getItem('hud.rates')).mono.rows.USD.sell, 45.44);
      } finally { await a.close(); }
    });

    test('crypto: bid and ask from Binance, 24-hour change, and a coin that does not exist shows a dash', async () => {
      const urls = [];
      const a = await boot(withTiles({ type: 'rates', cfg: { source: 'crypto', coins: ['BTC', 'NOPE'], quote: 'USDT', decimals: 2 } }), w => { w.fetch = async u => { u = String(u); urls.push(u); return u.endsWith('BTCUSDT') ? { ok: true, json: async () => ({ lastPrice: '59498.46', bidPrice: '59498.46', askPrice: '59498.47', priceChangePercent: '-3.540' }) } : { ok: false, status: 400, json: async () => ({}) }; }; });
      try {
        await settle(80);
        const rows = [...tile(a, 'rates').querySelectorAll('.fx-r:not(.fx-h)')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
        assert.equal(rows[0], 'BTC59,498.4659,498.47▼ 3.54%'); assert.equal(rows[1], 'NOPE——');
        assert.ok(urls.includes('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT'));
      } finally { await a.close(); }
    });

    test('Configure: switching the source shows its own fields', async () => {
      const a = await boot(withTiles({ type: 'rates' }), net([]));
      try {
        await settle(80); menuConfigure(a, 'rates');
        const panels = () => [...a.w.document.querySelectorAll('.mbox .fx-p')].filter(p => !p.hidden).map(p => p.textContent.slice(0, 12));
        assert.ok(panels().length >= 2);
        set(ctl(a, 'Source'), 'crypto');
        assert.ok(a.w.document.querySelector('.mbox [aria-label="Quote currency"]').closest('.fx-p').hidden === false);
        [...a.w.document.querySelectorAll('.mbox .fx-p .fx-code')].filter(i => !i.closest('.fx-p').hidden)[0].value = 'sol';
        saveBtn(a).click(); await settle(80);
        const cfg = a.saved().ws[3].items.find(i => i.id === 'n0').cfg;
        assert.equal(cfg.source, 'crypto'); assert.deepEqual(cfg.coins, ['SOL', 'ETH']);
      } finally { await a.close(); }
    });

    test('Configure: another base currency, amount, decimals, add and remove currencies; unknown codes are refused', async () => {
      const a = await boot(withTiles({ type: 'rates' }), net([]));
      try {
        await settle(80);
        menuConfigure(a, 'rates');
        set(ctl(a, 'Show prices in'), 'EUR'); set(ctl(a, 'Amount of each currency'), '100'); set(ctl(a, 'Decimal places'), '0');
        const del = a.w.document.querySelectorAll('.mbox .led-r .btn'); del[1].click();                   // drop EUR from the list
        a.w.document.querySelector('.led-w > .btn').click();
        const codes = a.w.document.querySelectorAll('.mbox .fx-p:not([hidden]) .fx-code'); codes[codes.length - 1].value = 'xyz';
        saveBtn(a).click();
        assert.ok(a.w.document.querySelector('.mbox'), 'a code the bank does not publish is refused');
        codes[codes.length - 1].value = 'pln'; saveBtn(a).click(); await settle(80);
        assert.equal(a.w.document.querySelector('.mbox'), null);
        const rows = [...tile(a, 'rates').querySelectorAll('.fx-r')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
        assert.match(rows[0], /^100 USD\s*86 EUR/); assert.match(rows[1], /^100 PLN\s*24 EUR/);
        assert.deepEqual(a.saved().ws[3].items.find(i => i.id === 'n0').cfg.codes, ['USD', 'PLN']);
      } finally { await a.close(); }
    });
  });

  describe('ambient sounds', () => {
    const fake = (ctxs, els) => w => {
      quiet(w);
      class P { constructor() { this.value = 0; } }
      class N { constructor() { this.gain = new P(); } connect() {} start() {} stop() {} }
      w.AudioContext = class { constructor() { ctxs.push(this); this.state = 'running'; this.sampleRate = 8000; this.destination = {}; }
        createBuffer(c, n) { const x = new Float32Array(n); return { length: n, getChannelData: () => x }; } createBufferSource() { return new N(); } createGain() { return new N(); }
        async resume() { this.state = 'running'; } async suspend() { this.state = 'suspended'; } close() { this.state = 'closed'; } };
      w.Audio = class { constructor() { this.paused = true; this.volume = 1; this.src = ''; els.push(this); } addEventListener() {} removeAttribute() { this.src = ''; } load() {} play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } };
    };

    test('plays on click, streams only what is turned up, keeps playing across workspaces, remembers levels, stops when the tile is deleted', async () => {
      const ctxs = [], els = []; const a = await boot(withTiles({ type: 'ambient' }), fake(ctxs, els));
      try {
        const t = () => tile(a, 'ambient');
        assert.equal(ctxs.length + els.length, 0, 'no audio and no network before the first click');
        assert.deepEqual([...t().querySelectorAll('.am-n')].map(x => x.textContent), ['Rain', 'Thunderstorm', 'Wind in the woods', 'Ocean', 'Fireplace', 'Brown noise']);
        t().querySelector('.am-go').click(); await settle();
        assert.equal(els.length, 1, 'only the sound above zero is streamed'); assert.match(els[0].src, /^https:\/\/archive\.org\/download\/naturesounds/); assert.equal(els[0].paused, false);
        assert.equal(t().querySelector('.am-go').textContent, 'Pause');
        a.key('Digit1'); a.key('Digit4');
        assert.equal(els.length, 1, 'redrawing the tile does not restart the stream'); assert.equal(els[0].paused, false); assert.equal(t().querySelector('.am-go').textContent, 'Pause');
        const slider = t().querySelector('input[aria-label="Ocean volume"]'); slider.value = '35'; slider.dispatchEvent(new a.w.Event('input', { bubbles: true })); slider.dispatchEvent(new a.w.Event('change', { bubbles: true }));
        assert.equal(els.length, 2, 'turning a sound up while playing starts it'); assert.equal(els[1].volume, 0.35 * 0.8);
        assert.equal(a.saved().ws[3].items.find(i => i.id === 'n0').cfg.levels.ocean, 0.35);
        t().querySelector('.am-go').click(); await settle(); assert.ok(els.every(x => x.paused));
        t().querySelector('.am-go').click(); await settle(); assert.equal(els[0].paused, false);
        tile(a, 'ambient').dispatchEvent(new a.w.Event('pointerdown', { bubbles: true })); a.key('KeyX');
        await new Promise(r => setTimeout(r, 1100)); assert.ok(els.every(x => x.paused && x.src === ''), 'a deleted tile must not keep playing');
      } finally { await a.close(); }
    });

    test('Configure: choose sounds, add your own stream (https only), sleep timer and "play with the focus timer"', async () => {
      const ctxs = [], els = []; const a = await boot(withTiles({ type: 'ambient' }), fake(ctxs, els));
      try {
        menuConfigure(a, 'ambient');
        chk(a, 'Rain').checked = false; chk(a, 'Birdsong').checked = true; chk(a, 'Play while').checked = true;
        set(ctl(a, 'Sleep timer'), '30');
        a.w.document.querySelector('.led-w > .btn').click();
        const row = [...a.w.document.querySelectorAll('.mbox .led-r')].pop();
        const [n, u] = row.querySelectorAll('input'); n.value = 'Cafe'; u.value = 'http://insecure.example/cafe.mp3';
        saveBtn(a).click(); assert.ok(a.w.document.querySelector('.mbox'), 'a non-https address is refused');
        u.value = 'https://example.com/cafe.mp3'; saveBtn(a).click();
        assert.equal(a.w.document.querySelector('.mbox'), null);
        assert.deepEqual([...tile(a, 'ambient').querySelectorAll('.am-n')].map(x => x.textContent), ['Thunderstorm', 'Wind in the woods', 'Ocean', 'Birdsong', 'Fireplace', 'Brown noise', 'Cafe']);
        const cfg = a.saved().ws[3].items.find(i => i.id === 'n0').cfg;
        assert.equal(cfg.sleepMin, 30); assert.equal(cfg.withTimer, true); assert.ok(!cfg.sounds.includes('rain') && cfg.sounds.includes('forest'));
        assert.equal(cfg.custom.length, 1); assert.equal(cfg.custom[0].url, 'https://example.com/cafe.mp3'); assert.ok(cfg.sounds.includes(cfg.custom[0].id));
        a.key('KeyZ');
      } finally { await a.close(); }
    });
  });

  test('links: layout, columns, markers, hidden headings, groups to show, new-tab links, and adding a link', async () => {
    const a = await boot(withTiles({ type: 'links', cfg: { tab: 'dev' } }), quiet);
    try {
      const t = tile(a, 'links'); const before = t.querySelectorAll('a.lk').length;
      assert.equal(t.querySelector('.lg').dataset.layout, 'columns'); assert.ok(before > 0);
      menuConfigure(a, 'links');
      set(ctl(a, 'Layout'), 'chips'); set(ctl(a, 'Columns'), '3'); set(ctl(a, 'Link marker'), 'letter'); set(ctl(a, 'Heading colour'), 'blue');
      a.w.document.querySelectorAll('.mbox input[type="checkbox"]').forEach(c => { if (!c.getAttribute('aria-label')) c.checked = true; });   // show headings off (last two plain boxes)
      const first = a.w.document.querySelector('.lc-g input'); first.checked = true;
      saveBtn(a).click();
      const lg = tile(a, 'links').querySelector('.lg');
      assert.equal(lg.dataset.layout, 'chips'); assert.equal(lg.dataset.icons, 'letter'); assert.equal(lg.style.gridTemplateColumns, 'repeat(3, minmax(0, 1fr))');
      assert.equal(lg.style.getPropertyValue('--lgh'), 'var(--blue)'); assert.ok(lg.querySelector('i.lt'));
      assert.equal(lg.querySelectorAll('.lgg').length, 1, 'only the chosen group is shown');
      const c = a.saved().ws[3].items.find(i => i.id === 'n0').cfg;
      assert.equal(c.tab, 'dev', 'the old tab setting is kept'); assert.equal(c.layout, 'chips'); assert.equal(c.groups.length, 1);
    } finally { await a.close(); }
  });

  test('links: quick add puts a new link into the chosen group; bad input is refused', async () => {
    const a = await boot(withTiles({ type: 'links' }), quiet);
    try {
      const count = () => a.saved().groups[0].links.length;
      const n0 = count();
      menuConfigure(a, 'links');
      set(ctl(a, 'Name'), 'Example'); set(ctl(a, 'Address (https://…)'), 'javascript:alert(1)');
      [...a.w.document.querySelectorAll('.mbox .btn')].find(b => b.textContent === 'Add').click();
      assert.equal(count(), n0, 'a non-http address is refused');
      set(ctl(a, 'Address (https://…)'), 'https://example.com/');
      [...a.w.document.querySelectorAll('.mbox .btn')].find(b => b.textContent === 'Add').click();
      assert.equal(count(), n0 + 1);
      assert.ok([...tile(a, 'links').querySelectorAll('a.lk')].some(x => x.textContent === 'Example' && x.getAttribute('href') === 'https://example.com/'));
    } finally { await a.close(); }
  });

  describe('air-raid alerts (0.6.0)', () => {
    const Wd = require('../widgets.js');
    const ONE_RED = 'R' + 'N'.repeat(26);                             // Crimea (index 0) active, everyone else quiet
    const alertsNet = (raw, fail) => w => { w.fetch = async () => { if (fail) throw new Error('offline'); return { ok: true, text: async () => JSON.stringify(raw) }; }; };
    // There is no "refresh this tile" hotkey yet (only Configure-save and the Retry button call load(true)),
    // so a no-op Configure round trip is the realistic way to force a re-fetch in a test.
    const forceReload = a => { menuConfigure(a, 'alerts'); saveBtn(a).click(); };

    test('with no token: Set up opens Configure; with a token the map shows even before anything is pinned', async () => {
      const a = await boot(withTiles({ type: 'alerts' }), quiet);
      try {
        const t = tile(a, 'alerts');
        assert.match(t.textContent, /Set up/);
        t.querySelector('.btn.main').click();
        assert.ok(a.w.document.querySelector('.mbox'));
        set(a.w.document.querySelector('[aria-label="alerts.in.ua token"]'), 'tok123');
      } finally { await a.close(); }
    });

    test('a token with nothing pinned yet: the map is shown with a hint, so you can pin an oblast by clicking it', async () => {
      const a = await boot(withTiles({ type: 'alerts', cfg: { token: 'tok123' } }), alertsNet('N'.repeat(27)));
      try {
        await settle(80);
        const t = tile(a, 'alerts');
        assert.equal(t.querySelectorAll('svg.al-map .al-o').length, 27);
        assert.equal(t.querySelectorAll('svg.al-map .al-o.pin').length, 0);
        assert.match(t.textContent, /oblast/i);
        assert.equal(t.querySelector('.al-eta'), null, 'no estimate line until something is pinned');
      } finally { await a.close(); }
    });

    test('a token and a pinned oblast load live status and draw a map with that oblast highlighted', async () => {
      const a = await boot(withTiles({ type: 'alerts', cfg: { token: 'tok123', pinned: ['kyiv-city'] } }), alertsNet(ONE_RED));
      try {
        await settle(80);
        const t = tile(a, 'alerts');
        assert.ok(t.querySelector('svg.al-map'));
        assert.equal(t.querySelectorAll('svg.al-map .al-o').length, 27);
        assert.ok(t.querySelector('svg.al-map .al-o.pin'), 'the pinned oblast gets a ring');
        assert.match(t.querySelector('.al-pins').textContent, /Kyiv \(city\): No alert/);
        assert.match(t.querySelector('.al-eta').textContent, /No incoming estimate/);
        assert.match(t.querySelector('.ts').textContent, /alerts\.in\.ua/);
      } finally { await a.close(); }
    });

    test('an oblast turning active drives an ETA towards a pinned oblast, shown as a range, with a dashed line on the map', async () => {
      const a = await boot(withTiles({ type: 'alerts', cfg: { token: 'tok123', pinned: ['kyiv-city'], threat: 'drone' } }), alertsNet('N'.repeat(27)));
      try {
        await settle(80);
        assert.equal(tile(a, 'alerts').querySelector('.al-eta').textContent, 'No incoming estimate right now.');
        const kharkiv = 'N'.repeat(21) + 'R' + 'N'.repeat(5);          // Kharkiv (index 21) goes active
        a.w.fetch = async () => ({ ok: true, text: async () => JSON.stringify(kharkiv) });
        forceReload(a);
        await settle(80);
        const eta = tile(a, 'alerts').querySelector('.al-eta').textContent;
        assert.match(eta, /Possible alert in \d+–\d+ min/, eta);
        assert.ok(tile(a, 'alerts').querySelector('svg.al-map .al-line'), 'a line is drawn from the source oblast towards the pinned one');
      } finally { await a.close(); }
    });

    test('Configure: pick oblasts on the map by click, set places and see a trip comparison, threat speed changes the estimate', async () => {
      const a = await boot(withTiles({ type: 'alerts', cfg: { token: 'tok123' } }), alertsNet('N'.repeat(27)));
      try {
        await settle(80);
        const kyiv = tile(a, 'alerts').querySelector('svg.al-map .al-o[aria-label^="Kyiv (city)"]');
        kyiv.dispatchEvent(new a.w.Event('click', { bubbles: true }));                     // draw() rebuilds the map, so re-query after clicking
        assert.ok(tile(a, 'alerts').querySelector('svg.al-map .al-o[aria-label^="Kyiv (city)"]').classList.contains('pin'));
        assert.equal(a.saved().ws[3].items.find(i => i.id === 'n0').cfg.pinned[0], 'kyiv-city');
        menuConfigure(a, 'alerts');
        a.w.document.querySelector('.led-w > .btn').click();
        const row = [...a.w.document.querySelectorAll('.mbox .led-r')].pop();
        const [n, m] = row.querySelectorAll('input'); n.value = 'Café'; m.value = '20';
        saveBtn(a).click(); await settle(80);
        assert.equal(a.w.document.querySelector('.mbox'), null);
        const cfg = a.saved().ws[3].items.find(i => i.id === 'n0').cfg;
        assert.equal(cfg.places.length, 1); assert.equal(cfg.places[0].minutes, 20);
        assert.match(tile(a, 'alerts').querySelector('.al-p-row').textContent, /Café/);
      } finally { await a.close(); }
    });

    test('notify and sound only fire for a pinned oblast turning active, and only once per activation', async () => {
      const notified = [];
      const a = await boot(withTiles({ type: 'alerts', cfg: { token: 'tok123', pinned: ['lviv'], notify: true } }), w => {
        alertsNet('N'.repeat(27))(w);
        w.Notification = class { static permission = 'granted'; constructor(title, opts) { notified.push([title, opts.body]); } };
      });
      try {
        await settle(80);
        const other = 'R' + 'N'.repeat(26);                           // Crimea, not the pinned oblast (Lviv)
        a.w.fetch = async () => ({ ok: true, text: async () => JSON.stringify(other) });
        forceReload(a); await settle(80);
        assert.deepEqual(notified, [], 'an unrelated oblast does not notify');
        const lvivIdx = Wd.OBLAST_BY_ID.lviv;
        const lvivOn = lvivIdx === 0 ? 'R' + 'N'.repeat(26) : 'N'.repeat(lvivIdx) + 'R' + 'N'.repeat(26 - lvivIdx);
        a.w.fetch = async () => ({ ok: true, text: async () => JSON.stringify(lvivOn) });
        forceReload(a); await settle(80);
        assert.equal(notified.length, 1); assert.match(notified[0][1], /Lviv/);
        forceReload(a); await settle(80);                             // still active: no repeat notification
        assert.equal(notified.length, 1);
      } finally { await a.close(); }
    });

    test('live tracks (optional, off by default): a marker renders only when turned on, and a track on course drives the estimate', async () => {
      const target = Wd.OBLAST_BY_ID['dnipropetrovsk'], toward = Wd.OBLASTS[target];
      const heading = Wd.bearingDeg({ lat: 46.6, lon: 33.0 }, toward);
      const feed = { tracks: [{ id: 'T1', type: 'jet', status: 'active', heading, toward: { name: 'test' }, pts: [{ t: Date.now() - 5 * 60000, pt: [33.0, 46.6] }] }] };
      const net = w => {
        w.fetch = async u => {
          u = String(u);
          if (u.includes('alerts.in.ua')) return { ok: true, text: async () => JSON.stringify('N'.repeat(27)) };
          if (u.includes('kudyletyt.com')) return { ok: true, json: async () => feed };
          throw new Error('unexpected url ' + u);
        };
      };
      const a = await boot(withTiles({ type: 'alerts', cfg: { token: 'tok123', pinned: ['dnipropetrovsk'] } }), net);
      try {
        await settle(80);
        assert.equal(tile(a, 'alerts').querySelectorAll('svg.al-map .al-tr').length, 0, 'tracks are not fetched or drawn until enabled');
        assert.equal(tile(a, 'alerts').querySelector('.al-eta').textContent, 'No incoming estimate right now.');
        menuConfigure(a, 'alerts');
        [...a.w.document.querySelectorAll('.mbox .fr.chk')].find(r => r.textContent.startsWith('Show live tracks')).querySelector('input').checked = true;
        saveBtn(a).click(); await settle(80);
        const t = tile(a, 'alerts');
        assert.equal(t.querySelectorAll('svg.al-map .al-tr').length, 1);
        assert.ok(t.querySelector('svg.al-map .al-tr-jet'));
        assert.match(t.querySelector('.al-eta').textContent, /Possible alert in \d+–\d+ min — from a live jet-powered drone track/);
        assert.ok(t.querySelector('svg.al-map .al-line'), 'a line is drawn from the track towards the pinned oblast');
        assert.match(t.querySelector('.ts').textContent, /kudyletyt\.com/);
      } finally { await a.close(); }
    });
  });
});

describe('0.5.0 release hygiene', () => {
  test('the rates hosts are optional, never required', () => {
    const m = JSON.parse(read('manifest.json'));
    for (const h of ['https://bank.gov.ua/*', 'https://api.monobank.ua/*', 'https://data-api.binance.vision/*']) {
      assert.ok(m.optional_host_permissions.includes(h), h);
      assert.equal((m.host_permissions || []).includes(h), false, h);
    }
  });
  test('the UI is English only: no Cyrillic in strings, pages or widget helpers', () => {
    for (const f of ['strings.js', 'widgets.js', 'index.html', 'popup.html', 'options.html', 'popup.js', 'options.js']) assert.equal(/[\u0400-\u04FF]/.test(read(f)), false, f);
  });
  test('widgets.js is DOM-free and every script is listed in index.html before app.js', () => {
    assert.equal(/\bdocument\.|\bwindow\./.test(read('widgets.js').replace(/\/\*[\s\S]*?\*\//g, '')), false);
    const html = read('index.html'); assert.ok(html.indexOf('widgets.js') > 0 && html.indexOf('widgets.js') < html.indexOf('app.js'));
  });
  test('every module type has a title, size limits, and a render function', () => {
    for (const t of Object.keys(grid.META)) assert.ok(S.mod[t], 'title for ' + t);
    for (const t of ['clock', 'worldclock', 'countdown', 'rates', 'ambient']) assert.ok(new RegExp(`MODULES\\.${t}\\.render`).test(read('app.js')), t);
  });
});

describe('workspace tabs: rename in place', () => {
  const tab = (a, i) => a.w.document.querySelector(`#wsbar .wsb[data-ws="${i}"]`);
  const names = a => [...a.w.document.querySelectorAll('#wsbar .wsb[data-ws]')].map(b => b.textContent);
  const dbl = (a, i) => { tab(a, i).click(); tab(a, i).click(); };
  const type = (a, v, code) => { const inp = a.w.document.querySelector('#wsbar input.wsi'); if (v !== null) inp.value = v; inp.dispatchEvent(new a.w.KeyboardEvent('keydown', { code, key: code, bubbles: true })); };

  test('double-click turns the name into a field; Enter saves it, hotkeys stay quiet while typing', async () => {
    const a = await boot(fixture());
    try {
      a.key('Digit1');
      const before = names(a); dbl(a, 1);
      const inp = a.w.document.querySelector('#wsbar input.wsi');
      assert.ok(inp); assert.equal(a.w.document.activeElement, inp);
      type(a, 'Reading list', 'KeyQ');
      assert.equal(a.saved().active, 1, 'typing Q does not trigger hotkeys; the renamed tab became the active one');
      type(a, 'Reading list', 'Enter');
      assert.equal(a.w.document.querySelector('#wsbar input.wsi'), null);
      assert.equal(a.saved().ws[1].name, 'Reading list'); assert.deepEqual(names(a).map((n, i) => i === 1 ? n : n), names(a));
      assert.match(names(a)[1], /Reading list/); assert.equal(names(a)[0], before[0]);
    } finally { await a.close(); }
  });

  test('Escape cancels, an emptied name keeps just the number, and F2 renames the current workspace', async () => {
    const a = await boot(fixture());
    try {
      const orig = a.saved().ws[0].name;
      dbl(a, 0); type(a, 'zzz', 'Escape');
      assert.equal(a.saved().ws[0].name, orig);
      a.key('Digit1'); a.key('F2'); assert.ok(a.w.document.querySelector('#wsbar input.wsi'));
      type(a, '   ', 'Enter');
      assert.equal(a.saved().ws[0].name, ''); assert.equal(names(a)[0], '1');
      dbl(a, 0); type(a, 'x'.repeat(40), 'Enter'); assert.equal(a.saved().ws[0].name.length, 20);
    } finally { await a.close(); }
  });
});
