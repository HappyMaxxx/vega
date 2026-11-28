(() => {
'use strict';

/* ═════════════ helpers ═════════════ */
const GAP = 10, WKEY = 'hud.weather', UNDO_CAP = 20;
const { COLS, ROWS, META, computeLayout, firstFree, place, autopack: packItems, neighbour } = VEGA.grid;
const { KEY, uid } = VEGA.state;
const S = VEGA.S;
const clamp = VEGA.grid.clamp;
const pad = n => String(n).padStart(2, '0');
const api = globalThis.browser ?? globalThis.chrome ?? null;
const isExt = !!(api && api.runtime && api.runtime.id);
const safeUrl = u => /^(https?|mailto|moz-extension|chrome-extension):/i.test(u) ? u : '#';
const host = u => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const $ = s => document.querySelector(s);

// Link dot colour: the per-link colour from the user's data, or (option) a stable pick from the theme palette.
const DOT_VARS = ['--green', '--aqua', '--blue', '--purple', '--yellow', '--hot', '--red'];
const dotColor = l => {
  if (!state.settings.linkTheme) return l.color || null;
  let n = 0; for (const ch of String(l.name)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(${DOT_VARS[n % DOT_VARS.length]})`;
};

function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return e;
}

/* ═════════════ modules: size limits come from grid.js, titles from strings.js, render() below ═════════════ */
const MODULES = {};
for (const t of Object.keys(META)) MODULES[t] = { ...META[t], title: S.mod[t] };

/* ═════════════ state + persistence (localStorage: synchronous, no flicker) ═════════════ */
let state = VEGA.state.load(localStorage);
let saveT = 0;
const flush = () => { clearTimeout(saveT); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ } };
const save = () => { clearTimeout(saveT); saveT = setTimeout(flush, 150); };
addEventListener('pagehide', flush);

const ws = () => state.ws[state.active];
const visible = () => ws().items.filter(i => MODULES[i.type]);   // unknown types stay in data but are not drawn
const findWs = id => state.ws.find(w => w.id === id);
const backupNow = () => { try { localStorage.setItem(VEGA.state.BACKUP, localStorage.getItem(KEY) || ''); } catch { /* ignore */ } };

/* ═════════════ runtime variables ═════════════ */
const field = $('#field'), gridEl = $('#grid'), ph = $('#ph');
const tiles = new Map();          // id -> {it, el, body, api}
let focusId = null;
let editing = false;
let mode = 'normal';              // 'normal' | 'resize'
let layer = null;                 // open overlay (palette / modal)
let hasPerms = false;
let inner = null;                 // id of the tile the keyboard is "inside" (typing in notes, walking links...)
const undoStack = [];             // closures that restore the previous state
const pushUndo = fn => { undoStack.push(fn); if (undoStack.length > UNDO_CAP) undoStack.shift(); };

/* ═════════════ layout (DOM side of the grid) ═════════════ */
function metrics() {
  const W = Math.max(gridEl.clientWidth - 24, 0) || 1200;
  const H = Math.max(gridEl.clientHeight - 12, 0) || 700;
  return { cw: (W - GAP * (COLS - 1)) / COLS, ch: Math.max(58, (H - GAP * (ROWS - 1)) / ROWS) };
}

// Below ~700 px tiles stack in one column. Display only: saved x/y/w/h are never touched.
const stacked = () => gridEl.clientWidth > 0 && gridEl.clientWidth < 700;
const stackOrder = () => visible().sort((a, b) => a.y - b.y || a.x - b.x);

function layoutAll(skipId) {
  const m = metrics();
  const st = stacked();
  field.classList.toggle('stacked', st);
  if (st) {
    let top = 0;
    const W = gridEl.clientWidth - 24;
    for (const it of stackOrder()) {
      const r = tiles.get(it.id); if (!r) continue;
      const hh = Math.max(110, it.h * m.ch + (it.h - 1) * GAP);
      r.el.style.left = '0px'; r.el.style.top = top + 'px'; r.el.style.width = W + 'px'; r.el.style.height = hh + 'px';
      top += hh + GAP;
    }
    field.style.height = Math.max(top - GAP, 0) + 'px';
    return;
  }
  let rows = ROWS;
  for (const it of ws().items) rows = Math.max(rows, it.y + it.h);
  for (const [id, r] of tiles) {
    const it = r.it;
    if (id === skipId) continue;
    r.el.style.left = it.x * (m.cw + GAP) + 'px';
    r.el.style.top = it.y * (m.ch + GAP) + 'px';
    r.el.style.width = it.w * m.cw + (it.w - 1) * GAP + 'px';
    r.el.style.height = it.h * m.ch + (it.h - 1) * GAP + 'px';
  }
  field.style.height = rows * m.ch + (rows - 1) * GAP + 'px';
  field.style.setProperty('--cx', m.cw + GAP + 'px');
  field.style.setProperty('--cy', m.ch + GAP + 'px');
}

function placeGhost(it) {
  const m = metrics();
  ph.style.left = it.x * (m.cw + GAP) + 'px';
  ph.style.top = it.y * (m.ch + GAP) + 'px';
  ph.style.width = it.w * m.cw + (it.w - 1) * GAP + 'px';
  ph.style.height = it.h * m.ch + (it.h - 1) * GAP + 'px';
}

function commit(sim) {
  for (const s of sim) {
    const it = ws().items.find(i => i.id === s.id);
    if (it) { it.x = s.x; it.y = s.y; it.w = s.w; it.h = s.h; }
  }
}

function dragTrack(e, rec, kind) {
  if (e.button !== 0 || stacked()) return;
  if (e.target.closest('button, select, input, textarea')) return;
  e.preventDefault();
  e.stopPropagation();
  setFocus(rec.it.id);
  const it = rec.it, m = metrics(), snap = ws().items.map(i => ({ ...i }));
  const x0 = e.clientX, y0 = e.clientY;
  const left0 = it.x * (m.cw + GAP), top0 = it.y * (m.ch + GAP);
  const w0 = it.w, h0 = it.h, x00 = it.x, y00 = it.y;
  rec.el.classList.add('drag');
  ph.hidden = false;
  placeGhost(it);
  let last = '', dropEl = null;
  const dropAt = ev => {
    if (kind !== 'move') return null;
    const b = document.elementFromPoint(ev.clientX, ev.clientY);
    const t = b && b.closest ? b.closest('.wsb[data-ws]') : null;
    return t && +t.dataset.ws !== state.active ? t : null;
  };
  const move = ev => {
    const over = dropAt(ev);
    if (over !== dropEl) { if (dropEl) dropEl.classList.remove('drop'); dropEl = over; if (dropEl) dropEl.classList.add('drop'); }
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    let patch;
    if (kind === 'move') {
      rec.el.style.left = left0 + dx + 'px';
      rec.el.style.top = top0 + dy + 'px';
      patch = { x: Math.round((left0 + dx) / (m.cw + GAP)), y: Math.round((top0 + dy) / (m.ch + GAP)) };
    } else {
      patch = { w: w0 + Math.round(dx / (m.cw + GAP)), h: h0 + Math.round(dy / (m.ch + GAP)) };
    }
    const sig = JSON.stringify(patch);
    if (sig === last) return;
    last = sig;
    commit(computeLayout(snap, it.id, patch));
    layoutAll(kind === 'move' ? it.id : null);
    placeGhost(it);
  };
  const up = ev => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    rec.el.classList.remove('drag');
    ph.hidden = true;
    const target = dropEl && ev.type === 'pointerup' ? +dropEl.dataset.ws : null;
    if (dropEl) dropEl.classList.remove('drop');
    if (target !== null) {                       // dropped on a workspace: undo the layout preview, then send the tile
      commit(snap); layoutAll();
      return moveTileToWs(it.id, target);
    }
    layoutAll();
    if (it.x !== x00 || it.y !== y00 || it.w !== w0 || it.h !== h0) { save(); rec.api.resize && rec.api.resize(); }
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
}

function patchFocused(patch) {
  if (stacked()) return;
  const it = ws().items.find(i => i.id === focusId);
  if (!it) return;
  commit(computeLayout(ws().items, it.id, patch));
  layoutAll();
  save();
  const r = tiles.get(it.id); if (r && r.api.resize) r.api.resize();
}

function autopack() {
  packItems(ws().items);
  layoutAll(); save(); toast(S.tilesPacked);
}

function moveFocus(dir) {
  const its = visible();
  const cur = its.find(i => i.id === focusId) || its[0];
  if (!cur) return;
  if (stacked()) {            // one column: any direction walks the stacked order
    const o = stackOrder(), i = o.indexOf(cur), n = o[i + (dir === 'l' || dir === 'u' ? -1 : 1)];
    if (n) setFocus(n.id);
    return;
  }
  const best = neighbour(its, cur, dir);
  if (best) setFocus(best.id);
}

// "Inside" a tile the module owns the keyboard (arrows, typing); Esc comes back to tile level.
function syncInner() {
  for (const [id, r] of tiles) r.el.classList.toggle('inside', id === inner);
  const m = $('#mode'); if (m) m.textContent = modeText();
}
function enterTile(id) {
  const rec = tiles.get(id);
  if (!rec || !rec.api.enter) return;
  if (rec.api.enter() !== false) { inner = id; syncInner(); }
}
function leaveTile() {
  inner = null;
  if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
  syncInner();
}
const innerAlive = () => {
  if (inner === null) return false;
  const r = tiles.get(inner), a = document.activeElement;
  if (r && a && r.body.contains(a)) return true;
  inner = null; syncInner(); return false;      // focus left (redraw, mouse): stop swallowing keys
};

function setFocus(id) {
  if (inner !== null && inner !== id) { inner = null; syncInner(); }
  focusId = id;
  for (const [tid, r] of tiles) r.el.classList.toggle('focus', tid === id);
}

/* ═════════════ tiles ═════════════ */
function buildTile(it) {
  const mod = MODULES[it.type];
  const status = h('span', { class: 'ts' });
  const rec = { it, el: null, body: null, api: {} };
  const th = h('header', { class: 'th', onpointerdown: e => dragTrack(e, rec, 'move') },
    h('span', { class: 'tt', text: (it.cfg && it.cfg.name) || mod.title }), status,
    h('button', { class: 'tb tmn', title: S.tileMenu + ' (M)', 'aria-label': S.tileMenu, 'aria-haspopup': 'menu', onclick: e => openTileMenu(it.id, e.currentTarget) }, '…'),
    h('button', { class: 'tb tc', title: S.tileDelete + ' (X)', 'aria-label': S.tileDelete, onclick: () => removeTile(it.id) }, '×'));
  const body = h('div', { class: 'mb' });
  const rz = h('i', { class: 'rz', onpointerdown: e => dragTrack(e, rec, 'resize') });
  const el = h('section', { class: 'tile', 'data-type': it.type, 'data-id': it.id, onpointerdown: () => setFocus(it.id) }, th, body, rz);
  rec.el = el; rec.body = body;
  tiles.set(it.id, rec);
  field.append(el);
  rec.api = mod.render(body, { it, setStatus: t => { status.replaceChildren(t); }, setTitle: t => { th.querySelector('.tt').textContent = t || mod.title; }, editing }) || {};
  return rec;
}

let animT = 0;
function renderAll() {
  inner = null;
  // Tiles must not fly in from the corner: suppress transitions until positions are set.
  field.classList.add('no-anim');
  for (const r of tiles.values()) { r.api.destroy && r.api.destroy(); r.el.remove(); }
  tiles.clear();
  visible().forEach(buildTile);
  const old = field.querySelector('.wse'); if (old) old.remove();
  if (!visible().length) field.append(h('div', { class: 'wse' }, h('b', { text: S.wsEmptyTitle }), h('span', { text: S.wsEmptyHint }),
    h('div', { class: 'row' }, Object.keys(MODULES).map(t => h('button', { class: 'btn', onclick: () => addTile(t) }, '+ ' + MODULES[t].title)))));
  if (!visible().some(i => i.id === focusId)) focusId = visible()[0] ? visible()[0].id : null;
  setFocus(focusId);
  field.classList.toggle('edit', editing);
  layoutAll();
  renderBar();
  cancelAnimationFrame(animT);
  animT = requestAnimationFrame(() => { animT = requestAnimationFrame(() => field.classList.remove('no-anim')); });
}

function addTile(type) {
  const mod = MODULES[type], [w, hh] = mod.def, its = ws().items;
  const pos = firstFree(its, w, hh);
  const it = { id: uid(), type, x: pos.x, y: pos.y, w, h: hh, cfg: {} };
  its.push(it);
  save(); renderAll(); setFocus(it.id);
}

// Delete a tile. Its per-tile data moves into the undo entry, so nothing is left orphaned in state.data.
function removeTile(id) {
  const w = ws(), its = w.items, i = its.findIndex(t => t.id === id);
  if (i < 0) return;
  const rec = tiles.get(id); if (rec && rec.api.commit) rec.api.commit();
  const item = its[i], data = state.data[id], wsId = w.id;
  const next = nextFocusAfter(item);
  its.splice(i, 1);
  delete state.data[id];
  pushUndo(() => {
    const target = findWs(wsId) || ws();
    place(target.items, item);
    target.items.push(item);
    if (data !== undefined) state.data[id] = data;
    state.active = state.ws.indexOf(target);
    save(); renderAll(); setFocus(item.id);
  });
  focusId = next;
  save(); renderAll();
  toast(S.tileRemoved, S.undo, undo, 8000);
}

function duplicateTile(id) {
  const w = ws(), src = w.items.find(i => i.id === id);
  if (!src) return;
  const rec = tiles.get(id); if (rec && rec.api.commit) rec.api.commit();
  const pos = firstFree(w.items, src.w, src.h);
  const copy = { ...JSON.parse(JSON.stringify(src)), id: uid(), x: pos.x, y: pos.y };
  w.items.push(copy);
  if (state.data[id] !== undefined) state.data[copy.id] = JSON.parse(JSON.stringify(state.data[id]));
  const wsId = w.id;
  pushUndo(() => {
    const t = findWs(wsId); if (!t) return;
    t.items = t.items.filter(i => i.id !== copy.id); delete state.data[copy.id];
    state.active = state.ws.indexOf(t); save(); renderAll();
  });
  save(); renderAll(); setFocus(copy.id);
  toast(S.tileDuplicated, S.undo, undo, 8000);
}

function resetTileSize(id) {
  const w = ws(), it = w.items.find(i => i.id === id);
  if (!it) return;
  const [dw, dh] = MODULES[it.type].def, wsId = w.id;
  const before = w.items.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }));
  commit(computeLayout(w.items, id, { w: dw, h: dh }));
  pushUndo(() => {
    const t = findWs(wsId); if (!t) return;
    for (const b of before) { const i = t.items.find(x => x.id === b.id); if (i) Object.assign(i, b); }
    state.active = state.ws.indexOf(t); save(); renderAll(); setFocus(id);
  });
  layoutAll(); save();
  const rec = tiles.get(id); if (rec && rec.api.resize) rec.api.resize();
  toast(S.tileSizeReset, S.undo, undo, 8000);
}

// Per-tile menu: a small popover with arrow-key navigation. Opened by the header button or `m`.
function openTileMenu(id, anchor) {
  const it = ws().items.find(i => i.id === id);
  if (!it) return;
  setFocus(id);
  closeLayer();
  const opener = document.activeElement;
  const act = fn => () => { closeLayer(); fn(); };
  const items = [
    { label: S.tileDuplicate, run: act(() => duplicateTile(id)) },
    ...(tiles.get(id) && tiles.get(id).api.configure ? [{ label: S.tileConfigure, run: act(() => tiles.get(id).api.configure()) }] : []),
    { label: S.tileResetSize, hint: `${MODULES[it.type].def[0]}×${MODULES[it.type].def[1]}`, run: act(() => resetTileSize(id)) },
    ...state.ws.flatMap((w, i) => i === state.active ? [] : [{ label: S.tileMoveItem(w.name || String(i + 1)), hint: i < 9 ? `Shift+${i + 1}` : '', run: act(() => moveTileToWs(id, i)) }]),
    { label: S.tileDelete, hint: 'X', danger: true, sep: true, run: act(() => removeTile(id)) },
  ];
  const menu = h('div', { class: 'menu', role: 'menu', 'aria-label': S.tileMenu });
  const btns = items.map(m => {
    const b = h('button', { class: 'mi' + (m.danger ? ' danger' : ''), role: 'menuitem', onclick: m.run }, h('span', { text: m.label }), m.hint ? h('span', { class: 'phn', text: m.hint }) : null);
    if (m.sep) menu.append(h('div', { class: 'mdiv', role: 'separator' }));
    menu.append(b);
    return b;
  });
  const el = h('div', { class: 'layer mlayer', onmousedown: e => { if (e.target === el) closeLayer(); } }, menu);
  document.body.append(el);
  layer = { el, opener };
  const r = (anchor || tiles.get(id).el).getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = clamp(r.right - mw, 8, innerWidth - mw - 8) + 'px';
  menu.style.top = clamp(r.bottom + 4, 8, innerHeight - mh - 8) + 'px';
  let cur = 0; btns[0].focus();
  const go = n => { cur = (n + btns.length) % btns.length; btns[cur].focus(); };
  menu.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.code === 'KeyJ') { e.preventDefault(); go(cur + 1); }
    else if (e.key === 'ArrowUp' || e.code === 'KeyK') { e.preventDefault(); go(cur - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(btns.length - 1); }
    else if (e.key === 'Tab') { e.preventDefault(); go(cur + (e.shiftKey ? -1 : 1)); }
    else if (e.code === 'KeyX') { e.preventDefault(); items[items.length - 1].run(); }
  });
}

// Send a tile to another workspace. Identity (id, cfg, size) and per-tile data (notes) are preserved;
// it takes the first free slot there, or lands below the visible rows when that workspace is full.
function moveTileToWs(id, toIdx) {
  const from = ws(), to = state.ws[toIdx];
  if (!to) return toast(S.wsNone(toIdx + 1));
  if (to === from) return;
  const i = from.items.findIndex(t => t.id === id);
  if (i < 0) return;
  const rec = tiles.get(id); if (rec && rec.api.commit) rec.api.commit();
  const item = from.items[i], old = { x: item.x, y: item.y }, next = nextFocusAfter(item);
  const pos = firstFree(to.items, item.w, item.h);
  const full = pos.y + item.h > ROWS;
  from.items.splice(i, 1);
  Object.assign(item, pos);
  to.items.push(item);
  const fromId = from.id, toId = to.id;
  pushUndo(() => {
    const src = findWs(fromId), dst = findWs(toId);
    if (!src || !dst) return;
    dst.items = dst.items.filter(t => t.id !== id);
    Object.assign(item, old); place(src.items, item); src.items.push(item);
    state.active = state.ws.indexOf(src); save(); renderAll(); setFocus(id);
  });
  focusId = next;
  save(); renderAll();
  const name = to.name || String(toIdx + 1);
  toast(full ? S.tileMovedFull(name) : S.tileMoved(name), S.undo, undo, 8000);
}

function nextFocusAfter(item) {
  const others = visible().filter(o => o.id !== item.id);
  if (!others.length) return null;
  return (neighbour(others, item, 'r') || neighbour(others, item, 'd') || neighbour(others, item, 'l') || neighbour(others, item, 'u') || others[0]).id;
}

function undo() {
  const fn = undoStack.pop();
  if (!fn) return toast(S.nothingToUndo);
  fn();
}

const refresh = type => { for (const r of tiles.values()) if (r.it.type === type && r.api.refresh) r.api.refresh(); };

/* ═════════════ workspaces + bar ═════════════ */
function switchWs(i) {
  if (i < 0 || i >= state.ws.length) return;
  state.active = i; focusId = null; save(); renderAll();
}
function newWs() {
  state.ws.push({ id: uid(), name: S.wsDefaultName, items: [] });
  switchWs(state.ws.length - 1);
  toast(S.wsCreated);
}
// Rename in place, like a sheet tab: double-click (or F2 / the command bar) turns the tab's name into a text field.
function renameWs(i = state.active) {
  const btn = $('#wsbar').querySelector(`.wsb[data-ws="${i}"]`), w = state.ws[i];
  if (!btn || !w || btn.querySelector('input')) return;
  const inp = h('input', { class: 'wsi', value: w.name || '', maxlength: 20, 'aria-label': S.wsRenamePrompt, spellcheck: 'false', autocomplete: 'off' });
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    if (ok) { w.name = inp.value.trim().slice(0, 20); save(); }
    renderBar();
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();                                   // typing must not trigger hotkeys
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); finish(true); }
    else if (e.code === 'Escape') { e.preventDefault(); finish(false); }
  });
  inp.addEventListener('blur', () => finish(true));
  inp.addEventListener('click', e => e.stopPropagation());
  inp.addEventListener('dblclick', e => e.stopPropagation());
  // an input inside a <button> cannot take focus in Firefox, so the whole tab is swapped for a plain box
  const box = h('div', { class: btn.className, 'data-ws': i }, btn.querySelector('b').cloneNode(true), inp);
  btn.replaceWith(box);
  inp.focus(); inp.select();
}
function delWs() {
  if (state.ws.length < 2) return toast(S.wsNeedOne);
  if (!confirm(S.wsDeleteConfirm(ws().name))) return;
  for (const it of ws().items) delete state.data[it.id];
  state.ws.splice(state.active, 1);
  state.active = clamp(state.active, 0, state.ws.length - 1);
  save(); renderAll();
}

const modeText = () => mode === 'resize' ? S.modeResize : inner !== null ? S.modeInside : editing ? S.modeEdit : '';

// Two clicks on a tab within 450 ms rename it. Timing is used instead of the dblclick event because switching
// workspace redraws the bar between the clicks, and Firefox then does not deliver dblclick.
let lastTab = { i: -1, t: 0 };
function tabClick(i) {
  const now = Date.now(), twice = lastTab.i === i && now - lastTab.t < 450;
  lastTab = twice ? { i: -1, t: 0 } : { i, t: now };
  if (twice) { if (state.active !== i) switchWs(i); renameWs(i); } else switchWs(i);
}

function renderBar() {
  const nav = $('#wsbar');
  nav.replaceChildren(
    ...state.ws.map((w, i) => h('button', { class: 'wsb' + (i === state.active ? ' on' : ''), onclick: () => tabClick(i), title: S.wsTitle(i + 1) + ' · ' + S.wsRenameHint, 'data-ws': i },
      h('b', { text: i + 1 }), w.name && w.name !== String(i + 1) ? h('span', { class: 'wsn', text: w.name }) : null)),
    h('button', { class: 'wsb', onclick: newWs, title: S.wsNewTitle, 'aria-label': S.wsNewTitle }, '+'));
  $('#mode').textContent = modeText();
  document.body.classList.toggle('resizing', mode === 'resize');
}

function toggleEdit() {
  editing = !editing; mode = 'normal';
  renderAll();
}
function setMode(m) { mode = m; renderBar(); }

/* ═════════════ toast ═════════════ */
let toastT = 0;
function toast(msg, label, fn, ms) {
  const t = $('#toast');
  t.replaceChildren(...[h('span', { text: msg }), label ? h('button', { onclick: () => { t.hidden = true; fn(); } }, label) : null].filter(Boolean));
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms || (label ? 6000 : 2600));
}

/* ═════════════ timer + one global ticker ═════════════ */
const timerLen = m => (m === 'focus' ? state.settings.focusMin : state.settings.breakMin) * 60;
const timerLeft = () => state.timer.running ? Math.max(0, Math.round((state.timer.endsAt - Date.now()) / 1000)) : state.timer.remaining;
const mmss = s => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
function timerToggle() {
  const t = state.timer;
  if (t.running) { t.remaining = timerLeft(); t.running = false; }
  else { t.endsAt = Date.now() + t.remaining * 1000; t.running = true; }
  save(); tickAll();
}
function timerReset() { const t = state.timer; t.running = false; t.remaining = timerLen(t.mode); save(); tickAll(); }
function timerSkip() { state.timer.mode = state.timer.mode === 'focus' ? 'break' : 'focus'; timerReset(); }
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .28].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.15, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + d + .22);
      o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .24);
    });
  } catch { /* audio blocked until the first interaction */ }
}
function tickAll() {
  const t = state.timer;
  if (t.running && Date.now() >= t.endsAt) {
    beep();
    toast(t.mode === 'focus' ? S.timerFocusDone : S.timerBreakDone);
    t.mode = t.mode === 'focus' ? 'break' : 'focus'; t.running = false; t.remaining = timerLen(t.mode); save();
  }
  const left = timerLeft();
  const label = t.mode === 'focus' ? S.timerFocus : S.timerBreak;
  document.title = t.running ? `${mmss(left)} ${label}` : S.pageTitle;
  $('#tinfo').textContent = t.running ? `${label} ${mmss(left)}` : '';
  for (const r of tiles.values()) r.api.tick && r.api.tick();
  ambientTick();
}

/* ═════════════ widget settings: small form helpers shared by every configurable tile ═════════════ */
const W = VEGA.w;
const fld = (label, ctl) => h('label', { class: 'fr' }, h('span', { text: label }), ctl);
const mkSel = (label, opts, cur) => h('select', { class: 'fi', 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(cur) }, t)));
const mkChk = on => h('input', { type: 'checkbox', checked: on });
const mkText = (label, val, ph, max) => h('input', { class: 'fi', value: val || '', placeholder: ph || '', maxlength: max || 60, 'aria-label': label, autocomplete: 'off', spellcheck: 'false' });
const chkRow = (label, ctl) => h('label', { class: 'fr chk' }, h('span', { text: label }), ctl);

function cfgModal(title, rows, done) {
  openModal(S.cf.configure(title), rows, [h('button', { class: 'btn', type: 'button', onclick: closeLayer }, S.cancel), h('button', { class: 'btn main', type: 'button', onclick: done }, S.cf.save)]);
  layer.el.addEventListener('keydown', e => { if (e.code === 'Enter' && e.target.matches && e.target.matches('input:not([type=checkbox]):not([type=range])')) { e.preventDefault(); done(); } });
}

// Write the cleaned settings into the tile (empty values are removed, so defaults stay implicit) and redraw its title.
function applyCfg(it, ctx, next) {
  for (const k of Object.keys(next)) { if (next[k] === undefined || next[k] === '') delete it.cfg[k]; else it.cfg[k] = next[k]; }
  ctx.setTitle(it.cfg.name);
  save();
}

// A list the user can add rows to and remove rows from. makeRow(item) -> { el, read(), focus() }.
function listEditor(items, makeRow, blank, max) {
  const rows = [], box = h('div', { class: 'led' });
  const addBtn = h('button', { class: 'btn', type: 'button', onclick: () => add(blank(), true) }, '+ ' + S.cf.add);
  const sync = () => { addBtn.disabled = rows.length >= max; };
  const add = (item, focus) => {
    if (rows.length >= max) return;
    const r = makeRow(item);
    const wrap = h('div', { class: 'led-r' }, r.el, h('button', { class: 'btn', type: 'button', title: S.cf.remove, 'aria-label': S.cf.remove, onclick: () => { rows.splice(rows.findIndex(x => x.r === r), 1); wrap.remove(); sync(); } }, '×'));
    rows.push({ r, wrap }); box.append(wrap); sync();
    if (focus && r.focus) r.focus();
  };
  items.forEach(i => add(i));
  return { el: h('div', { class: 'led-w' }, box, addBtn), read: () => rows.map(x => x.r.read()) };
}

/* ═════════════ modules ═════════════ */
const svgEl = (tag, attrs) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); return e; };
const PAR = { left: 'xMin', center: 'xMid', right: 'xMax', top: 'YMin', middle: 'YMid', bottom: 'YMax' };

MODULES.clock.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'ck' });
  body.append(root);
  let c = W.clockCfg(it.cfg), paint = () => {};
  const put = (...n) => root.replaceChildren(...n.filter(Boolean));
  const build = () => {
    c = W.clockCfg(it.cfg);
    root.dataset.style = c.style; root.dataset.align = c.align; root.dataset.valign = c.valign; root.dataset.weight = c.weight;
    const d = c.date !== 'none' && c.style !== 'minimal' ? h('div', { class: 'ck-d' }) : null;
    const p = c.progress && c.style !== 'minimal' && c.style !== 'binary' ? h('div', { class: 'ck-p' }, h('i')) : null;
    const tail = n => { const pr = (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400; if (d) d.textContent = W.dateText(n, c.date, S.locale); if (p) { p.firstChild.style.width = (pr * 100).toFixed(2) + '%'; p.title = S.dayPassed(Math.round(pr * 100)); } };
    if (c.style === 'analog') {
      const svg = svgEl('svg', { viewBox: '-50 -50 100 100', class: 'ck-a', role: 'img', preserveAspectRatio: PAR[c.align] + PAR[c.valign] + ' meet' });
      svg.append(svgEl('circle', { r: 47, class: 'ck-face' }));
      for (let i = 0; i < 12; i++) svg.append(svgEl('line', { x1: 0, y1: -43, x2: 0, y2: i % 3 ? -40 : -37, class: i % 3 ? 'ck-tick' : 'ck-tick maj', transform: `rotate(${i * 30})` }));
      const hh = svgEl('line', { x1: 0, y1: 4, x2: 0, y2: -24, class: 'ck-hh' }), mh = svgEl('line', { x1: 0, y1: 5, x2: 0, y2: -36, class: 'ck-mh' }), sh = svgEl('line', { x1: 0, y1: 8, x2: 0, y2: -39, class: 'ck-sh' });
      svg.append(...[hh, mh, c.seconds ? sh : null, svgEl('circle', { r: 2.2, class: 'ck-pin' })].filter(Boolean));
      put(svg, d, p);
      paint = n => { const a = W.analogAngles(n); hh.setAttribute('transform', `rotate(${a.hour})`); mh.setAttribute('transform', `rotate(${a.minute})`); sh.setAttribute('transform', `rotate(${a.second})`); tail(n); };
    } else if (c.style === 'binary') {
      const cols = [];
      const mk = () => { const col = h('div', { class: 'ck-bc' }, [0, 1, 2, 3].map(() => h('i'))); cols.push(col); return col; };
      const groups = c.seconds ? 3 : 2;
      put(h('div', { class: 'ck-b', role: 'img' }, Array.from({ length: groups }, () => h('div', { class: 'ck-bg' }, mk(), mk()))), d);
      paint = n => {
        const pr = W.clockParts(n, false), digits = (pr.hh + pr.mm + (c.seconds ? pr.ss : '')).split('');
        W.bcd(digits).forEach((bits, i) => [...cols[i].children].forEach((dot, k) => dot.classList.toggle('on', !!bits[k])));
        root.firstChild.setAttribute('aria-label', `${pr.hh}:${pr.mm}${c.seconds ? ':' + pr.ss : ''}`);
        tail(n);
      };
    } else if (c.style === 'words') {
      const w = h('div', { class: 'ck-w' });
      put(w, d, p);
      paint = n => { w.textContent = W.timeWords(n.getHours(), n.getMinutes()); tail(n); };
    } else if (c.style === 'stacked') {
      const hn = document.createTextNode(''), ap = c.hour12 ? h('small', { class: 'ck-ap' }) : null, a = h('div', { class: 'ck-h' }, hn, ap);
      const b = h('div', { class: 'ck-m' }), s = c.seconds ? h('small', { class: 'ck-s' }) : null;
      put(a, h('div', { class: 'ck-mr' }, b, s), d, p);
      paint = n => { const pr = W.clockParts(n, c.hour12); hn.nodeValue = pr.hh; if (ap) ap.textContent = pr.ampm; b.textContent = pr.mm; if (s) s.textContent = pr.ss; tail(n); };
    } else {                                           // standard, large, minimal
      const t = h('div', { class: 'ck-t' }), s = c.seconds ? h('small', { class: 'ck-s' }) : null, ap = c.hour12 ? h('small', { class: 'ck-ap' }) : null;
      const txt = document.createTextNode('');
      t.append(...[txt, ap, s].filter(Boolean));
      put(t, d, p);
      paint = n => { const pr = W.clockParts(n, c.hour12); txt.nodeValue = pr.hh + ':' + pr.mm; if (ap) ap.textContent = pr.ampm; if (s) s.textContent = pr.ss; tail(n); };
    }
    paint(new Date());
  };
  const configure = () => {
    const x = W.clockCfg(it.cfg);
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const style = mkSel(S.ck.style, W.CLOCK_STYLES.map(v => [v, S.ck.styles[v]]), x.style);
    const align = mkSel(S.cf.horizontal, W.ALIGN_H.map(v => [v, S.cf[v]]), x.align), valign = mkSel(S.cf.vertical, W.ALIGN_V.map(v => [v, S.cf[v]]), x.valign);
    const weight = mkSel(S.ck.weight, W.WEIGHTS.map(v => [v, S.ck.weights[v]]), x.weight), date = mkSel(S.ck.date, W.DATE_FORMATS.map(v => [v, S.ck.dates[v]]), x.date);
    const h12 = mkChk(x.hour12), sec = mkChk(x.seconds), prog = mkChk(x.progress);
    cfgModal(MODULES.clock.title, [fld(S.cf.name, name), fld(S.ck.style, style), fld(S.cf.horizontal, align), fld(S.cf.vertical, valign), fld(S.ck.weight, weight), fld(S.ck.date, date),
      chkRow(S.ck.hour12, h12), chkRow(S.ck.seconds, sec), chkRow(S.ck.progress, prog)], () => {
      applyCfg(it, ctx, { name: name.value.trim(), style: style.value, align: align.value, valign: valign.value, weight: weight.value, date: date.value, hour12: h12.checked, seconds: sec.checked, progress: prog.checked });
      build(); closeLayer();
    });
  };
  build();
  return { tick: () => paint(new Date()), refresh: build, configure };
};

const WX = c => c === 0 ? S.wx.clear : c === 1 ? S.wx.mostlyClear : c === 2 ? S.wx.partly : c === 3 ? S.wx.cloudy
  : c <= 48 ? S.wx.fog : c <= 57 ? S.wx.drizzle : c <= 67 ? S.wx.rain : c <= 77 ? S.wx.snow : c <= 82 ? S.wx.showers : c <= 86 ? S.wx.snowShowers : S.wx.storm;
const deg = v => Math.round(v).toString().replace('-', '−') + '°';

async function getWeather(force) {
  const s = state.settings;
  let c = null;
  try { c = JSON.parse(localStorage.getItem(WKEY)); } catch { /* ignore */ }
  if (c && c.lat === s.lat && c.lon === s.lon && Date.now() - c.ts < 15 * 60e3 && !force) return c;
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${s.lat}&longitude=${s.lon}`
      + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&wind_speed_unit=ms'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4';
    const r = await fetch(u);
    if (!r.ok) throw new Error(r.status);
    c = { ts: Date.now(), lat: s.lat, lon: s.lon, j: await r.json() };
    try { localStorage.setItem(WKEY, JSON.stringify(c)); } catch { /* ignore */ }
    return c;
  } catch {
    return c && c.lat === s.lat && c.lon === s.lon ? { ...c, stale: true } : null;
  }
}

MODULES.weather.render = (body, ctx) => {
  const root = h('div', { class: 'wx', title: S.wxTitle });
  body.append(root);
  let dead = false;
  root.replaceChildren(h('div', { class: 'wx-n', text: '…' }));   // placeholder until data arrives
  const draw = c => {
    if (!c) { root.replaceChildren(h('div', { class: 'wx-c', text: S.wxNoData }), h('div', { class: 'wx-m', text: S.wxRetry })); return; }
    const j = c.j, cur = j.current;
    const dn = new Intl.DateTimeFormat(S.locale, { weekday: 'short' });
    root.replaceChildren(
      h('div', { class: 'wx-n', text: deg(cur.temperature_2m) }),
      h('div', { class: 'wx-c', text: WX(cur.weather_code) }),
      h('div', { class: 'wx-m', text: S.wxFeels(deg(cur.apparent_temperature), Math.round(cur.wind_speed_10m)) }),
      h('div', { class: 'wx-fc' }, [1, 2, 3].map(i => h('div', {}, dn.format(new Date(j.daily.time[i])), h('b', { text: `${deg(j.daily.temperature_2m_min[i])} / ${deg(j.daily.temperature_2m_max[i])}` })))));
    ctx.setStatus(state.settings.place + (c.stale ? S.wxStale : ''));
  };
  const load = async force => { const c = await getWeather(force); if (!dead) draw(c); };
  try { const cached = JSON.parse(localStorage.getItem(WKEY)); if (cached && cached.j) draw(cached); } catch { /* ignore */ }
  load(false);
  root.addEventListener('click', () => load(true));
  const iv = setInterval(() => load(false), 15 * 60e3);
  return { destroy() { dead = true; clearInterval(iv); }, refresh: () => load(true), enter: () => { load(true); return false; } };
};

MODULES.timer.render = body => {
  const C = 2 * Math.PI * 46;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('class', 'tm-r');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('class', 'tm-bg'); bg.setAttribute('cx', 50); bg.setAttribute('cy', 50); bg.setAttribute('r', 46);
  const fgs = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fgs.setAttribute('class', 'tm-fg'); fgs.setAttribute('cx', 50); fgs.setAttribute('cy', 50); fgs.setAttribute('r', 46);
  fgs.style.strokeDasharray = C;
  svg.append(bg, fgs);
  const time = h('div', { class: 'tm-t' }), lab = h('div', { class: 'tm-l' });
  const go = h('button', { class: 'btn main', onclick: timerToggle });
  const root = h('div', { class: 'tm' },
    svg, time, lab,
    h('div', { class: 'tm-b' }, go, h('button', { class: 'btn', onclick: timerReset, title: S.timerResetTitle }, S.timerReset), h('button', { class: 'btn', onclick: timerSkip, title: S.timerNextTitle }, S.timerNext)));
  body.append(root);
  const tick = () => {
    const t = state.timer, left = timerLeft(), len = timerLen(t.mode);
    time.textContent = mmss(left);
    fgs.style.strokeDashoffset = C * (1 - left / len);
    root.classList.toggle('break', t.mode === 'break');
    go.textContent = t.running ? S.timerPause : S.timerStart;
    lab.textContent = t.mode === 'focus' ? S.timerFocus : S.timerBreak;
  };
  tick();
  const btns = () => [...root.querySelectorAll('.tm-b .btn')].filter(b => b.offsetParent !== null);
  root.addEventListener('keydown', e => {            // left/right (or h/l) between the buttons
    const d = e.key === 'ArrowRight' || e.code === 'KeyL' ? 1 : e.key === 'ArrowLeft' || e.code === 'KeyH' ? -1 : 0;
    if (!d) return;
    const b = btns(), i = b.indexOf(document.activeElement);
    if (i >= 0) { e.preventDefault(); b[clamp(i + d, 0, b.length - 1)].focus(); }
  });
  return { tick, enter: () => { const b = btns(); if (!b.length) return false; b[0].focus(); } };
};

function addTask(text) {
  const v = text.trim();
  if (!v) return;
  state.tasks.push({ id: uid(), text: v, done: false });
  save(); refresh('tasks'); toast(S.taskAdded);
}

MODULES.tasks.render = (body, ctx) => {
  const inp = h('input', { class: 'ti', placeholder: S.taskPlaceholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': S.taskNew });
  const list = h('ul', { class: 'tl' });
  let restore = -1;                                   // keep keyboard position after the list is redrawn
  const rows = () => [...list.querySelectorAll('.cb')];
  const draw = () => {
    const open = state.tasks.filter(t => !t.done), done = state.tasks.filter(t => t.done);
    list.replaceChildren(...[...open, ...done].map(t => h('li', { class: t.done ? 'done' : '' },
      h('button', { class: 'cb', title: S.taskDone, 'aria-label': S.taskDone, onclick: () => { restore = rows().findIndex(b => b.closest('li') === li(t)); t.done = !t.done; save(); refresh('tasks'); } }),
      h('span', { class: 'tx', text: t.text }),
      h('button', { class: 'tdel', title: S.taskDelete, 'aria-label': S.taskDeleteAria, onclick: () => remove(t) }, '×'))));
    if (!state.tasks.length) list.append(h('li', { class: 'empty' }, S.tasksEmpty));
    ctx.setStatus(open.length ? S.tasksOpen(open.length) : '');
    if (restore >= 0) { const r = rows(); if (r.length) r[Math.min(restore, r.length - 1)].focus(); else inp.focus(); restore = -1; }
  };
  const order = () => [...state.tasks.filter(t => !t.done), ...state.tasks.filter(t => t.done)];
  const li = t => list.children[order().indexOf(t)];
  const remove = t => { restore = Math.max(0, order().indexOf(t)); state.tasks = state.tasks.filter(x => x !== t); save(); refresh('tasks'); };
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && inp.value.trim()) { addTask(inp.value); inp.value = ''; inp.focus(); }
    else if (e.key === 'ArrowDown') { const r = rows(); if (r.length) { e.preventDefault(); r[0].focus(); } }
  });
  list.addEventListener('keydown', e => {              // inside the list: arrows or j/k, x or Delete removes, i goes back to typing
    const r = rows(), i = r.indexOf(e.target.closest('.cb')), cur = i >= 0 ? i : r.findIndex(b => b.closest('li') === e.target.closest('li'));
    if (cur < 0) return;
    if (e.key === 'ArrowDown' || e.code === 'KeyJ') { e.preventDefault(); r[Math.min(cur + 1, r.length - 1)].focus(); }
    else if (e.key === 'ArrowUp' || e.code === 'KeyK') { e.preventDefault(); if (cur === 0) inp.focus(); else r[cur - 1].focus(); }
    else if (e.code === 'KeyX' || e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(order()[cur]); }
    else if (e.code === 'KeyI') { e.preventDefault(); inp.focus(); }
  });
  body.append(h('div', { class: 'ta' }, inp, list));
  draw();
  return { refresh: draw, enter: () => { inp.focus(); } };
};

MODULES.notes.render = (body, ctx) => {
  const id = ctx.it.id;
  const ta = h('textarea', { class: 'nt', placeholder: S.notesPlaceholder, spellcheck: 'false', 'aria-label': S.notesLabel });
  ta.value = (state.data[id] && state.data[id].text) || '';
  let t = 0, dirty = false;
  // Writes pending text immediately; never resurrects data for a tile that no longer exists.
  const commitNow = () => {
    clearTimeout(t);
    if (!dirty) return;
    dirty = false;
    if (state.ws.some(w => w.items.some(i => i.id === id))) { state.data[id] = { text: ta.value }; save(); }
  };
  ta.addEventListener('input', () => { dirty = true; clearTimeout(t); t = setTimeout(commitNow, 250); });
  body.append(ta);
  return { commit: commitNow, destroy: commitNow, enter: () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } };
};

const gkey = g => (g.tab || '') + '/' + g.name;           // groups are referenced by tab and name: ids are rebuilt when links are edited in Settings

MODULES.links.render = (body, ctx) => {
  const it = ctx.it;
  const draw = () => {
    const c = W.linksCfg(it.cfg);
    const groups = state.groups.filter(g => c.groups ? c.groups.includes(gkey(g)) : (!c.tab || g.tab === c.tab));
    const mark = l => {
      if (c.icons === 'none') return null;
      const col = dotColor(l);
      const i = c.icons === 'letter' ? h('i', { class: 'lt', text: (String(l.name).trim()[0] || '?').toUpperCase() }) : h('i');
      if (col) i.style.setProperty('--c', col);
      return i;
    };
    const lg = h('div', { class: 'lg', 'data-layout': c.layout, 'data-size': c.size, 'data-align': c.align, 'data-icons': c.icons }, groups.map(g => h('div', { class: 'lgg' },
      c.headers ? h('div', { class: 'lgh', text: g.name }) : null,
      g.links.map(l => h('a', { class: 'lk', href: safeUrl(l.url), target: c.newTab ? '_blank' : null, rel: c.newTab ? 'noopener noreferrer' : null }, mark(l), l.name)))));
    if (c.cols) lg.style.gridTemplateColumns = `repeat(${c.cols}, minmax(0, 1fr))`;
    if (c.color) lg.style.setProperty('--lgh', `var(--${c.color})`);
    body.replaceChildren(groups.length ? lg : h('div', { class: 'empty' }, S.linksEmpty));
    if (!ctx.editing) ctx.setStatus(c.groups ? '' : it.cfg.tab || '');
  };
  draw();
  if (ctx.editing) {
    const tabs = [...new Set(state.groups.map(g => g.tab).filter(Boolean))];
    const sel = h('select', { 'aria-label': S.linksTabPick, onchange: () => { it.cfg.tab = sel.value || undefined; save(); draw(); } },
      h('option', { value: '' }, S.linksAll), tabs.map(t => h('option', { value: t, selected: t === it.cfg.tab }, t)));
    ctx.setStatus(sel);
  }
  body.addEventListener('keydown', e => {              // arrows or h/j/k/l: nearest link in that direction
    const dir = DIRS[e.code]; if (!dir || e.ctrlKey || e.altKey || e.metaKey) return;
    const links = [...body.querySelectorAll('a.lk')], cur = links.indexOf(document.activeElement);
    if (cur < 0) return;
    e.preventDefault();
    const box = a => { const r = a.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, a }; };
    const items = links.map(box), n = neighbour(items, items[cur], dir);
    if (n) { n.a.focus(); n.a.scrollIntoView({ block: 'nearest' }); }
  });

  const configure = () => {
    const x = W.linksCfg(it.cfg), picked = new Set(x.groups || []);
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const layout = mkSel(S.lc.layout, W.LINK_LAYOUTS.map(v => [v, S.lc.layouts[v]]), x.layout);
    const cols = mkSel(S.lc.cols, [[0, S.lc.colsAuto], [1, '1'], [2, '2'], [3, '3'], [4, '4']], x.cols);
    const align = mkSel(S.cf.horizontal, W.ALIGN_H.map(v => [v, S.cf[v]]), x.align);
    const icons = mkSel(S.lc.icons, W.LINK_ICONS.map(v => [v, S.lc.iconsOpt[v]]), x.icons);
    const size = mkSel(S.lc.size, W.LINK_SIZES.map(v => [v, S.lc.sizes[v]]), x.size);
    const color = mkSel(S.lc.color, W.LINK_COLORS.map(v => [v, v ? S.lc.colors[v] : S.lc.colorAuto]), x.color);
    const headers = mkChk(x.headers), newTab = mkChk(x.newTab);
    const boxes = state.groups.map(g => ({ g, el: h('input', { type: 'checkbox', checked: picked.has(gkey(g)), 'aria-label': (g.tab ? g.tab + ' / ' : '') + g.name }) }));
    const groupList = h('div', { class: 'lc-groups' }, boxes.map(b => h('label', { class: 'lc-g' }, b.el, h('span', { text: (b.g.tab ? b.g.tab + ' / ' : '') + b.g.name }))));
    // quick add: a new link without leaving the page
    const qg = mkSel(S.lc.quickGroup, state.groups.map((g, i) => [i, (g.tab ? g.tab + ' / ' : '') + g.name]), 0);
    const qn = mkText(S.lc.quickName, '', S.lc.quickName, 40), qu = mkText(S.lc.quickUrl, '', S.lc.quickUrl, 500);
    const qAdd = () => {
      const g = state.groups[+qg.value], n = qn.value.trim(), u = qu.value.trim();
      if (!g || !n || !/^https?:\/\/\S+$/i.test(u)) return toast(S.lc.quickBad);
      g.links.push({ name: n, url: u });
      qn.value = ''; qu.value = ''; save(); refresh('links'); toast(S.lc.quickDone); qn.focus();
    };
    const quick = state.groups.length ? [h('h3', { text: S.lc.quickAdd }), fld(S.lc.quickGroup, qg), fld(S.lc.quickName, qn), fld(S.lc.quickUrl, qu), h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: qAdd }, S.cf.add))] : [];
    cfgModal(MODULES.links.title, [fld(S.cf.name, name), h('h3', { text: S.lc.groups }), h('div', { class: 'note', text: S.lc.groupsAuto }), groupList,
      h('h3', { text: S.lc.layout }), fld(S.lc.layout, layout), fld(S.lc.cols, cols), fld(S.cf.horizontal, align), fld(S.lc.icons, icons), fld(S.lc.size, size), fld(S.lc.color, color),
      chkRow(S.lc.headers, headers), chkRow(S.lc.newTab, newTab), ...quick], () => {
      const chosen = boxes.filter(b => b.el.checked).map(b => gkey(b.g));
      applyCfg(it, ctx, { name: name.value.trim(), groups: chosen.length ? chosen : undefined, layout: layout.value, cols: +cols.value || undefined, align: align.value, icons: icons.value, size: size.value, color: color.value, headers: headers.checked, newTab: newTab.checked });
      draw(); closeLayer();
    });
  };
  return { refresh: draw, configure, enter: () => { const a = body.querySelector('a.lk'); if (!a) return false; a.focus(); } };
};

/* ═════════════ world clocks ═════════════ */
MODULES.worldclock.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'wc' });
  body.append(root);
  let c = W.worldCfg(it.cfg), cells = [];
  const fmt = (z, now) => {
    const t = W.zoneNow(z.tz, now), pr = W.clockParts(new Date(2000, 0, 1, t.hour, t.minute, t.second), c.hour12);
    return { t, text: pr.hh + ':' + pr.mm + (c.seconds ? ':' + pr.ss : '') + (pr.ampm ? ' ' + pr.ampm : '') };
  };
  const sub = t => [c.offsets ? W.diffText(t.diffMin) : '', t.dayDiff ? (t.dayDiff > 0 ? S.wc.tomorrow : S.wc.yesterday) : ''].filter(Boolean).join(' · ');
  const draw = () => {
    c = W.worldCfg(it.cfg);
    const localTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
    const zs = [...(c.local ? [{ tz: localTz, label: S.wc.yourTime, here: true }] : []), ...c.zones];
    if (!zs.length) { cells = []; root.replaceChildren(h('div', { class: 'empty', text: S.wc.empty })); return; }
    cells = zs.map(z => ({ z, name: h('span', { class: 'wc-n', text: z.label || W.zoneLabel(z.tz) }), time: h('b', { class: 'wc-t' }), sub: h('span', { class: 'wc-s' }) }));
    root.replaceChildren(...cells.map(x => h('div', { class: 'wc-r' + (x.z.here ? ' here' : '') }, x.name, x.time, x.sub)));
    tick();
  };
  const tick = () => {
    const now = new Date();
    for (const x of cells) { const r = fmt(x.z, now); x.time.textContent = r.text; x.sub.textContent = x.z.here ? '' : sub(r.t); }
  };
  const configure = () => {
    const x = W.worldCfg(it.cfg);
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const list = h('datalist', { id: 'wc-zones' }, W.COMMON_ZONES.filter(W.validZone).map(z => h('option', { value: z })));
    const ed = listEditor(x.zones, z => {
      const tz = h('input', { class: 'fi', value: z.tz, list: 'wc-zones', placeholder: S.wc.zonePh, 'aria-label': S.wc.zones, autocomplete: 'off', spellcheck: 'false' });
      const label = mkText(S.wc.labelPh, z.label, S.wc.labelPh, 24);
      return { el: h('div', { class: 'led-f' }, tz, label), read: () => ({ tz: tz.value.trim(), label: label.value.trim() }), focus: () => tz.focus() };
    }, () => ({ tz: '', label: '' }), 8);
    const loc = mkChk(x.local), off = mkChk(x.offsets), h12 = mkChk(x.hour12), sec = mkChk(x.seconds);
    cfgModal(MODULES.worldclock.title, [fld(S.cf.name, name), h('h3', { text: S.wc.zones }), ed.el, list,
      chkRow(S.wc.local, loc), chkRow(S.wc.offsets, off), chkRow(S.wc.hour12, h12), chkRow(S.wc.seconds, sec)], () => {
      const zones = ed.read().filter(z => z.tz);
      const bad = zones.find(z => !W.validZone(z.tz));
      if (bad) return toast(S.wc.badZone(bad.tz));
      applyCfg(it, ctx, { name: name.value.trim(), zones, local: loc.checked, offsets: off.checked, hour12: h12.checked, seconds: sec.checked });
      draw(); closeLayer();
    });
  };
  draw();
  return { tick, refresh: draw, configure };
};

/* ═════════════ countdown ═════════════ */
MODULES.countdown.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'cd' });
  body.append(root);
  let c = W.countdownCfg(it.cfg), last = '';
  const parts = r => {
    if (r.today) return { big: S.cd.today[0].toUpperCase() + S.cd.today.slice(1), unit: '' };
    if (r.past) return r.timed ? { big: S.cd.passedTimed, unit: '' } : r.absDays === 1 ? { big: 'Yesterday', unit: '' } : { big: String(r.absDays), unit: 'days ago' };
    if (c.detail === 'full') return { big: r.d ? S.cd.left(r.d, r.h, r.m) : S.cd.leftShort(r.h, r.m, r.s), unit: '' };
    if (r.timed && r.days < 1) return { big: r.h ? `${r.h}h ${r.m}m` : `${r.m}m`, unit: '' };
    return { big: String(r.absDays), unit: S.cd.daysUnit(r.absDays) };
  };
  const draw = () => {
    c = W.countdownCfg(it.cfg);
    const now = new Date();
    let list = W.sortEvents(c.events, now, c.order);
    if (c.hidePast) list = list.filter(x => !x.c.past);
    last = key();
    if (!list.length) { root.replaceChildren(h('div', { class: 'empty', text: S.cd.empty })); root.dataset.n = '0'; return; }
    root.dataset.n = String(Math.min(list.length, 4));
    root.replaceChildren(...list.map(({ e, c: r }) => {
      const p = parts(r);
      return h('div', { class: 'cd-r' + (r.past ? ' past' : '') + (r.today ? ' today' : ''), title: r.target.toLocaleString(S.locale) },
        h('span', { class: 'cd-n', text: e.name }), h('b', { class: 'cd-v' }, p.big, p.unit ? h('small', { text: ' ' + p.unit }) : null));
    }));
  };
  const key = () => c.detail === 'full' ? String(Math.floor(Date.now() / 1000)) : new Date().toDateString() + Math.floor(Date.now() / 60000);
  const configure = () => {
    const x = W.countdownCfg(it.cfg);
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const ed = listEditor(x.events, e => {
      const n = mkText(S.cd.eventName, e.name, S.cd.eventName, 40);
      const d = h('input', { class: 'fi', type: 'date', value: e.date, 'aria-label': S.cd.eventDate });
      const t = h('input', { class: 'fi', type: 'time', value: e.time, 'aria-label': S.cd.eventTime });
      const y = mkChk(e.yearly);
      return { el: h('div', { class: 'led-f cd-f' }, n, d, t, h('label', { class: 'led-c' }, y, h('span', { text: S.cd.yearly }))), read: () => ({ id: e.id, name: n.value.trim(), date: d.value, time: t.value, yearly: y.checked }), focus: () => n.focus() };
    }, () => ({ id: uid(), name: '', date: '', time: '', yearly: false }), 12);
    const detail = mkSel(S.cd.detail, Object.entries(S.cd.details), x.detail), order = mkSel(S.cd.order, Object.entries(S.cd.orders), x.order), hide = mkChk(x.hidePast);
    cfgModal(MODULES.countdown.title, [fld(S.cf.name, name), h('h3', { text: S.cd.events }), ed.el, fld(S.cd.detail, detail), fld(S.cd.order, order), chkRow(S.cd.hidePast, hide)], () => {
      const rows = ed.read().filter(e => e.name || e.date);
      if (rows.some(e => !e.name || !W.parseLocal(e.date, e.time))) return toast(S.cd.badEvent);
      applyCfg(it, ctx, { name: name.value.trim(), events: rows, detail: detail.value, order: order.value, hidePast: hide.checked });
      draw(); closeLayer();
    });
  };
  draw();
  return { tick: () => { if (key() !== last) draw(); }, refresh: draw, configure };
};

/* ═════════════ rates: NBU official rates, Monobank buy/sell, crypto (Binance bid/ask) ═════════════ */
const NBU_ORIGIN = 'https://bank.gov.ua/*', MONO_ORIGIN = 'https://api.monobank.ua/*', BINANCE_ORIGIN = 'https://data-api.binance.vision/*', RKEY = 'hud.rates';
const RATE_ORIGIN = { nbu: NBU_ORIGIN, mono: MONO_ORIGIN, crypto: BINANCE_ORIGIN };
const RATE_TTL = { nbu: 3600e3, mono: 300e3, crypto: 60e3 };             // Monobank allows one request a minute
const ratesCache = {
  read() {                                                              // one entry per source; the 0.5 single-source shape is still understood
    try { const j = JSON.parse(localStorage.getItem(RKEY)); if (!j) return {}; return j.today ? { nbu: j } : j; } catch { return {}; }
  },
  write(v) { try { localStorage.setItem(RKEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const getJson = async url => { const r = await fetch(url); if (!r.ok) throw new Error(r.status); return r.json(); };
async function fetchNbu() {
  const today = W.parseNbu(await getJson(W.NBU));
  if (!today) throw new Error('empty');
  let prev = null;
  try {
    const y = new Date(); y.setDate(y.getDate() - 1);
    prev = W.parseNbu(await getJson(`${W.NBU}&date=${W.nbuDate(y)}`));
    if (prev && prev.date === today.date) prev = null;          // weekends and holidays repeat the last published day
  } catch { /* the change column is optional */ }
  return { ts: Date.now(), today, prev };
}
async function fetchMono() {
  const rows = W.parseMono(await getJson(W.MONO));
  if (!rows) throw new Error('empty');
  return { ts: Date.now(), rows };
}
async function fetchCrypto(coins, quote) {
  const rows = {};
  await Promise.all(coins.map(async c => { try { const t = W.parseTicker(await getJson(W.BINANCE + c + quote)); if (t) rows[c] = t; } catch { /* a pair that does not exist is simply left out */ } }));
  if (!Object.keys(rows).length) throw new Error('empty');
  return { ts: Date.now(), quote, rows };
}
const currencyName = code => { try { return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) || code; } catch { return code; } };

MODULES.rates.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'fx' });
  body.append(root);
  let cache = ratesCache.read(), dead = false, failed = false, needAccess = false, loading = false;
  const c = () => W.ratesCfg(it.cfg);
  const num = (v, d) => new Intl.NumberFormat(S.locale, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  // rows for the current source: { label, title, buy, sell, value, pct, unit }
  const build = x => {
    if (x.source === 'nbu') {
      const e = cache.nbu; if (!e) return null;
      return { stamp: S.fx.src.nbu + ' ' + (e.today.date || ''), rows: x.codes.filter(k => k !== x.base).map(k => {
        const v = W.convert(e.today.rates, x.amount, k, x.base), pv = e.prev ? W.convert(e.prev.rates, x.amount, k, x.base) : null;
        return { label: k, title: currencyName(k), value: v, pct: x.change && v !== null && pv ? (v - pv) / pv * 100 : null, unit: x.base };
      }) };
    }
    if (x.source === 'mono') {
      const e = cache.mono; if (!e) return null;
      return { stamp: S.fx.src.mono, rows: x.codes.filter(k => k !== 'UAH').map(k => {
        const r = e.rows[k] || {};
        return { label: k, title: currencyName(k), buy: r.buy ? r.buy * x.amount : null, sell: r.sell ? r.sell * x.amount : null, value: r.cross ? r.cross * x.amount : null, unit: 'UAH' };
      }), pair: true };
    }
    const e = cache.crypto; if (!e || e.quote !== x.quote) return null;
    return { stamp: S.fx.src.crypto, rows: x.coins.map(k => {
      const r = e.rows[k];
      return { label: k, title: k + '/' + x.quote, buy: r && r.bid ? r.bid * x.amount : null, sell: r && r.ask ? r.ask * x.amount : null, value: r ? r.last * x.amount : null, pct: r && x.change ? r.change : null, unit: x.quote };
    }), pair: true };
  };
  const draw = () => {
    const x = c(), view = build(x);
    if (!view) {
      const msg = needAccess ? S.fx.setupHint : failed ? S.fx.fail : S.fx.loading;
      return root.replaceChildren(h('div', { class: 'fx-empty' }, h('div', { class: 'note', text: msg }),
        needAccess ? h('button', { class: 'btn main', onclick: configure }, S.fx.setup) : failed ? h('button', { class: 'btn', onclick: () => load(true) }, S.fx.retry) : null));
    }
    if (!view.rows.length) return root.replaceChildren(h('div', { class: 'empty', text: S.fx.empty }));
    const two = view.pair && view.rows.some(r => r.buy !== null || r.sell !== null);
    root.style.setProperty('--fxn', two ? 2 : 1);
    const price = (v, r) => v === null ? '—' : num(v, x.decimals);
    root.toggleAttribute('data-two', two);
    root.replaceChildren(
      ...[two ? h('div', { class: 'fx-r fx-h' }, h('span'), h('span', { text: S.fx.buy, title: S.fx.buyHint }), h('span', { text: S.fx.sell, title: S.fx.sellHint }), h('span')) : null].filter(Boolean),
      ...view.rows.map(r => {
        const pct = r.pct;
        const cells = two
          ? [h('b', { class: 'fx-v' }, price(r.buy !== null ? r.buy : r.value, r)), h('b', { class: 'fx-v' }, price(r.sell !== null ? r.sell : r.value, r))]
          : [h('b', { class: 'fx-v' }, price(r.value, r), h('small', { text: ' ' + r.unit }))];
        return h('div', { class: 'fx-r', title: r.title },
          h('span', { class: 'fx-c' }, x.amount !== 1 ? num(x.amount, 0) + ' ' : '', r.label), ...cells,
          h('span', { class: 'fx-d ' + (pct === null || pct === undefined || Math.abs(pct) < 0.005 ? '' : pct > 0 ? 'up' : 'dn') }, pct === null || pct === undefined ? '' : (pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '') + num(Math.abs(pct), 2) + '%'));
      }));
    ctx.setStatus(`${view.stamp}${two ? ' · ' + S.fx.unit(view.rows[0].unit) : ''}${failed ? ' · ' + S.fx.offline : ''}`);
  };
  const load = async force => {
    if (loading) return;
    const x = c(), e = cache[x.source];
    const fresh = e && Date.now() - e.ts < RATE_TTL[x.source] && !force && (x.source !== 'crypto' || (e.quote === x.quote && x.coins.every(k => e.rows[k])));
    if (fresh) return;
    loading = true;
    try {
      if (!(await hasOrigin(RATE_ORIGIN[x.source]))) { needAccess = true; return; }
      needAccess = false;
      cache[x.source] = x.source === 'nbu' ? await fetchNbu() : x.source === 'mono' ? await fetchMono() : await fetchCrypto(x.coins, x.quote);
      ratesCache.write(cache); failed = false;
    } catch { failed = true; }
    finally { loading = false; if (!dead) draw(); }
  };
  const configure = () => {
    const x = c();
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const source = mkSel(S.fx.source, ['nbu', 'mono', 'crypto'].map(v => [v, S.fx.srcLong[v]]), x.source);
    const known = () => source.value === 'mono' && cache.mono ? Object.keys(cache.mono.rows).sort() : cache.nbu ? Object.keys(cache.nbu.today.rates).sort() : [];
    const list = h('datalist', { id: 'fx-codes' }, known().map(k => h('option', { value: k, label: currencyName(k) })));
    const codeEd = listEditor(x.codes, k => {
      const i = h('input', { class: 'fi fx-code', value: k, list: 'fx-codes', maxlength: 3, placeholder: S.fx.codePh, 'aria-label': S.fx.codes, autocomplete: 'off', spellcheck: 'false' });
      return { el: i, read: () => i.value.trim().toUpperCase(), focus: () => i.focus() };
    }, () => '', 8);
    const coinEd = listEditor(x.coins, k => {
      const i = h('input', { class: 'fi fx-code', value: k, maxlength: 10, placeholder: S.fx.coinPh, 'aria-label': S.fx.coins, autocomplete: 'off', spellcheck: 'false' });
      return { el: i, read: () => i.value.trim().toUpperCase(), focus: () => i.focus() };
    }, () => '', 8);
    const base = h('input', { class: 'fi', value: x.base, list: 'fx-codes', maxlength: 3, 'aria-label': S.fx.base, autocomplete: 'off', spellcheck: 'false' });
    const quote = mkSel(S.fx.quote, W.QUOTES.map(q => [q, q]), x.quote);
    const amount = h('input', { class: 'fi', type: 'number', min: '0.000001', step: 'any', value: String(x.amount), 'aria-label': S.fx.amount });
    const dec = mkSel(S.fx.decimals, [0, 1, 2, 3, 4, 5, 6].map(n => [n, String(n)]), x.decimals), chg = mkChk(x.change);
    const fiat = h('div', { class: 'fx-p' }, h('h3', { text: S.fx.codes }), h('div', { class: 'note', text: S.fx.pickHint }), codeEd.el);
    const nbuOnly = h('div', { class: 'fx-p' }, fld(S.fx.base, base));
    const monoNote = h('div', { class: 'note fx-p', text: S.fx.monoNote });
    const crypto = h('div', { class: 'fx-p' }, h('h3', { text: S.fx.coins }), h('div', { class: 'note', text: S.fx.coinHint }), coinEd.el, fld(S.fx.quote, quote));
    const show = () => { const s = source.value; fiat.hidden = s === 'crypto'; nbuOnly.hidden = s !== 'nbu'; monoNote.hidden = s !== 'mono'; crypto.hidden = s !== 'crypto'; };
    source.addEventListener('change', show); show();
    cfgModal(MODULES.rates.title, [fld(S.cf.name, name), fld(S.fx.source, source), nbuOnly, monoNote, fiat, crypto, list,
      fld(S.fx.amount, amount), fld(S.fx.decimals, dec), chkRow(S.fx.change, chg)], async () => {
      const s = source.value, b = base.value.trim().toUpperCase(), codes = codeEd.read().filter(Boolean), coins = coinEd.read().filter(Boolean);
      const kn = known();
      const bad = s === 'crypto' ? coins.find(k => !/^[A-Z0-9]{2,10}$/.test(k))
        : [...(s === 'nbu' ? [b] : []), ...codes].find(k => !/^[A-Z]{3}$/.test(k) || (kn.length && !kn.includes(k) && k !== 'UAH'));
      if (bad) return toast(S.fx.badCode(bad));
      if (!(await ensureOrigin(RATE_ORIGIN[s]))) return toast(S.fx.denied);
      applyCfg(it, ctx, { name: name.value.trim(), source: s, base: b || 'UAH', codes, coins, quote: quote.value, amount: +amount.value > 0 ? +amount.value : 1, decimals: +dec.value, change: chg.checked });
      closeLayer(); needAccess = false; failed = false; draw(); load(true);
    });
  };
  draw(); load(false);
  const iv = setInterval(() => load(false), 60e3);
  return { destroy() { dead = true; clearInterval(iv); }, refresh: () => load(true), configure, enter: () => { if (needAccess) configure(); else load(true); return false; } };
};

/* ═════════════ ambient sounds ═════════════ */
// Engines outlive the tile's DOM: switching workspace or saving settings redraws the tiles, but the sound keeps playing.
const ambient = new Map();                          // tile id -> { eng, it, sleepAt, lastRun }
function ambientRec(it) {
  let r = ambient.get(it.id);
  if (!r) { r = { eng: W.createAmbient(window.AudioContext || window.webkitAudioContext, () => new Audio()), it, sleepAt: 0, lastRun: !!state.timer.running, onChange: null };
    r.eng.onChange = () => r.onChange && r.onChange();
    ambient.set(it.id, r); }
  r.it = it;
  return r;
}
const stopAmbient = (r, id) => { r.eng.destroy(); ambient.delete(id); };
async function ambientPlay(r, c) {
  try { await r.eng.play(); r.sleepAt = c.sleepMin ? Date.now() + c.sleepMin * 60e3 : 0; return true; }
  catch { toast(S.am.blocked); return false; }
}
function ambientTick() {
  for (const [id, r] of ambient) {
    if (!state.ws.some(w => w.items.some(i => i.id === id))) { stopAmbient(r, id); continue; }   // tile was deleted
    const c = W.ambientCfg(r.it.cfg), running = !!state.timer.running;
    if (c.withTimer && running !== r.lastRun) { if (running) ambientPlay(r, c); else r.eng.pause().catch(() => {}); }
    r.lastRun = running;
    if (r.eng.playing && r.sleepAt) {
      const left = r.sleepAt - Date.now();
      if (left <= 0) { r.sleepAt = 0; r.eng.setMaster(c.master); r.eng.pause().catch(() => {}); }
      else if (left < 10e3) r.eng.setMaster(c.master * left / 10e3);        // fade out over the last ten seconds
    }
  }
}

MODULES.ambient.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'am' });
  body.append(root);
  const rec = ambientRec(it);
  let c = W.ambientCfg(it.cfg), go, info, master, rows = {};
  const nameOf = id => S.am.names[id] || (c.custom.find(x => x.id === id) || {}).name || id;
  const sync = () => {
    for (const [id, row] of Object.entries(rows)) { const bad = rec.eng.failed(id); row.classList.toggle('bad', bad); row.title = bad ? S.am.loadFail : (S.am.credit[id] || ''); }
    const on = rec.eng.playing;
    go.textContent = on ? S.am.pause : S.am.play;
    go.classList.toggle('main', !on);
    const left = on && rec.sleepAt ? Math.max(0, Math.ceil((rec.sleepAt - Date.now()) / 60e3)) : 0;
    info.textContent = left ? S.am.sleepIn(left) : '';
    root.classList.toggle('on', on);
  };
  const draw = () => {
    c = W.ambientCfg(it.cfg);
    rec.eng.setSources(c.custom); rec.eng.setLevels(c.levels); rec.onChange = () => sync();
    if (!rec.sleepAt || !rec.eng.playing) rec.eng.setMaster(c.master);
    go = h('button', { class: 'btn main am-go', type: 'button', onclick: async () => { if (rec.eng.playing) await rec.eng.pause(); else await ambientPlay(rec, W.ambientCfg(it.cfg)); sync(); } }, S.am.play);
    info = h('span', { class: 'am-i' });
    master = h('input', { type: 'range', min: 0, max: 100, step: 5, value: String(Math.round(c.master * 100)), 'aria-label': S.am.master, class: 'am-m' });
    master.addEventListener('input', () => rec.eng.setMaster(master.value / 100));
    master.addEventListener('change', () => { it.cfg.master = master.value / 100; save(); });
    rows = {};
    const rowEls = c.sounds.map(id => {
      const r = h('input', { type: 'range', min: 0, max: 100, step: 5, value: String(Math.round(c.levels[id] * 100)), 'aria-label': S.am.level(nameOf(id)) });
      r.addEventListener('input', () => rec.eng.setLevel(id, r.value / 100));
      r.addEventListener('change', () => { it.cfg.levels = { ...W.ambientCfg(it.cfg).levels, [id]: r.value / 100 }; save(); });
      const row = h('label', { class: 'am-r' }, h('span', { class: 'am-n', text: nameOf(id) }), r);
      rows[id] = row;
      return row;
    });
    root.replaceChildren(h('div', { class: 'am-top' }, go, h('label', { class: 'am-v', title: S.am.master }, master), info), ...(rowEls.length ? rowEls : [h('div', { class: 'empty', text: S.am.empty })]));
    sync();
  };
  const configure = () => {
    const x = W.ambientCfg(it.cfg);
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const boxes = W.SOUNDS.map(id => ({ id, el: mkChk(x.sounds.includes(id)) }));
    const ed = listEditor(x.custom, cu => {
      const n = mkText(S.am.customName, cu.name, S.am.customName, 24), u = mkText(S.am.customUrl, cu.url, S.am.customUrl, 500);
      return { el: h('div', { class: 'led-f' }, n, u), read: () => ({ id: cu.id, name: n.value.trim(), url: u.value.trim() }), focus: () => n.focus() };
    }, () => ({ id: 'c' + uid().slice(0, 5), name: '', url: '' }), W.CUSTOM_MAX);
    const sleep = mkSel(S.am.sleep, W.SLEEP_OPTIONS.map(m => [m, m ? S.am.sleepOpt(m) : S.am.sleepOff]), x.sleepMin), wt = mkChk(x.withTimer);
    cfgModal(MODULES.ambient.title, [fld(S.cf.name, name), h('h3', { text: S.am.sounds }), h('div', { class: 'note', text: S.am.streamNote }), ...boxes.map(b => chkRow(S.am.names[b.id], b.el)),
      h('h3', { text: S.am.custom }), h('div', { class: 'note', text: S.am.customNote }), ed.el, h('h3', { text: S.am.options }), fld(S.am.sleep, sleep), chkRow(S.am.withTimer, wt)], () => {
      const custom = ed.read().filter(z => z.name || z.url);
      if (custom.some(z => !z.name || !/^https:\/\/[^\s/]+\S*$/i.test(z.url))) return toast(S.am.badCustom);
      const keep = x.sounds.filter(id => custom.some(z => z.id === id));                 // custom sounds already shown stay shown
      const added = custom.map(z => z.id).filter(id => !keep.includes(id));
      applyCfg(it, ctx, { name: name.value.trim(), custom, sounds: [...boxes.filter(b => b.el.checked).map(b => b.id), ...keep, ...added], sleepMin: +sleep.value, withTimer: wt.checked });
      draw(); closeLayer();
    });
  };
  draw();
  return {
    tick: sync, refresh: draw, configure,
    enter: () => { go.focus(); },
  };
};

/* ═════════════ air-raid alerts (Ukraine): alert status per oblast (two interchangeable sources), a schematic
   map, and an estimate derived from how the alert area has been spreading. Optionally, live drone/missile tracks
   from kudyletyt.com, an independent, unofficial OSINT project (off by default) — see docs/WIDGETS.md for what
   both the sources and the estimate can and cannot tell you. ═════════════ */
const ALERTS_ORIGIN = 'https://api.alerts.in.ua/*', KUDYLETYT_ORIGIN = 'https://api.kudyletyt.com/*';
const AKEY = 'hud.alerts', ALERTS_POLL = 30e3, TRACKS_POLL = 20e3;
const alertsCache = {
  read() { try { const j = JSON.parse(localStorage.getItem(AKEY)); return j && isObjGuard(j) ? j : {}; } catch { return {}; } },
  write(v) { try { localStorage.setItem(AKEY, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const isObjGuard = v => v && typeof v === 'object' && !Array.isArray(v);
async function fetchAlerts(token) {
  const r = await fetch(W.ALERTS_ENDPOINT, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error(r.status);
  const raw = JSON.parse(await r.text());                        // the body is itself a JSON string, e.g. "RNNNN…"
  if (typeof raw !== 'string' || raw.length !== W.OBLASTS.length) throw new Error('shape');
  return { ts: Date.now(), raw };
}
// kudyletyt.com's own mirror of the official feed: an "active alerts only" list, at raion/hromada granularity in
// places, with no parent-oblast field. We can only trust the whole-oblast ("State") rows here, matched by their
// Ukrainian name, so a sub-oblast ("partial") alert is invisible through this source — see docs/WIDGETS.md.
const UA_OBLAST_NAMES = {
  crimea: ['Автономна Республіка Крим'], volyn: ['Волинська область'], vinnytsia: ['Ві\u043dницька область'],
  dnipropetrovsk: ['Дніпропетровська область'], donetsk: ['Донецька область'], zhytomyr: ['Житомирська область'],
  zakarpattia: ['Закарпатська область'], zaporizhzhia: ['Запорізька область'], 'ivano-frankivsk': ['Івано-Франківська область'],
  'kyiv-city': ['м. Київ'], 'kyiv-oblast': ['Київська область'], kirovohrad: ['Кіровоградська область'],
  luhansk: ['Луганська область'], lviv: ['Львівська область'], mykolaiv: ['Миколаївська область'], odesa: ['Одеська область'],
  poltava: ['Полтавська область'], rivne: ['Рівненська область'], sevastopol: ['м. Севастополь'], sumy: ['Сумська область'],
  ternopil: ['Тернопільська область'], kharkiv: ['Харківська область', 'м. Харків'], kherson: ['Херсонська область'],
  khmelnytskyi: ['Хмельницька область'], cherkasy: ['Черкаська область'], chernivtsi: ['Чернівецька область'], chernihiv: ['Чернігівська область'],
};
function kudyletytOblastIdx(regionName) {
  for (const [id, names] of Object.entries(UA_OBLAST_NAMES)) if (names.some(n => regionName.includes(n))) return W.OBLAST_BY_ID[id];
  return -1;
}
async function fetchKudyletytAlerts() {
  const r = await fetch(W.KUDYLETYT_ALERTS_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error('shape');
  const codes = Array(W.OBLASTS.length).fill('N');
  for (const entry of list) {
    if (!isObjGuard(entry) || entry.regionType !== 'State' || !Array.isArray(entry.activeAlerts)) continue;
    const idx = kudyletytOblastIdx(String(entry.regionName || ''));
    if (idx < 0) continue;
    const levels = entry.activeAlerts.flatMap(a => (a && Array.isArray(a.levels) ? a.levels : []).map(l => l && l.level));
    codes[idx] = levels.includes('Red') ? 'R' : levels.includes('Yellow') ? 'Y' : 'R';
  }
  return { ts: Date.now(), raw: codes.join('') };
}
async function fetchTracks() {
  const r = await fetch(W.TRACKS_ENDPOINT, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(r.status);
  const parsed = W.parseTracks(await r.json());
  if (!parsed) throw new Error('shape');
  return parsed;
}
function alertChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .18, .36].forEach(d => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 660; o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(.18, ctx.currentTime + d); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + d + .15);
      o.start(ctx.currentTime + d); o.stop(ctx.currentTime + d + .16);
    });
  } catch { /* audio blocked until the first interaction */ }
}
function notifyPinned(name) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(S.al.notifyTitle, { body: S.al.notifyBody(name) });
  } catch { /* notifications blocked */ }
}

MODULES.alerts.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'al' });
  body.append(root);
  let saved = alertsCache.read();
  let oblastCache = saved.oblast || null, tracksCache = saved.tracks || null;
  let dead = false, failed = false, tracksFailed = false, needAccess = false, loading = false, loadingTracks = false;
  let events = [], prevActive = null;                            // events: {idx, at} — in-memory, reset on reload
  let etaEl = null, placeEls = [], noteEl = null;
  const PROJ = W.projectOblasts();
  const c = () => W.alertsCfg(it.cfg);
  const writeCache = () => alertsCache.write({ oblast: oblastCache, tracks: tracksCache });
  const oblastOrigin = x => x.source === 'kudyletyt' ? KUDYLETYT_ORIGIN : ALERTS_ORIGIN;

  // The best current estimate across every source: the alert-spread heuristic, a hand-marked threat, and (if
  // enabled) live tracks whose heading points roughly at the oblast. Always returns a point to draw the line from.
  function primaryEstimate(x, now) {
    const pins = x.pinned.map(id => W.OBLAST_BY_ID[id]);
    const manual = x.manualFrom && x.manualSetAt ? { idx: W.OBLAST_BY_ID[x.manualFrom], setAt: x.manualSetAt } : null;
    let best = null;
    const take = (e, from, label) => { if (e && (!best || e.minLeft < best.minLeft)) best = { minLeft: e.minLeft, maxLeft: e.maxLeft, from, label }; };
    for (const t of pins) {
      const a = W.estimateFromEvents(events, t, x.speeds[x.threat], now);
      if (a) take(a, PROJ[a.fromIdx], S.al.autoTag);
      if (manual && manual.idx !== t) { const m = W.estimateFromManual(manual, t, x.speeds[x.threat], now); if (m) take(m, PROJ[manual.idx], S.al.manualTag); }
      if (x.useTracks && tracksCache) for (const tr of tracksCache.tracks) {
        const e = W.estimateFromTrack(tr, t, x.trackSpeeds[tr.type], now);
        if (e) take(e, W.projectPoint(tr.lat, tr.lon), S.al.trackTag(S.al.trackNames[tr.type]));
      }
    }
    return best;
  }

  const buildMap = (x, rows) => {
    const svg = svgEl('svg', { viewBox: `0 0 ${W.ALERTS_SPACE.w} ${W.ALERTS_SPACE.h}`, class: 'al-map', role: 'img', 'aria-label': S.al.mapLabel });
    const pinnedIdx = x.pinned.map(id => W.OBLAST_BY_ID[id]);
    for (const o of PROJ) {
      const row = rows && rows[o.idx];
      const level = row && row.active ? row.level || 'partial' : 'none';
      const pinned = pinnedIdx.includes(o.idx);
      const dist = x.focus ? W.nearestPinnedKm(o.idx, pinnedIdx) : null;
      const op = pinned || dist === null ? 1 : Math.max(.22, 1 - dist / 900);
      const g = svgEl('circle', { cx: o.x.toFixed(1), cy: o.y.toFixed(1), r: pinned ? 13 : 10, class: 'al-o ' + (level === 'red' ? 'r' : level === 'yellow' ? 'y' : level === 'partial' ? 'p' : 'n') + (pinned ? ' pin' : ''), tabindex: '0', role: 'button', 'aria-label': `${o.name}: ${S.al.level[level]}` });
      g.style.opacity = op.toFixed(2);
      g.append(svgEl('title', {}));
      g.lastChild.textContent = o.name + ' — ' + S.al.level[level];
      const toggle = () => { const cur = c().pinned; const next = cur.includes(o.id) ? cur.filter(i => i !== o.id) : cur.length < W.ALERTS_PINNED_MAX ? [...cur, o.id] : cur; it.cfg.pinned = next; save(); draw(); };
      g.addEventListener('click', toggle);
      g.addEventListener('keydown', e => { if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); toggle(); } });
      svg.append(g);
    }
    if (x.useTracks && tracksCache) for (const tr of tracksCache.tracks) {
      const p = W.projectPoint(tr.lat, tr.lon);
      const mk = svgEl('path', { d: 'M0,-9 L6,7 L0,3 L-6,7 Z', class: 'al-tr al-tr-' + tr.type + (tr.active ? '' : ' stale'), transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)}) rotate(${(tr.heading || 0).toFixed(0)})` });
      mk.append(svgEl('title', {}));
      mk.lastChild.textContent = `${S.al.trackNames[tr.type]} (${tr.active ? S.al.trackActive : S.al.trackEnded})${tr.toward ? ' → ' + tr.toward : ''}`;
      svg.append(mk);
    }
    const now = Date.now(), est = primaryEstimate(x, now);
    if (est && pinnedIdx.length) {
      // the pinned oblast the current estimate is actually aimed at: nearest, on the projected map, to its source point
      const nearest = pinnedIdx.map(i => PROJ[i]).reduce((a, b) => (est.from.x - a.x) ** 2 + (est.from.y - a.y) ** 2 < (est.from.x - b.x) ** 2 + (est.from.y - b.y) ** 2 ? a : b);
      svg.append(svgEl('line', { x1: est.from.x.toFixed(1), y1: est.from.y.toFixed(1), x2: nearest.x.toFixed(1), y2: nearest.y.toFixed(1), class: 'al-line' }));
    }
    return svg;
  };

  const draw = () => {
    const x = c();
    if (x.source === 'alertsinua' && !x.token) { root.replaceChildren(h('div', { class: 'al-empty' }, h('div', { class: 'note', text: S.al.setupHint }), h('button', { class: 'btn main', onclick: configure }, S.al.setup))); return; }
    const rows = oblastCache && W.parseOblastString(oblastCache.raw);
    if (oblastCache && !rows) { oblastCache = null; failed = true; }              // corrupt or pre-0.6 cache: treat as missing
    if (!oblastCache) {
      const msg = needAccess ? S.al.setupHint : failed ? S.al.fail : S.al.loading;
      root.replaceChildren(h('div', { class: 'al-empty' }, h('div', { class: 'note', text: msg }), needAccess ? h('button', { class: 'btn main', onclick: configure }, S.al.setup) : failed ? h('button', { class: 'btn', onclick: () => load(true) }, S.al.retry) : null));
      return;
    }
    // The map is shown as soon as data loads, pinned or not: clicking an oblast on it is how you pin your first one.
    const now = Date.now(), est = x.pinned.length ? primaryEstimate(x, now) : null;
    etaEl = h('div', { class: 'al-eta' + (est ? '' : ' dim'), text: est ? S.al.eta(est.minLeft, est.maxLeft) + (est.label ? ' — ' + est.label : '') : S.al.etaNone });
    noteEl = h('div', { class: 'note al-note', text: x.manualFrom && x.manualSetAt ? S.al.manualNote(W.OBLASTS[W.OBLAST_BY_ID[x.manualFrom]].name, Math.round((now - x.manualSetAt) / 60000)) : S.al.disclaimer });
    placeEls = x.places.map(p => {
      const badge = h('span', { class: 'al-badge' });
      return { p, row: h('div', { class: 'al-p-row' }, h('span', { text: p.name }), badge), badge };
    });
    root.replaceChildren(
      buildMap(x, rows),
      h('div', { class: 'al-info' },
        x.pinned.length
          ? h('div', { class: 'al-pins' }, x.pinned.map(id => {
            const idx = W.OBLAST_BY_ID[id], row = rows[idx], level = row.active ? row.level || 'partial' : 'none';
            return h('span', { class: 'al-pin al-' + level, text: W.OBLASTS[idx].name + ': ' + S.al.level[level] });
          }))
          : h('div', { class: 'note al-note', text: S.al.pickHint }),
        x.pinned.length ? etaEl : null, noteEl,
        placeEls.length ? h('div', { class: 'al-places' }, placeEls.map(pe => pe.row)) : null));
    tick();
    const bits = [S.al.sourceLabel[x.source], S.al.updated(Math.max(0, Math.round((now - oblastCache.ts) / 60000)))];
    if (failed) bits.push(S.al.offline);
    if (x.useTracks) bits.push(tracksCache ? S.al.tracksSource : tracksFailed ? S.al.tracksOffline : S.al.loading);
    ctx.setStatus(bits.join(' · '));
  };

  const tick = () => {
    const x = c(); if (!oblastCache || !x.pinned.length) return;
    const now = Date.now(), est = primaryEstimate(x, now);
    if (etaEl) { etaEl.textContent = est ? S.al.eta(est.minLeft, est.maxLeft) + (est.label ? ' — ' + est.label : '') : S.al.etaNone; etaEl.classList.toggle('dim', !est); }
    for (const { p, badge } of placeEls) {
      const v = W.tripCompare(est ? est.minLeft : null, p.minutes);
      badge.textContent = S.al.trip[v]; badge.className = 'al-badge al-' + v;
    }
  };

  const detectTransitions = next => {
    const rows = W.parseOblastString(next.raw); if (!rows) return;
    const now = Date.now(), activeSet = new Set(rows.filter(r => r.active).map(r => r.idx));
    const x = c(), watched = new Set(x.pinned.map(id => W.OBLAST_BY_ID[id]));
    if (prevActive) for (const idx of activeSet) if (!prevActive.has(idx)) {
      events.push({ idx, at: now });
      if (watched.has(idx)) { if (x.notify) notifyPinned(W.OBLASTS[idx].name); if (x.sound) alertChime(); }
    }
    prevActive = activeSet;
    events = events.filter(e => (now - e.at) / 60000 <= W.ALERTS_FRESH_MIN + 5);
  };

  const load = async force => {
    if (loading) return;
    const x = c();
    if (x.source === 'alertsinua' && !x.token) { needAccess = false; return; }
    const fresh = oblastCache && Date.now() - oblastCache.ts < ALERTS_POLL * .9 && !force;
    if (!fresh) {
      loading = true;
      try {
        if (!(await hasOrigin(oblastOrigin(x)))) { needAccess = true; return; }
        needAccess = false;
        const next = x.source === 'alertsinua' ? await fetchAlerts(x.token) : await fetchKudyletytAlerts();
        detectTransitions(next);
        oblastCache = next; writeCache(); failed = false;
      } catch { failed = true; }
      finally { loading = false; }
    }
    if (x.useTracks) await loadTracks(force);
    if (!dead) draw();
  };
  // Independent of the oblast-status poll: the only call that always goes to kudyletyt.com regardless of source.
  const loadTracks = async force => {
    if (loadingTracks) return;
    const fresh = tracksCache && Date.now() - tracksCache.ts < TRACKS_POLL * .9 && !force;
    if (fresh) return;
    loadingTracks = true;
    try {
      if (!(await ensureOrigin(KUDYLETYT_ORIGIN))) { tracksFailed = true; return; }
      tracksCache = await fetchTracks(); writeCache(); tracksFailed = false;
    } catch { tracksFailed = true; }
    finally { loadingTracks = false; }
  };

  const configure = () => {
    const x = c();
    const name = mkText(S.cf.name, x.name, S.cf.namePh, 40);
    const source = mkSel(S.al.source, W.ALERTS_SOURCES.map(s => [s, S.al.sourceNames[s]]), x.source);
    const token = h('input', { class: 'fi', type: 'password', value: x.token, placeholder: S.al.tokenPh, 'aria-label': S.al.token, autocomplete: 'off', spellcheck: 'false' });
    const tokenRow = fld(S.al.token, token), tokenHelp = h('div', { class: 'note', text: S.al.tokenHelp });
    const kudyNote = h('div', { class: 'note', text: S.al.kudyletytNote });
    const showSource = () => { const kudy = source.value === 'kudyletyt'; tokenRow.hidden = kudy; tokenHelp.hidden = kudy; kudyNote.hidden = !kudy; };
    source.addEventListener('change', showSource); showSource();
    const boxes = W.OBLASTS.map(o => ({ id: o.id, el: h('input', { type: 'checkbox', checked: x.pinned.includes(o.id), disabled: !x.pinned.includes(o.id) && x.pinned.length >= W.ALERTS_PINNED_MAX ? '' : null, 'aria-label': o.name }) }));
    const pickList = h('div', { class: 'lc-groups' }, boxes.map((b, i) => h('label', { class: 'lc-g' }, b.el, h('span', { text: W.OBLASTS[i].name }))));
    const focus = mkChk(x.focus);
    const threat = mkSel(S.al.threat, W.THREAT_TYPES.map(t => [t, S.al.threatNames[t]]), x.threat);
    const speeds = Object.fromEntries(W.THREAT_TYPES.map(t => [t, h('input', { class: 'fi', type: 'number', min: 1, max: 30000, step: 1, value: String(x.speeds[t]), 'aria-label': S.al.speedLabel(S.al.threatNames[t]) })]));
    const mFrom = mkSel(S.al.manualFrom, [['', S.al.manualNone], ...W.OBLASTS.map(o => [o.id, o.name])], x.manualFrom);
    const mMark = mkChk(false);
    const ed = listEditor(x.places, p => {
      const n = mkText(S.al.placeName, p.name, S.al.placeName, 30);
      const m = h('input', { class: 'fi', type: 'number', min: 1, max: 600, value: String(p.minutes || ''), 'aria-label': S.al.placeMinutes });
      return { el: h('div', { class: 'led-f' }, n, m), read: () => ({ id: p.id, name: n.value.trim(), minutes: +m.value }), focus: () => n.focus() };
    }, () => ({ id: '', name: '', minutes: '' }), W.ALERTS_PLACES_MAX);
    const notify = mkChk(x.notify), sound = mkChk(x.sound);
    const useTracks = mkChk(x.useTracks);
    const trackSpeeds = Object.fromEntries(W.TRACK_TYPES.map(t => [t, h('input', { class: 'fi', type: 'number', min: 1, max: 30000, step: 1, value: String(x.trackSpeeds[t]), 'aria-label': S.al.speedLabel(S.al.trackNames[t]) })]));
    cfgModal(MODULES.alerts.title, [
      fld(S.cf.name, name), fld(S.al.source, source), tokenRow, tokenHelp, kudyNote,
      h('h3', { text: S.al.oblasts }), pickList, chkRow(S.al.focus, focus),
      h('h3', { text: S.al.estimate }), fld(S.al.threat, threat),
      ...W.THREAT_TYPES.map(t => fld(S.al.speedLabel(S.al.threatNames[t]), speeds[t])),
      fld(S.al.manualFrom, mFrom), chkRow(S.al.manualMark, mMark),
      h('h3', { text: S.al.tracksHeading }), h('div', { class: 'note', text: S.al.tracksNote }), chkRow(S.al.tracksUse, useTracks),
      ...W.TRACK_TYPES.map(t => fld(S.al.speedLabel(S.al.trackNames[t]), trackSpeeds[t])),
      h('h3', { text: S.al.places }), ed.el,
      h('h3', { text: S.al.notifyHeading }), chkRow(S.al.notify, notify), chkRow(S.al.sound, sound),
    ], async () => {
      const pinned = boxes.filter(b => b.el.checked).map(b => b.id);
      const places = ed.read().filter(p => p.name || p.minutes);
      if (places.some(p => !p.name || !(+p.minutes > 0))) return toast(S.al.badPlace);
      const needKudy = source.value === 'kudyletyt' || useTracks.checked;
      if (needKudy && !(await ensureOrigin(KUDYLETYT_ORIGIN))) return toast(S.al.denied);
      const sp = {}; for (const t of W.THREAT_TYPES) sp[t] = +speeds[t].value;
      const tsp = {}; for (const t of W.TRACK_TYPES) tsp[t] = +trackSpeeds[t].value;
      if (notify.checked && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
      applyCfg(it, ctx, {
        name: name.value.trim(), source: source.value, token: token.value.trim(), pinned, focus: focus.checked, threat: threat.value, speeds: sp,
        useTracks: useTracks.checked, trackSpeeds: tsp,
        manualFrom: mFrom.value, manualSetAt: mMark.checked ? Date.now() : (mFrom.value === x.manualFrom ? x.manualSetAt : undefined),
        places, notify: notify.checked, sound: sound.checked,
      });
      closeLayer(); failed = false; needAccess = false; draw(); load(true);
    });
  };

  draw(); load(false);
  const iv = setInterval(() => load(false), ALERTS_POLL);
  return {
    tick, refresh: () => load(true), configure,
    destroy() { dead = true; clearInterval(iv); },
    enter: () => { const f = root.querySelector('.al-o, .btn'); if (!f) return false; f.focus(); },
  };
};
/* ═════════════ outages: bezsvitla.com.ua (all regions), Yasno, or pasted schedule ═════════════ */
const OU = VEGA.outage;
const BEZSVITLA = OU.BEZSVITLA_BASE, BEZSVITLA_ORIGIN = 'https://bezsvitla.com.ua/*';
const YASNO = 'https://app.yasno.ua/api/blackout-service/public/shutdowns', YASNO_ORIGIN = 'https://app.yasno.ua/*';
const OKEY = 'hud.outage';                                      // cache: { "<key>": { ts, data } }
const outageCache = {
  read() { try { return JSON.parse(localStorage.getItem(OKEY)) || {}; } catch { return {}; } },
  write(c) { try { localStorage.setItem(OKEY, JSON.stringify(c)); } catch { /* storage full or blocked */ } },
};
const hasOrigin = origin => !isExt || !api.permissions || !api.permissions.contains
  ? Promise.resolve(true)
  : api.permissions.contains({ origins: [origin] }).catch(() => false);

function ouIcon(type) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    s.append(el);
  };
  if (type === 'on') {
    add('path', { d: 'M8 2.2v1.2M3.8 4l.8.8M12.2 4l-.8.8M5.4 10.6c-.9-.7-1.4-1.7-1.4-2.8a4 4 0 1 1 8 0c0 1.1-.5 2.1-1.4 2.8-.4.3-.6.8-.6 1.3H6c0-.5-.2-1-.6-1.3Z' });
    add('path', { d: 'M6.4 13.8h3.2' });
  } else if (type === 'off') {
    add('path', { d: 'M9.3 2 5.4 8h3.2l-1.9 6 4.7-6.3H8.3L9.3 2Z' });
    add('path', { d: 'M2.5 2.5 13.5 13.5' });
  } else {
    add('circle', { cx: '8', cy: '8', r: '5.5' });
    add('path', { d: 'M8 5.2v3.3M8 10.8v.2' });
  }
  return s;
}

async function loadBezsvitla(cfg, force) {
  const cache = outageCache.read(), k = `bz.${cfg.regionSlug}.${cfg.queue}`, hit = cache[k];
  if (hit && !force && Date.now() - hit.ts < 15 * 60e3) return { data: hit.data, ts: hit.ts };
  try {
    const url = OU.bezsvitlaUrl(cfg.regionSlug, cfg.queue);
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    const html = await res.text();
    const todayDate = OU.kyivNow(Date.now()).date;
    let parsed = OU.fromBezsvitlaHtml(html, cfg.queue, null, todayDate);
    if (!parsed) throw new Error('parse');
    if (parsed.days[1].status === 'waiting') {
      try {
        const tmRes = await fetch(`${url}/grafik-na-zavtra`);
        if (tmRes.ok) {
          const withTm = OU.fromBezsvitlaHtml(html, cfg.queue, await tmRes.text(), todayDate);
          if (withTm) parsed = withTm;
        }
      } catch { /* tomorrow page may be unpublished */ }
    }
    cache[k] = { ts: Date.now(), data: parsed };
    for (const old of Object.keys(cache).sort((a, b) => cache[b].ts - cache[a].ts).slice(8)) delete cache[old];
    outageCache.write(cache);
    return { data: parsed, ts: cache[k].ts };
  } catch { return hit ? { data: hit.data, ts: hit.ts, stale: true } : null; }
}

async function loadYasno(cfg, force) {
  const cache = outageCache.read(), k = `${cfg.region}.${cfg.dso}.${cfg.group}`, hit = cache[k];
  if (hit && !force && Date.now() - hit.ts < 15 * 60e3) return { json: hit.data, ts: hit.ts };
  try {
    const res = await fetch(`${YASNO}/regions/${cfg.region}/dsos/${cfg.dso}/planned-outages`);
    if (!res.ok) throw new Error(res.status);
    const all = await res.json();
    if (!all[cfg.group]) throw new Error('group');
    cache[k] = { ts: Date.now(), data: { [cfg.group]: all[cfg.group] } };
    for (const old of Object.keys(cache).sort((a, b) => cache[b].ts - cache[a].ts).slice(8)) delete cache[old];
    outageCache.write(cache);
    return { json: cache[k].data, ts: cache[k].ts };
  } catch { return hit ? { json: hit.data, ts: hit.ts, stale: true } : null; }   // offline: show the last known schedule
}

function buildTimeline(day, nowMin, showNow, ariaLabel) {
  const slots = day && day.slots && day.slots.length ? day.slots : [{ start: 0, end: OU.DAY, type: 'unknown' }];
  const marker = showNow ? h('i', { class: 'ou-now' }) : null;
  if (marker) marker.style.left = (nowMin / OU.DAY * 100) + '%';
  const bar = h('div', { class: 'ou-bar', role: 'img', 'aria-label': ariaLabel },
    slots.map((x, idx) => {
      const seg = h('i', { class: 'seg ' + x.type + (idx < slots.length - 1 ? ' sep' : ''), title: `${OU.clock(x.start)}–${OU.clockEnd(x.end)}` });
      seg.style.flex = String(x.end - x.start);
      return seg;
    }), marker);
  // Boundary labels at every zone transition (start and end of each slot).
  const pts = [];
  for (const s of slots) {
    if (!pts.length || pts[pts.length - 1] !== s.start) pts.push(s.start);
    if (pts[pts.length - 1] !== s.end) pts.push(s.end);
  }
  let prevTight = -999;
  const bounds = h('div', { class: 'ou-bounds', 'aria-hidden': 'true' }, pts.map((m, idx) => {
    const isStart = idx === 0, isEnd = idx === pts.length - 1;
    const prev = idx > 0 ? pts[idx - 1] : -999;
    const tight = !isStart && !isEnd && (m - prev < 110 || (idx < pts.length - 1 && pts[idx + 1] - m < 110));
    const tier2 = tight && (m - prevTight < 140);
    if (tight) prevTight = m;
    const el = h('span', { class: 'ou-bt' + (isStart ? ' start' : isEnd ? ' end' : '') + (tight ? ' tight' : '') + (tier2 ? ' tier2' : ''), text: OU.clockEnd(m) });
    el.style.left = (m / OU.DAY * 100) + '%';
    return el;
  }));
  return h('div', { class: 'ou-tl' }, bar, bounds);
}

MODULES.outage.render = (body, ctx) => {
  const it = ctx.it, root = h('div', { class: 'ou' });
  body.append(root);
  let remote = null, loading = false, failed = false, dead = false, last = '', viewDay = 0;
  let pillEl = null, liveDays = null, liveSt = null;
  const ready = () => it.cfg.source === 'paste'
    ? !!(it.cfg.paste && it.cfg.paste.date)
    : it.cfg.source === 'yasno'
      ? !!(it.cfg.region && it.cfg.dso && it.cfg.group)
      : it.cfg.source === 'bezsvitla' && !!(it.cfg.regionSlug && it.cfg.queue);

  const schedule = now => {
    if (it.cfg.source === 'paste') return OU.fromPasted(it.cfg.paste, now.date);
    if (!remote) return null;
    if (it.cfg.source === 'yasno') {
      const x = OU.fromYasno(remote.json, it.cfg.group);
      return x && { ...x, days: OU.align(x.days, now.date), offline: !!remote.stale };
    }
    const d = remote.data;
    return d && { ...d, days: OU.align(d.days, now.date), offline: !!remote.stale };
  };
  const rows = d => d.status === 'known'
    ? (OU.intervals(d).map(([a, b]) => `${OU.clock(a)}–${OU.clockEnd(b)}`).join('  ') || S.ou.none)
    : d.status === 'waiting' ? S.ou.waiting : '—';

  const countdownText = (st, now) => {
    if (!st || st.kind === 'unknown') return S.ou.status.unknown;
    if (st.open) return st.kind === 'on' ? S.ou.noMoreToday : S.ou.untilAtLeast(OU.clockEnd(st.endsAt));
    const hms = OU.hms(OU.secondsUntil(st.endsAt, now));
    return st.kind === 'off' ? S.ou.untilOn(hms) : st.kind === 'maybe' ? S.ou.untilMaybe(hms) : S.ou.untilOff(hms);
  };

  const badgeLabel = () => {
    if (!ready()) return '';
    if (it.cfg.source === 'paste') return S.ou.pasted;
    if (it.cfg.source === 'yasno') return S.ou.queue(it.cfg.group);
    const reg = OU.bezsvitlaRegion(it.cfg.regionSlug);
    return reg && reg.kind === 'int12' ? S.ou.groupInt(it.cfg.queue) : S.ou.queue(it.cfg.queue);
  };

  const draw = force => {
    const now = OU.kyivNow(Date.now()), sch = ready() ? schedule(now) : null;
    const key = [now.date, now.minutes, loading, failed, viewDay, it.cfg.source, it.cfg.regionSlug, it.cfg.queue, it.cfg.group, remote && remote.ts, it.cfg.paste && it.cfg.paste.savedAt, sch && sch.days.map(d => d.status + d.slots.length).join()].join('|');
    if (!force && key === last) {
      if (pillEl && liveSt) pillEl.textContent = countdownText(liveSt, now);
      return;
    }
    last = key;
    pillEl = null; liveDays = null; liveSt = null;
    ctx.setStatus(badgeLabel());
    if (!ready()) return root.replaceChildren(h('div', { class: 'ou-empty' }, h('div', { class: 'note', text: S.ou.setupHint }), h('button', { class: 'btn main', onclick: configure }, S.ou.setup)));
    if (!sch || sch.stale) {
      const msg = sch && sch.stale ? S.ou.stalePaste : failed ? S.ou.fail : S.ou.loading;
      return root.replaceChildren(h('div', { class: 'ou-empty' }, h('div', { class: 'note', text: msg }), failed || (sch && sch.stale) ? h('button', { class: 'btn', onclick: sch && sch.stale ? configure : () => load(true) }, sch && sch.stale ? S.ou.setup : S.ou.retry) : null));
    }
    const days = sch.days, st = OU.status(days, now.minutes);
    liveDays = days; liveSt = st;
    if (viewDay === 1 && (!days[1] || days[1].status !== 'known')) viewDay = 0;

    const away = OU.durationText(st.endsAt - now.minutes);
    const sub = st.kind === 'off'
      ? (st.open ? S.ou.untilAtLeast(OU.clockEnd(st.endsAt)) : (st.endsAt >= OU.DAY ? S.ou.onTomorrowAt : S.ou.onAt)(OU.clock(st.endsAt), away))
      : st.kind === 'on'
        ? (st.open ? S.ou.noMoreToday : (st.endsAt >= OU.DAY ? S.ou.offTomorrowAt : S.ou.offAt)(OU.clock(st.endsAt), away))
        : st.kind === 'maybe' && !st.open
          ? (st.endsAt >= OU.DAY ? S.ou.offTomorrowAt : S.ou.offAt)(OU.clock(st.endsAt), away)
          : '';

    const pillCls = 'ou-pill ' + (st.open && st.kind === 'on' ? 'is-open' : 'st-' + st.kind);
    pillEl = h('div', { class: pillCls, text: countdownText(st, now) });

    // Horizontal view: header + enhanced timeline with explicit boundary times + summary
    const timeline = buildTimeline(days[0], now.minutes, true, S.ou.today + ': ' + rows(days[0]));
    const horz = h('div', { class: 'ou-horz' },
      timeline,
      h('div', { class: 'ou-list' },
        h('div', {}, h('span', { text: S.ou.today }), h('b', { text: rows(days[0]) })),
        h('div', {}, h('span', { text: S.ou.tomorrow }), h('b', { text: rows(days[1]) }))));

    // Vertical view: day tabs (if tomorrow is known) + slot cards matching bezsvitla.com.ua
    const activeDay = days[viewDay] || days[0];
    const tabs = days[1] && days[1].status === 'known'
      ? h('div', { class: 'ou-tabs' },
          h('button', { class: 'ou-tab' + (viewDay === 0 ? ' on' : ''), type: 'button', onclick: () => { viewDay = 0; draw(true); } }, S.ou.today),
          h('button', { class: 'ou-tab' + (viewDay === 1 ? ' on' : ''), type: 'button', onclick: () => { viewDay = 1; draw(true); } }, S.ou.tomorrow))
      : null;
    const slotCards = activeDay.status === 'known' && activeDay.slots.length
      ? activeDay.slots.map(s => {
          const isCur = viewDay === 0 && now.minutes >= s.start && now.minutes < s.end;
          const lbl = s.type === 'off' ? S.ou.slotOff : s.type === 'maybe' ? S.ou.slotMaybe : S.ou.slotOn;
          return h('div', { class: 'ou-slot st-' + s.type + (isCur ? ' now' : ''), title: lbl },
            h('span', { class: 'ou-slot-t', text: `${OU.clock(s.start)} – ${OU.clockEnd(s.end)}` }),
            h('span', { class: 'ou-slot-b st-' + s.type, 'aria-label': lbl }, ouIcon(s.type)));
        })
      : [h('div', { class: 'note ou-noslots', text: activeDay.status === 'waiting' ? S.ou.waiting : S.ou.noSlots })];
    const vert = h('div', { class: 'ou-vert' }, tabs, h('div', { class: 'ou-slots' }, slotCards));

    // Footer: update info + clickable bezsvitla.com.ua source link
    const updMs = sch.updated ? Date.parse(sch.updated) : NaN;
    const updMin = Number.isFinite(updMs) ? Math.round((Date.now() - updMs) / 60e3) : null;
    const metaText = sch.offline ? S.ou.offlineTag
      : updMin !== null && updMin >= 0 ? S.ou.updated(OU.durationText(updMin))
      : it.cfg.source === 'paste' ? S.ou.pasted : '';
    const srcHref = it.cfg.source === 'bezsvitla'
      ? (it.cfg.sourceUrl || OU.bezsvitlaUrl(it.cfg.regionSlug, it.cfg.queue))
      : it.cfg.source === 'yasno' ? 'https://yasno.ua/' : OU.BEZSVITLA_BASE;
    const srcText = it.cfg.source === 'yasno' ? 'yasno.ua' : S.ou.sourceLink;
    const foot = h('div', { class: 'ou-foot' },
      h('span', { class: 'ou-meta', text: metaText }),
      h('a', { class: 'ou-src', href: safeUrl(srcHref), target: '_blank', rel: 'noopener noreferrer', text: srcText + ' ↗' }));

    root.replaceChildren(
      h('div', { class: 'ou-head' },
        h('i', { class: 'ou-dot ' + st.kind }),
        h('b', { class: 'ou-st', text: S.ou.status[st.kind] }),
        sub ? h('span', { class: 'ou-sub', text: sub }) : null),
      pillEl,
      horz,
      vert,
      foot);
  };

  const load = async force => {
    if (!ready() || it.cfg.source === 'paste') return;
    loading = true; failed = false; draw(true);
    const res = it.cfg.source === 'yasno' ? await loadYasno(it.cfg, force) : await loadBezsvitla(it.cfg, force);
    if (dead) return;
    loading = false; remote = res; failed = !res; draw(true);
  };
  const configure = () => configureOutage(it, () => { ctx.setTitle(it.cfg.name); remote = null; viewDay = 0; save(); load(true); draw(true); });

  draw(true); load(false);
  const iv = setInterval(() => load(false), 15 * 60e3);
  return {
    tick: () => draw(false), refresh: () => load(true), configure,
    enter: () => { if (!ready()) configure(); else load(true); return false; },
    destroy() { dead = true; clearInterval(iv); },
  };
};

// The dialog that picks the source: bezsvitla.com.ua (all Ukraine + address lookup), Yasno, or pasted text.
function configureOutage(it, onSaved) {
  const cfg = it.cfg, now = OU.kyivNow(Date.now());
  const sel = (label, cls) => h('select', { class: 'fi ' + (cls || ''), 'aria-label': label });
  const fill = (el, items, cur) => el.replaceChildren(...items.map(([v, t]) => h('option', { value: v, selected: String(v) === String(cur) }, t)));
  const nameIn = h('input', { class: 'fi', maxlength: 40, value: cfg.name || '', placeholder: S.ou.namePh, 'aria-label': S.ou.name });
  const src = sel(S.ou.source);
  fill(src, [['bezsvitla', S.ou.srcBezsvitla], ['yasno', S.ou.srcYasno], ['paste', S.ou.srcPaste]], cfg.source || 'bezsvitla');

  // --- bezsvitla.com.ua (universal + address lookup + manual fallback)
  const bzReg = sel(S.ou.region), bzQueue = sel(S.ou.queuePick), bzManual = h('input', { class: 'fi', placeholder: S.ou.queueManualPh, 'aria-label': S.ou.queueManual });
  const bzNote = h('div', { class: 'note' });
  let pickedCity = cfg.cityId ? { id: cfg.cityId, name: cfg.cityName || '' } : null;

  fill(bzReg, OU.BEZSVITLA_REGIONS.map(r => [r.slug, r.active ? r.name : `${r.name} (limited)`]), cfg.regionSlug || 'kyiv');
  const syncQueues = (preferred) => {
    const qs = OU.bezsvitlaQueues(bzReg.value);
    const cur = preferred || cfg.queue || qs[0];
    fill(bzQueue, qs.map(q => [q, q]), qs.includes(cur) ? cur : qs[0]);
    bzManual.value = cur;
  };
  bzQueue.addEventListener('change', () => { bzManual.value = bzQueue.value; });

  // Locality search (/search-locality?q=...)
  const cityIn = h('input', { class: 'fi', placeholder: S.ou.citySearchPh, 'aria-label': S.ou.citySearch });
  if (cfg.cityName) cityIn.value = cfg.cityName;
  const cityRes = h('div', { class: 'city-res' });
  const searchCity = async () => {
    const q = cityIn.value.trim();
    if (q.length < 2) return;
    if (!(await ensureOrigin(BEZSVITLA_ORIGIN))) { bzNote.textContent = S.ou.denied; return; }
    allowBz.hidden = true;
    cityRes.replaceChildren(h('span', { class: 'note', text: S.ou.loading }));
    try {
      const list = await (await fetch(`${BEZSVITLA}/search-locality?q=${encodeURIComponent(q)}`)).json();
      if (!Array.isArray(list) || !list.length) return cityRes.replaceChildren(h('span', { class: 'note', text: S.ou.citySearchNone }));
      cityRes.replaceChildren(...list.slice(0, 8).map(item => h('button', {
        class: 'mi', type: 'button',
        onclick: () => {
          const path = (() => { try { return new URL(item.url).pathname.split('/').filter(Boolean); } catch { return []; } })();
          const slug = path[0] || bzReg.value;
          if (OU.bezsvitlaRegion(slug)) { bzReg.value = slug; syncQueues(); }
          pickedCity = item.type === 'місто' ? { id: item.id, name: item.name } : null;
          cityIn.value = item.name;
          cityRes.replaceChildren();
          refreshAddrUi();
        },
      }, h('span', { text: item.name }), h('span', { class: 'phn', text: item.type || '' }))));
    } catch { cityRes.replaceChildren(h('span', { class: 'note', text: S.ou.loadFail })); }
  };
  const cityBtn = h('button', { class: 'btn', type: 'button', onclick: searchCity }, S.ou.citySearchBtn);
  cityIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });

  // Street & building lookup -> auto-detected subqueue
  const streetIn = h('input', { class: 'fi', placeholder: S.ou.addressStreetPh, 'aria-label': S.ou.addressStreet });
  const streetRes = h('div', { class: 'city-res' }), houseSel = sel(S.ou.addressHouse), multiBox = h('div', { class: 'row' }), addrMsg = h('div', { class: 'note' });
  let streetItems = [], buildingItems = [];
  const applyDetected = q => {
    const norm = OU.normalizeBezsvitlaQueue(bzReg.value, q);
    if (!norm) return;
    const qs = OU.bezsvitlaQueues(bzReg.value);
    if (qs.includes(norm)) bzQueue.value = norm;
    bzManual.value = norm;
    addrMsg.textContent = S.ou.addressDetected(norm);
  };
  const pickStreet = async (stItem) => {
    streetIn.value = stItem.text;
    streetRes.replaceChildren();
    multiBox.replaceChildren();
    addrMsg.textContent = S.ou.loading;
    try {
      const url = bzReg.value === 'kyiv'
        ? `${BEZSVITLA}/street-search-building?id=${encodeURIComponent(stItem.id)}`
        : `${BEZSVITLA}/street-search-city-street-building?id=${encodeURIComponent(stItem.id)}&city_id=${encodeURIComponent(pickedCity.id)}`;
      buildingItems = await (await fetch(url)).json();
      if (!Array.isArray(buildingItems) || !buildingItems.length) {
        houseSel.replaceChildren();
        addrMsg.textContent = S.ou.addressUnavailable;
        return;
      }
      fill(houseSel, [['', S.ou.addressHousePick], ...buildingItems.map((b, i) => [String(i), b.text])], '');
      addrMsg.textContent = '';
    } catch { addrMsg.textContent = S.ou.loadFail; }
  };
  const searchStreet = async () => {
    const term = streetIn.value.trim();
    if (term.length < 2) return;
    if (!(await ensureOrigin(BEZSVITLA_ORIGIN))) { addrMsg.textContent = S.ou.denied; return; }
    allowBz.hidden = true;
    addrMsg.textContent = S.ou.loading;
    multiBox.replaceChildren();
    try {
      const url = bzReg.value === 'kyiv'
        ? `${BEZSVITLA}/street-search-street?term=${encodeURIComponent(term)}`
        : `${BEZSVITLA}/street-search-city-street?term=${encodeURIComponent(term)}&city_id=${encodeURIComponent(pickedCity.id)}`;
      streetItems = await (await fetch(url)).json();
      if (!Array.isArray(streetItems) || !streetItems.length) {
        streetRes.replaceChildren();
        addrMsg.textContent = pickedCity ? S.ou.addressUnavailable : S.ou.citySearchNone;
        return;
      }
      addrMsg.textContent = '';
      streetRes.replaceChildren(...streetItems.slice(0, 8).map(s => h('button', {
        class: 'mi', type: 'button', onclick: () => pickStreet(s),
      }, h('span', { text: s.text }))));
    } catch { addrMsg.textContent = S.ou.loadFail; }
  };
  const streetBtn = h('button', { class: 'btn', type: 'button', onclick: searchStreet }, S.ou.citySearchBtn);
  streetIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchStreet(); } });
  houseSel.addEventListener('change', () => {
    multiBox.replaceChildren();
    const b = buildingItems[+houseSel.value];
    if (!b) return;
    const list = Array.isArray(b.subqueues) && b.subqueues.length ? b.subqueues : b.subqueue ? [b.subqueue] : [];
    if (!list.length) { addrMsg.textContent = S.ou.addressNotFound; return; }
    if (list.length === 1) return applyDetected(list[0]);
    applyDetected(list[0]);
    addrMsg.textContent = S.ou.addressMulti(list);
    multiBox.replaceChildren(...list.map(q => h('button', { class: 'btn', type: 'button', onclick: () => applyDetected(q) }, q)));
  });

  const addrWrap = h('div', { class: 'ou-cfg ou-addr' },
    h('div', { class: 'note', text: S.ou.addressTitle }),
    h('div', { class: 'row ctl' }, streetIn, streetBtn),
    streetRes,
    h('label', { class: 'fr' }, h('span', { text: S.ou.addressHouse }), houseSel),
    multiBox,
    addrMsg);
  const addrHint = h('div', { class: 'note', text: S.ou.addressUnavailable });
  const refreshAddrUi = () => {
    const canAddr = bzReg.value === 'kyiv' || !!(pickedCity && pickedCity.id);
    addrWrap.hidden = !canAddr;
    addrHint.hidden = canAddr;
    streetRes.replaceChildren(); multiBox.replaceChildren(); houseSel.replaceChildren(); addrMsg.textContent = '';
  };
  bzReg.addEventListener('change', () => { pickedCity = null; syncQueues(); refreshAddrUi(); });

  const allowBz = h('button', { class: 'btn main', type: 'button', onclick: async () => {
    if (await ensureOrigin(BEZSVITLA_ORIGIN)) { allowBz.hidden = true; bzNote.textContent = ''; }
    else bzNote.textContent = S.ou.denied;
  } }, S.ou.allowBezsvitla);
  const bzPanel = h('div', { class: 'ou-cfg' },
    allowBz,
    h('label', { class: 'fr' }, h('span', { text: S.ou.region }), bzReg),
    h('label', { class: 'fr' }, h('span', { text: S.ou.citySearch }), h('div', { class: 'row ctl' }, cityIn, cityBtn)),
    cityRes,
    addrWrap,
    addrHint,
    h('label', { class: 'fr' }, h('span', { text: S.ou.queuePick }), bzQueue),
    h('label', { class: 'fr' }, h('span', { text: S.ou.queueManual }), bzManual),
    bzNote);
  syncQueues(cfg.source === 'bezsvitla' ? cfg.queue : '');
  refreshAddrUi();

  // --- Yasno (compatibility fallback)
  const regSel = sel(S.ou.region), dsoSel = sel(S.ou.operator), grpSel = sel(S.ou.groupLabel), ynote = h('div', { class: 'note' });
  let regions = [];
  const loadGroups = async () => {
    if (!regSel.value || !dsoSel.value) return;
    try { fill(grpSel, OU.yasnoGroups(await (await fetch(`${YASNO}/regions/${regSel.value}/dsos/${dsoSel.value}/planned-outages`)).json()).map(g => [g, g]), cfg.group); ynote.textContent = ''; }
    catch { ynote.textContent = S.ou.loadFail; }
  };
  const showDsos = () => { const rg = regions.find(x => String(x.id) === regSel.value); fill(dsoSel, (rg ? rg.dsos : []).map(d => [d.id, d.name]), cfg.dso); return loadGroups(); };
  regSel.addEventListener('change', showDsos); dsoSel.addEventListener('change', loadGroups);
  const loadRegions = async () => {
    try {
      regions = await (await fetch(`${YASNO}/addresses/v2/regions`)).json();
      fill(regSel, regions.map(x => [x.id, x.value]), cfg.region); ynote.textContent = ''; await showDsos(); allowYasno.hidden = true;
    } catch { ynote.textContent = S.ou.loadFail; }
  };
  const allowYasno = h('button', { class: 'btn main', type: 'button', onclick: async () => { if (await ensureOrigin(YASNO_ORIGIN)) loadRegions(); else ynote.textContent = S.ou.denied; } }, S.ou.allowYasno);
  const yasnoPanel = h('div', { class: 'ou-cfg' }, allowYasno, h('label', { class: 'fr' }, h('span', { text: S.ou.region }), regSel), h('label', { class: 'fr' }, h('span', { text: S.ou.operator }), dsoSel),
    h('label', { class: 'fr' }, h('span', { text: S.ou.groupLabel }), grpSel), ynote);

  // --- pasted text (manual fallback)
  const ta = h('textarea', { class: 'fi', rows: 7, spellcheck: 'false', placeholder: S.ou.pastePh, 'aria-label': S.ou.pasteLabel });
  ta.value = (cfg.paste && cfg.paste.raw) || '';
  const meaning = sel(S.ou.meaning); fill(meaning, [['off', S.ou.meaningOff], ['on', S.ou.meaningOn]], (cfg.paste && cfg.paste.meaning) || 'off');
  const found = h('div', { class: 'note' });
  const parse = () => OU.parseSchedule(ta.value, meaning.value);
  const preview = () => {
    const p = parse(), fmt = list => list.map(i => `${OU.clock(i.from)}–${OU.clockEnd(i.to)}`).join(', ');
    found.textContent = S.ou.found(p.found, fmt(p.days.today), fmt(p.days.tomorrow));
  };
  ta.addEventListener('input', preview); meaning.addEventListener('change', preview);
  const pastePanel = h('div', { class: 'ou-cfg' }, h('div', { class: 'note', text: S.ou.pasteHelp }), ta, h('label', { class: 'fr' }, h('span', { text: S.ou.meaning }), meaning), found);

  const showPanel = () => {
    bzPanel.hidden = src.value !== 'bezsvitla';
    yasnoPanel.hidden = src.value !== 'yasno';
    pastePanel.hidden = src.value !== 'paste';
  };
  src.addEventListener('change', showPanel); showPanel(); preview();

  const done = async () => {
    if (src.value === 'bezsvitla') {
      if (!(await ensureOrigin(BEZSVITLA_ORIGIN))) return toast(S.ou.denied);
      const q = OU.normalizeBezsvitlaQueue(bzReg.value, bzManual.value.trim() || bzQueue.value);
      if (!bzReg.value || !q) return toast(S.ou.chooseQueue);
      const reg = OU.bezsvitlaRegion(bzReg.value);
      Object.assign(cfg, {
        source: 'bezsvitla',
        regionSlug: bzReg.value,
        regionName: reg ? reg.name : bzReg.value,
        queue: q,
        cityId: pickedCity ? pickedCity.id : 0,
        cityName: pickedCity ? pickedCity.name : '',
        sourceUrl: OU.bezsvitlaUrl(bzReg.value, q),
      });
    } else if (src.value === 'yasno') {
      if (!(await ensureOrigin(YASNO_ORIGIN))) return toast(S.ou.denied);
      if (!regSel.value || !dsoSel.value || !grpSel.value) return toast(S.ou.chooseAll);
      Object.assign(cfg, { source: 'yasno', region: +regSel.value, dso: +dsoSel.value, group: grpSel.value });
    } else {
      const p = parse();
      if (!p.found) return toast(S.ou.found(0));
      cfg.source = 'paste';
      cfg.paste = { date: now.date, today: p.days.today, tomorrow: p.days.tomorrow, savedAt: new Date().toISOString(), raw: ta.value.slice(0, 4000), meaning: meaning.value };
    }
    cfg.name = nameIn.value.trim().slice(0, 40) || undefined;
    closeLayer(); onSaved();
  };
  openModal(S.ou.title, [h('label', { class: 'fr' }, h('span', { text: S.ou.name }), nameIn), h('label', { class: 'fr' }, h('span', { text: S.ou.source }), src), bzPanel, yasnoPanel, pastePanel],
    [h('button', { class: 'btn', onclick: closeLayer }, S.cancel), h('button', { class: 'btn main', onclick: done }, S.save)]);

  hasOrigin(BEZSVITLA_ORIGIN).then(ok => { allowBz.hidden = ok; });
  hasOrigin(YASNO_ORIGIN).then(ok => { if (ok) loadRegions(); });
}

/* ═════════════ fuzzy search ═════════════ */
function fuzzy(q, s) {
  q = q.toLowerCase(); const t = s.toLowerCase();
  let qi = 0, score = 0, last = -2; const idx = [];
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      idx.push(i); score += 1;
      if (i === last + 1) score += 2;
      if (i === 0 || /[\s\-_/.:]/.test(t[i - 1])) score += 3;
      last = i; qi++;
    }
  }
  if (qi < q.length) return null;
  if (t.startsWith(q)) score += 5;
  return { score: score - t.length * 0.01, idx };
}

// If you typed with the Ukrainian layout by accident, read it as if typed in English.
const UA = 'йцукенгшщзхїфівапролджєячсмитьбюґ', EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.\\";
const deLayout = q => [...q.toLowerCase()].map(ch => { const i = UA.indexOf(ch); return i < 0 ? ch : EN[i]; }).join('');

function hl(label, idx) {
  if (!idx || !idx.length) return label;
  const set = new Set(idx), frag = document.createDocumentFragment();
  let buf = '', on = false;
  const flushBuf = () => { if (!buf) return; frag.append(on ? h('mark', { text: buf }) : buf); buf = ''; };
  [...label].forEach((ch, i) => { const m = set.has(i); if (m !== on) { flushBuf(); on = m; } buf += ch; });
  flushBuf();
  return frag;
}

/* ═════════════ command palette ═════════════ */
// Optional host permission: asked the first time it is needed. request() resolves true at once if it is already granted,
// and is called synchronously from the click handler so the browser still sees the user gesture.
const GEO = 'https://geocoding-api.open-meteo.com/';
async function ensureOrigin(origin) {
  if (!isExt || !api.permissions || !api.permissions.request) return true;
  try { return await api.permissions.request({ origins: [origin] }); }
  catch { return true; }                         // permission API without optional hosts: just try the request
}
async function findCities(q) {
  const r = await fetch(`${GEO}v1/search?name=${encodeURIComponent(q)}&count=8&language=${S.lang}&format=json`);
  if (!r.ok) throw new Error(r.status);
  return ((await r.json()).results || []).map(c => ({ name: c.name, admin: c.admin1 || '', country: c.country || '', lat: c.latitude, lon: c.longitude }));
}

const openUrl = (u, newTab) => { if (newTab) window.open(u, '_blank', 'noopener'); else location.assign(u); };

function commands() {
  const c = [];
  // `only`: a command that stays out of the way until the query mentions it (themes, per-workspace moves)
  const add = (label, hint, run, only) => c.push({ label, hint, kind: 'cmd', color: 'var(--hot)', score: 0, run, only });
  state.ws.forEach((w, i) => add(S.cmdWs(w.name), String(i + 1), () => switchWs(i)));
  Object.keys(MODULES).forEach(t => add(S.cmdAdd(MODULES[t].title), S.moduleWord, () => addTile(t)));
  add(S.cmdEdit, 'E', toggleEdit);
  add(S.cmdPack, '', autopack);
  add(S.cmdTimerToggle, 'Space', timerToggle);
  add(S.cmdTimerReset, '', timerReset);
  add(S.cmdNewWs, '', newWs);
  add(S.cmdRenameWs, 'F2', () => renameWs());
  add(S.cmdDeleteWs, '', delWs);
  if (focusId) {
    add(S.cmdDeleteTile, 'X', () => removeTile(focusId));
    add(S.cmdDuplicateTile, '', () => duplicateTile(focusId));
    add(S.cmdResetSize, '', () => resetTileSize(focusId));
    const fr = tiles.get(focusId); if (fr && fr.api.configure) add(S.cmdConfigureTile, '', () => fr.api.configure());
    add(S.moveTileCmd, '', () => openPalette(S.moveTileTo('')));
    state.ws.forEach((w, i) => { if (i !== state.active) add(S.moveTileTo(w.name || String(i + 1)), i < 9 ? `Shift+${i + 1}` : '', () => moveTileToWs(focusId, i), /move/i); });
  }
  if (undoStack.length) add(S.cmdUndo, 'Z', undo);
  for (const id of Object.keys(S.themes)) add(S.cmdTheme(S.themes[id]), '', () => setTheme(id), /theme/i);
  add(S.cmdSettings, ',', openSettings);
  add(S.cmdHelp, '?', openHelp);
  add(S.cmdExport, '', exportData);
  add(S.cmdImport, '', importData);
  if (isExt && !hasPerms) add(S.cmdPerms, S.hintExt, grantPerms);
  return c;
}

function linkItems() {
  const out = [];
  for (const g of state.groups) for (const l of g.links) {
    out.push({ label: l.name, sub: host(l.url), hint: g.name, kind: 'link', color: dotColor(l), score: 2, run: e => openUrl(l.url, e && (e.ctrlKey || e.metaKey)) });
  }
  return out;
}

function buildRows(q, ext) {
  q = q.trim();
  if (!q) return commands().filter(c => !c.only).slice(0, 9);
  let m;
  if ((m = q.match(/^\+\s*(.+)$/))) return [{ label: S.addTask(m[1]), hint: S.hintTasks, color: 'var(--green)', run: () => addTask(m[1]) }];
  if ((m = q.match(/^!(\S+)\s+(.+)$/)) && state.settings.engines[m[1]]) {
    const [u, n] = state.settings.engines[m[1]];
    return [{ label: S.searchIn(n, m[2]), hint: '!' + m[1], color: 'var(--blue)', run: e => openUrl(u + encodeURIComponent(m[2]), e && (e.ctrlKey || e.metaKey)) }];
  }
  const alt = deLayout(q), qs = [...new Set([q, alt])];
  const scored = [];
  for (const it of [...commands(), ...linkItems(), ...ext]) {
    if (it.only && !it.only.test(q)) continue;
    let best = null;
    for (const qq of qs) { const f = fuzzy(qq, it.label); if (f && (!best || f.score > best.score)) best = f; }
    if (!best && it.sub) for (const qq of qs) { const f = fuzzy(qq, it.sub); if (f && (!best || f.score * .5 > best.score)) best = { score: f.score * .5, idx: null }; }
    if (best) scored.push({ ...it, idx: best.idx, rank: best.score + (it.score || 0) });
  }
  scored.sort((a, b) => b.rank - a.rank);
  const rows = scored.slice(0, 8);
  const [u, n] = state.settings.engines[state.settings.engine];
  if (/^(https?:\/\/)?[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(q)) {
    const url = /^https?:\/\//i.test(q) ? q : 'https://' + q;
    rows.push({ label: S.openUrl(q), hint: S.hintAddr, color: 'var(--green)', run: e => openUrl(url, e && (e.ctrlKey || e.metaKey)) });
  }
  rows.push({ label: S.searchIn(n, q), hint: 'Enter', color: 'var(--blue)', run: e => openUrl(u + encodeURIComponent(q), e && (e.ctrlKey || e.metaKey)) });
  return rows;
}

async function loadExt() {
  if (!isExt || !api.permissions) return [];
  try { hasPerms = await api.permissions.contains({ permissions: ['tabs', 'bookmarks', 'history'] }); } catch { hasPerms = false; }
  if (!hasPerms) return [];
  const out = [];
  try {
    for (const t of await api.tabs.query({})) if (t.url && t.title && !t.url.startsWith('chrome') && !t.active)
      out.push({ label: t.title, sub: host(t.url), hint: S.kindTab, kind: 'tab', color: 'var(--yellow)', score: 1.5, run: () => { api.tabs.update(t.id, { active: true }); api.windows.update(t.windowId, { focused: true }); } });
  } catch { /* ignore */ }
  try {
    const walk = n => { if (n.url) out.push({ label: n.title || n.url, sub: host(n.url), hint: S.kindBookmark, kind: 'bm', color: 'var(--purple)', score: 1, run: e => openUrl(n.url, e && (e.ctrlKey || e.metaKey)) }); (n.children || []).forEach(walk); };
    (await api.bookmarks.getTree()).forEach(walk);
  } catch { /* ignore */ }
  try {
    for (const x of await api.history.search({ text: '', maxResults: 400, startTime: Date.now() - 30 * 864e5 }))
      if (x.title) out.push({ label: x.title, sub: host(x.url), hint: S.kindHistory, kind: 'hist', color: 'var(--dim)', score: 0, run: e => openUrl(x.url, e && (e.ctrlKey || e.metaKey)) });
  } catch { /* ignore */ }
  return out;
}

async function grantPerms() {
  try { hasPerms = await api.permissions.request({ permissions: ['tabs', 'bookmarks', 'history'] }); toast(hasPerms ? S.permsGranted : S.permsDenied); }
  catch { toast(S.permsFail); }
}

function closeLayer() {
  if (!layer) return;
  const { el, opener, onClose } = layer;
  el.remove(); layer = null;
  if (onClose) onClose();
  if (opener && opener.isConnected && opener.focus) opener.focus();   // give focus back after a menu
}

async function openPalette(initial) {
  closeLayer();
  const input = h('input', { class: 'pi', placeholder: S.palettePlaceholder, autocomplete: 'off', spellcheck: 'false', 'aria-label': S.paletteLabel });
  const list = h('div', { class: 'pl', role: 'listbox' });
  const el = h('div', { class: 'layer', onmousedown: e => { if (e.target === el) closeLayer(); } }, h('div', { class: 'pbox' }, input, list, h('div', { class: 'pf' }, S.palFoot.map(([k, d]) => h('span', {}, h('kbd', { text: k }), d)))));
  document.body.append(el);
  layer = { el };
  let ext = [], rows = [], sel = 0;
  const draw = () => {
    list.replaceChildren(...rows.map((r, i) => {
      const row = h('div', { class: 'pr' + (i === sel ? ' sel' : ''), role: 'option', onmouseenter: () => { if (sel !== i) { sel = i; draw(); } }, onclick: e => { closeLayer(); r.run(e); } },
        h('span', { class: 'pc' }), h('span', { class: 'plb' }, hl(r.label, r.idx)), h('span', { class: 'phn', text: r.hint || '' }));
      if (r.color) row.firstChild.style.setProperty('--c', r.color);
      return row;
    }));
    const s = list.children[sel]; if (s && s.scrollIntoView) s.scrollIntoView({ block: 'nearest' });
  };
  const update = () => { rows = buildRows(input.value, ext); sel = 0; draw(); };
  input.addEventListener('input', update);
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    const down = e.key === 'ArrowDown' || e.key === 'Tab' && !e.shiftKey || e.ctrlKey && (e.code === 'KeyJ' || e.code === 'KeyN');
    const up = e.key === 'ArrowUp' || e.key === 'Tab' && e.shiftKey || e.ctrlKey && (e.code === 'KeyK' || e.code === 'KeyP');
    if (down) { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); draw(); }
    else if (up) { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[sel]; if (r) { closeLayer(); r.run(e); } }
    else if (e.key === 'Escape' || (e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); closeLayer(); }
  });
  input.value = initial || '';
  input.focus();
  update();
  const mine = layer;
  ext = await loadExt();
  if (layer === mine && ext.length) { const keep = sel; update(); sel = Math.min(keep, rows.length - 1); draw(); }
}

/* ═════════════ modals: settings, help ═════════════ */
function openModal(title, content, footer) {
  closeLayer();
  const el = h('div', { class: 'layer', onmousedown: e => { if (e.target === el) closeLayer(); } },
    h('div', { class: 'mbox', role: 'dialog', 'aria-label': title },
      h('div', { class: 'mh' }, h('span', { text: title }), h('button', { class: 'mx', onclick: closeLayer, 'aria-label': S.close }, '×')),
      h('div', { class: 'mc' }, content), footer ? h('div', { class: 'mf' }, footer) : null));
  document.body.append(el);
  layer = { el };
  const first = el.querySelector('input, textarea, button.btn'); if (first) first.focus();
}

function openHelp() {
  const K = ks => ks.flatMap((k, i) => [i ? S.or : null, h('kbd', { text: k })]);
  openModal(S.helpTitle, [
    h('div', { class: 'keys' }, S.helpRows.flatMap(([k, d]) => [h('div', {}, K(k)), h('div', { text: d })])),
    h('div', { class: 'empty', text: S.helpFoot })]);
}

function exportData() {
  flush();
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })), download: 'hud-home.json' });
  document.body.append(a); a.click(); a.remove();
  toast(S.exported);
}
function importData() {
  const i = h('input', { type: 'file', accept: 'application/json,.json' });
  i.onchange = async () => {
    try {
      const j = JSON.parse(await i.files[0].text());
      if (!j || j.v !== 1 || !Array.isArray(j.ws) || !Array.isArray(j.groups)) throw new Error('format');
      backupNow();
      state = VEGA.state.normalize(j); flush(); applyBg(); renderAll(); toast(S.imported);
    } catch { toast(S.importBad); }
  };
  i.click();
}

function openSettings() {
  const s = state.settings, f = {};
  const field_ = (k, label, type, val) => { const i = h('input', { class: 'fi', type, value: val, step: type === 'number' ? 'any' : null }); f[k] = i; return h('label', { class: 'fr' }, h('span', { text: label }), i); };
  const eng = h('select', { class: 'fi' }, Object.entries(s.engines).map(([k, v]) => h('option', { value: k, selected: k === s.engine }, `${v[1]} (!${k})`)));
  const ta = h('textarea', { class: 'fi', rows: 12, spellcheck: 'false', 'aria-label': S.setLinksAria });
  ta.value = JSON.stringify(state.groups.map(({ tab, name, links }) => ({ tab, name, links })), null, 1);
  // Appearance: changes preview live and are reverted unless Save is pressed.
  const orig = { theme: s.theme, accent: s.accent, linkTheme: s.linkTheme, bgFit: s.bgFit };
  let committed = false;
  const cssHex = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const acc = h('input', { type: 'color', class: 'fi-color', 'aria-label': S.setAccent });
  const accNote = h('span', { class: 'note' });
  const syncAccent = () => {
    const v = s.accent || cssHex('--accent');
    if (/^#[0-9a-f]{6}$/i.test(v)) acc.value = v;
    accNote.textContent = !s.accent ? S.accentAuto : VEGA.contrast(s.accent, cssHex('--surface')) < 4.5 ? S.accentLow : '';
  };
  const cards = Object.keys(S.themes).map(id => h('button', { class: 'sw', type: 'button', role: 'radio', 'data-theme': id, 'aria-checked': String(id === s.theme), title: S.themes[id], onclick: () => pick(id) },
    h('span', { class: 'sw-p' }, h('i', { class: 'a' }), h('i', { class: 'b' }), h('i', { class: 'c' }), h('b', { text: 'Aa' })),
    h('span', { class: 'sw-n', text: S.themes[id] })));
  const pick = id => {
    s.theme = id; VEGA.applyTheme(id, s.accent);
    cards.forEach(c => c.setAttribute('aria-checked', String(c.dataset.theme === id)));
    syncAccent();
  };
  const group = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': S.setTheme }, cards);
  group.addEventListener('keydown', e => {                       // arrow keys move between cards
    const i = cards.indexOf(document.activeElement); if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); const n = cards[(i + d + cards.length) % cards.length]; n.focus(); pick(n.dataset.theme);
  });
  acc.addEventListener('input', () => { s.accent = acc.value; VEGA.applyTheme(s.theme, s.accent); syncAccent(); });
  const accReset = h('button', { class: 'btn', type: 'button', onclick: () => { s.accent = ''; VEGA.applyTheme(s.theme, ''); syncAccent(); } }, S.accentReset);
  const dots = h('input', { type: 'checkbox', checked: s.linkTheme, onchange: () => { s.linkTheme = dots.checked; refresh('links'); } });
  syncAccent();

  // City search: fills the label and coordinates below.
  const cityQ = h('input', { class: 'fi', placeholder: S.cityPlaceholder, 'aria-label': S.setCityFind, autocomplete: 'off' });
  const cityRes = h('div', { class: 'city-res', role: 'listbox' });
  const searchCity = async () => {
    const q = cityQ.value.trim(); if (q.length < 2) return;
    const ok = await ensureOrigin(GEO + '*');                  // first statement: still inside the user gesture
    if (!ok) { cityRes.replaceChildren(h('div', { class: 'note', text: S.cityDenied })); return; }
    cityRes.replaceChildren(h('div', { class: 'note', text: S.bgProbing }));
    try {
      const list = await findCities(q);
      cityRes.replaceChildren(...(list.length ? list.map(c => h('button', { class: 'mi', type: 'button', role: 'option', onclick: () => {
        f.place.value = c.name; f.lat.value = c.lat; f.lon.value = c.lon; cityRes.replaceChildren(h('div', { class: 'note', text: S.cityPicked(c.name) }));
      } }, h('span', { text: [c.name, c.admin, c.country].filter(Boolean).join(', ') }), h('span', { class: 'phn', text: `${c.lat.toFixed(2)}, ${c.lon.toFixed(2)}` })))
        : [h('div', { class: 'note', text: S.cityNone })]));
    } catch { cityRes.replaceChildren(h('div', { class: 'note', text: S.cityFail })); }
  };
  const cityGo = h('button', { class: 'btn', type: 'button', onclick: searchCity }, S.citySearch);
  cityQ.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); searchCity(); } });

  // Background: URL or local file, fit mode, sharpening. The note says whether the source is big enough for this screen.
  let pendingFile = null, removeLocal = false, probeT = 0;
  const bgField = field_('bg', S.setBgUrl, 'url', s.bg);
  const fit = h('select', { class: 'fi', 'aria-label': S.setBgFit }, Object.entries(S.bgFits).map(([k, v]) => h('option', { value: k, selected: k === s.bgFit }, v)));
  const sharpen = h('input', { type: 'checkbox', checked: s.bgSharpen });
  const bgInfo = h('div', { class: 'note' });
  const fileName = h('span', { class: 'note', text: S.bgFileNone });
  const picker = h('input', { type: 'file', accept: 'image/*,video/*', hidden: true });
  const refreshInfo = async () => {
    let src = null, video = false, own = false, bytes = 0;
    if (pendingFile) { src = URL.createObjectURL(pendingFile); own = true; bytes = pendingFile.size; video = pendingFile.type.startsWith('video/'); }
    else if (s.bgLocal && !removeLocal && VEGA.bgstore) { try { const rec = await VEGA.bgstore.get('bg'); if (rec) { src = URL.createObjectURL(rec.blob); own = true; bytes = rec.blob.size; video = rec.blob.type.startsWith('video/'); } } catch { /* ignore */ } }
    else if (f.bg.value.trim()) { src = f.bg.value.trim(); video = VIDEO_EXT.test(src); }
    if (!src) { bgInfo.textContent = ''; return; }
    bgInfo.textContent = S.bgProbing;
    const size = await probeMedia(src, video);
    if (own) URL.revokeObjectURL(src);
    if (!size || !size[0]) { bgInfo.textContent = S.bgUnknown; return; }
    const sw = Math.round(innerWidth * devicePixelRatio), sh = Math.round(innerHeight * devicePixelRatio);
    const scale = s.bgFit === 'actual' ? 1 : Math.max(sw / size[0], sh / size[1]);
    const facts = video && size[2] && isFinite(size[2]) ? ' ' + S.bgVideoFacts(size[2], bytes) + (Math.max(size[0], size[1]) >= 3000 ? ' ' + S.bgHeavy : '') : '';
    bgInfo.textContent = S.bgInfo(size[0], size[1], sw, sh, scale) + (video ? ' ' + S.bgVideoNote : '') + facts;
  };
  const queueInfo = () => { clearTimeout(probeT); probeT = setTimeout(refreshInfo, 400); };
  bgField.addEventListener('input', queueInfo);
  const showName = rec => { fileName.textContent = pendingFile ? pendingFile.name : (s.bgLocal && !removeLocal && rec ? rec.name : S.bgFileNone); };
  if (s.bgLocal && VEGA.bgstore) VEGA.bgstore.get('bg').then(rec => showName(rec)).catch(() => {});
  picker.addEventListener('change', () => {
    const file = picker.files[0]; if (!file) return;
    if (file.size > 300 * 1024 * 1024) return toast(S.bgTooBig);
    pendingFile = file; removeLocal = false; showName(); refreshInfo();
  });
  const removeBtn = h('button', { class: 'btn', type: 'button', onclick: () => { pendingFile = null; removeLocal = true; fileName.textContent = S.bgFileNone; refreshInfo(); } }, S.bgRemoveFile);
  fit.addEventListener('change', () => { s.bgFit = fit.value; queueInfo(); });
  refreshInfo();

  // New tab: Firefox focuses the address bar; re-opening the page once puts focus on the page instead.
  const focusBox = h('input', { type: 'checkbox', checked: s.focusPage });
  const forgetBox = h('input', { type: 'checkbox', checked: s.focusForget });
  forgetBox.addEventListener('change', () => {
    if (!api || !api.permissions) return;
    if (forgetBox.checked) api.permissions.request({ permissions: ['sessions'] }).then(ok => { if (!ok) forgetBox.checked = false; }).catch(() => { forgetBox.checked = false; });
    else api.permissions.remove({ permissions: ['sessions'] }).catch(() => {});
  });

  const apply = () => {
    let groups;
    try {
      groups = JSON.parse(ta.value);
      if (!Array.isArray(groups) || groups.some(g => !g || typeof g.name !== 'string' || !Array.isArray(g.links))) throw new Error('shape');
    } catch { return toast(S.setLinksBad); }
    state.groups = groups.map(g => ({ id: uid(), tab: g.tab || '', name: g.name, links: g.links.filter(l => l && l.name && l.url) }));
    s.place = f.place.value.trim() || s.place;
    s.lat = parseFloat(f.lat.value) || s.lat; s.lon = parseFloat(f.lon.value) || s.lon;
    s.focusMin = clamp(parseInt(f.focusMin.value, 10) || 25, 1, 180); s.breakMin = clamp(parseInt(f.breakMin.value, 10) || 5, 1, 60);
    s.bg = f.bg.value.trim(); s.engine = eng.value;
    s.bgFit = fit.value; s.bgSharpen = sharpen.checked;
    s.focusPage = focusBox.checked; s.focusForget = focusBox.checked && forgetBox.checked;
    if (!state.timer.running) state.timer.remaining = timerLen(state.timer.mode);
    const done = () => { committed = true; flush(); applyBg(); closeLayer(); renderAll(); toast(S.saved); };
    if (pendingFile) {
      VEGA.bgstore.put('bg', pendingFile, { name: pendingFile.name, type: pendingFile.type, size: pendingFile.size })
        .then(() => { s.bgLocal = true; if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); done(); })
        .catch(() => toast(S.bgStoreFail));
    } else if (removeLocal && s.bgLocal) {
      VEGA.bgstore.del('bg').catch(() => {}).then(() => { s.bgLocal = false; done(); });
    } else done();
  };
  openModal(S.settingsTitle, [
    h('h3', { text: S.setAppearance }), group,
    h('div', { class: 'fr' }, h('span', { text: S.setAccent }), h('div', { class: 'row ctl' }, acc, accReset, accNote)),
    h('label', { class: 'fr' }, h('span', { text: S.setLinkTheme }), h('span', { class: 'row' }, dots)),
    h('h3', { text: S.setWeather }),
    h('div', { class: 'fr' }, h('span', { text: S.setCityFind }), h('div', { class: 'row ctl' }, cityQ, cityGo)), cityRes,
    field_('place', S.setPlace, 'text', s.place), field_('lat', S.setLat, 'number', s.lat), field_('lon', S.setLon, 'number', s.lon),
    h('h3', { text: S.setTimerSearch }), field_('focusMin', S.setFocusMin, 'number', s.focusMin), field_('breakMin', S.setBreakMin, 'number', s.breakMin),
    h('label', { class: 'fr' }, h('span', { text: S.setEngine }), eng),
    h('h3', { text: S.setBg }), bgField,
    h('div', { class: 'fr' }, h('span', { text: S.setBgFile }), h('div', { class: 'row ctl' }, h('button', { class: 'btn', type: 'button', onclick: () => picker.click() }, S.bgPick), picker, removeBtn, fileName)),
    h('label', { class: 'fr' }, h('span', { text: S.setBgFit }), fit),
    h('label', { class: 'fr' }, h('span', { text: S.setBgSharpen }), h('span', { class: 'row' }, sharpen)),
    bgInfo,
    isExt ? h('h3', { text: S.setNewTab }) : null,
    isExt ? h('label', { class: 'fr' }, h('span', { text: S.setFocusPage }), h('span', { class: 'row' }, focusBox)) : null,
    isExt ? h('label', { class: 'fr' }, h('span', { text: S.setFocusForget }), h('span', { class: 'row' }, forgetBox)) : null,
    isExt ? h('div', { class: 'note' }, S.focusNote) : null,
    h('h3', { text: S.setLinks }), ta,
    h('h3', { text: S.setData }),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: exportData }, S.export), h('button', { class: 'btn', onclick: importData }, S.import),
      h('button', { class: 'btn', onclick: () => { if (confirm(S.resetConfirm)) { committed = true; backupNow(); state = VEGA.state.normalize(null); flush(); applyBg(); closeLayer(); renderAll(); } } }, S.resetAll)),
  ], [h('button', { class: 'btn', onclick: closeLayer }, S.cancel), h('button', { class: 'btn main', onclick: apply }, S.save)]);
  layer.onClose = () => {
    if (committed) return;
    s.theme = orig.theme; s.accent = orig.accent; s.linkTheme = orig.linkTheme; s.bgFit = orig.bgFit;
    VEGA.applyTheme(s.theme, s.accent); refresh('links');
  };
}

/* ═════════════ wallpaper: <img>/<video> behind the page; remote URL or a local file from IndexedDB ═════════════ */
const VIDEO_EXT = /\.(mp4|webm|ogv|m4v|mov)(\?|#|$)/i;
const reducedMotion = () => !!(globalThis.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
let bgReq = 0, bgObjUrl = null, bgVideo = null;

function mountBg(src, kind) {
  const bgm = $('#bgm'), s = state.settings;
  bgVideo = null;
  bgm.replaceChildren();
  bgm.dataset.fit = s.bgFit;
  bgm.classList.toggle('sharp', s.bgSharpen && kind === 'image');
  document.body.classList.toggle('has-bg', !!src);
  document.body.classList.toggle('bg-video', !!src && kind === 'video');
  if (!src) return;
  // 'actual' = one image pixel per screen pixel: size the element from its natural size and the device pixel ratio
  const actual = el => { if (s.bgFit === 'actual') { const [w, h] = [el.naturalWidth || el.videoWidth, el.naturalHeight || el.videoHeight]; if (w) { el.style.width = w / devicePixelRatio + 'px'; el.style.height = h / devicePixelRatio + 'px'; el.style.objectFit = 'fill'; } } };
  if (kind === 'video') {
    const v = document.createElement('video');
    v.muted = true; v.loop = true; v.playsInline = true; v.autoplay = !reducedMotion(); v.preload = 'auto'; v.disablePictureInPicture = true;
    v.addEventListener('loadedmetadata', () => actual(v));
    v.addEventListener('loadeddata', () => { if (reducedMotion()) { v.currentTime = 0; v.pause(); } });
    v.addEventListener('error', () => toast(S.bgLoadFail));
    v.src = src; bgVideo = v; bgm.append(v);
  } else {
    const i = document.createElement('img');
    i.alt = ''; i.decoding = 'async';
    i.addEventListener('load', () => actual(i));
    i.addEventListener('error', () => { if (!i.dataset.retried && !bgObjUrl) { i.dataset.retried = '1'; mountBg(src, 'video'); } else toast(S.bgLoadFail); });
    i.src = src; bgm.append(i);
  }
}
document.addEventListener('visibilitychange', () => { if (bgVideo && !reducedMotion()) { if (document.hidden) bgVideo.pause(); else bgVideo.play().catch(() => {}); } });

async function applyBg() {
  const s = state.settings, req = ++bgReq;
  let blob = null;
  if (s.bgLocal && VEGA.bgstore) { try { const rec = await VEGA.bgstore.get('bg'); blob = rec && rec.blob; } catch { /* no IndexedDB: fall back to the URL */ } }
  if (req !== bgReq) return;                                   // a newer applyBg() superseded this one
  if (bgObjUrl) { URL.revokeObjectURL(bgObjUrl); bgObjUrl = null; }
  if (blob) { bgObjUrl = URL.createObjectURL(blob); mountBg(bgObjUrl, blob.type.startsWith('video/') ? 'video' : 'image'); }
  else mountBg(s.bg, s.bg ? (VIDEO_EXT.test(s.bg) ? 'video' : 'image') : '');
}

// Natural size of a URL/blob, to tell the user whether it will look sharp on this screen.
function probeMedia(src, isVideo) {
  return new Promise(resolve => {
    const el = isVideo ? document.createElement('video') : new Image();
    el.onload = () => resolve([el.naturalWidth, el.naturalHeight]);
    el.onloadedmetadata = () => resolve([el.videoWidth, el.videoHeight, el.duration]);
    el.onerror = () => resolve(null);
    if (isVideo) el.preload = 'metadata';
    el.src = src;
  });
}

function setTheme(id) {
  state.settings.theme = id;
  VEGA.applyTheme(id, state.settings.accent);
  save();
}

/* ═════════════ keyboard (by physical key, so any layout works) ═════════════ */
const isTyping = t => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const DIRS = { KeyH: 'l', KeyJ: 'd', KeyK: 'u', KeyL: 'r', ArrowLeft: 'l', ArrowDown: 'd', ArrowUp: 'u', ArrowRight: 'r' };
const STEP = { l: [-1, 0], r: [1, 0], u: [0, -1], d: [0, 1] };

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (layer) return closeLayer();
    if (innerAlive()) return leaveTile();
    if (isTyping(e.target)) return e.target.blur();
    if (mode !== 'normal') return setMode('normal');
    if (editing) return toggleEdit();
    return;
  }
  if (layer) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); return openPalette(); }
  if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
  if (innerAlive()) return;                          // inside a tile: the module handles arrows and letters

  if (e.code === 'Slash' && !e.shiftKey || e.key === '/') { e.preventDefault(); return openPalette(); }
  if (e.code === 'Slash' && e.shiftKey || e.key === '?') { e.preventDefault(); return openHelp(); }
  if (e.code === 'Comma') { e.preventDefault(); return openSettings(); }
  if (e.code === 'F2') { e.preventDefault(); return renameWs(); }
  if (/^Digit[1-9]$/.test(e.code)) {
    const n = +e.code.slice(5) - 1;
    if (!e.shiftKey) return switchWs(n);
    e.preventDefault();
    return focusId ? moveTileToWs(focusId, n) : undefined;
  }

  const dir = DIRS[e.code];
  if (dir) {
    e.preventDefault();
    const [dx, dy] = STEP[dir];
    if (mode === 'resize') {
      const it = ws().items.find(i => i.id === focusId);
      if (it) patchFocused({ w: it.w + dx, h: it.h + dy });
      return;
    }
    if (e.shiftKey) { const it = ws().items.find(i => i.id === focusId); if (it) patchFocused({ x: it.x + dx, y: it.y + dy }); return; }
    return moveFocus(dir);
  }
  if (e.shiftKey) return;
  switch (e.code) {
    case 'KeyR': e.preventDefault(); return setMode(mode === 'resize' ? 'normal' : 'resize');
    case 'KeyE': e.preventDefault(); return toggleEdit();
    case 'KeyA': e.preventDefault(); return openPalette(S.addModule + ' ');
    case 'KeyX': e.preventDefault(); return focusId && removeTile(focusId);
    case 'KeyM': { e.preventDefault(); const rec = tiles.get(focusId); return rec && openTileMenu(focusId, rec.el.querySelector('.tmn')); }
    case 'KeyZ': e.preventDefault(); return undo();
    case 'Enter':
      if (mode === 'resize') { e.preventDefault(); setMode('normal'); return; }
      if (e.target.closest && e.target.closest('button, a')) return;   // let focused controls activate natively
      if (focusId) { e.preventDefault(); enterTile(focusId); }
      return;
    case 'Space': { if (e.target.closest && e.target.closest('button, a')) return; const r = tiles.get(focusId); if (r && r.it.type === 'timer') { e.preventDefault(); timerToggle(); } return; }
  }
});

/* ═════════════ the toolbar popup and Preferences reuse an open VEGA tab instead of opening another ═════════════ */
if (isExt && api.runtime.onMessage) {
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || (msg.type !== 'vega:open-settings' && msg.type !== 'vega:focus')) return undefined;
    if (msg.visibleOnly && document.visibilityState !== 'visible') return undefined;   // let the visible tab answer
    if (msg.type === 'vega:open-settings') openSettings();
    Promise.resolve(api.tabs && api.tabs.getCurrent ? api.tabs.getCurrent() : null)
      .then(t => sendResponse(t ? { tabId: t.id, windowId: t.windowId } : {}))
      .catch(() => sendResponse({}));
    return true;                                                                       // answer asynchronously
  });
}

/* ═════════════ new tab focus (Firefox puts it in the address bar) ═════════════ */
// Re-open the page once as a regular tab: the browser then leaves focus on the page.
// The re-opened tab (marked #from=<id>) closes the original and, if allowed, forgets it in 'recently closed'.
async function focusPageFix() {
  if (!isExt || !api.tabs || !api.tabs.getCurrent) return;
  const s = state.settings, base = location.href.split('#')[0];
  const m = location.hash.match(/^#from=(\d+)\.(\d+)$/);
  try {
    if (m) {
      history.replaceState(null, '', location.pathname + location.search);
      if (Date.now() - +m[2] > 10000) return;                   // a stale marker (bookmark, restored session) must never close a tab
      await api.tabs.remove(+m[1]);
      if (s.focusForget && api.sessions && api.sessions.getRecentlyClosed) {
        for (const e of await api.sessions.getRecentlyClosed({ maxResults: 5 })) {
          if (e.tab && e.tab.url && e.tab.url.split('#')[0] === base) await api.sessions.forgetClosedTab(e.tab.windowId, e.tab.sessionId);
        }
      }
      return;
    }
    if (!s.focusPage) return;
    const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    if (nav && nav.type !== 'navigate') return;                 // a reload or back/forward: leave it alone
    const tab = await api.tabs.getCurrent();
    if (tab) await api.tabs.create({ url: base + '#from=' + tab.id + '.' + Date.now(), index: tab.index + 1, active: true });
  } catch { /* the page keeps working without the trick */ }
}

/* ═════════════ boot ═════════════ */
addEventListener('resize', () => layoutAll());
applyBg();
VEGA.applyTheme(state.settings.theme, state.settings.accent);
focusPageFix();
renderAll();
tickAll();
if (/[?&#]settings\b/.test(location.search + location.hash)) { history.replaceState(null, '', location.pathname); openSettings(); }
setInterval(tickAll, 1000);
if (isExt && api.permissions) api.permissions.contains({ permissions: ['tabs', 'bookmarks', 'history'] }).then(v => { hasPerms = v; }).catch(() => {});
})();
