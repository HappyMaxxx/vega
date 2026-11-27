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
    h('span', { class: 'tt', text: mod.title }), status,
    h('button', { class: 'tb tmn', title: S.tileMenu + ' (M)', 'aria-label': S.tileMenu, 'aria-haspopup': 'menu', onclick: e => openTileMenu(it.id, e.currentTarget) }, '…'),
    h('button', { class: 'tb tc', title: S.tileDelete + ' (X)', 'aria-label': S.tileDelete, onclick: () => removeTile(it.id) }, '×'));
  const body = h('div', { class: 'mb' });
  const rz = h('i', { class: 'rz', onpointerdown: e => dragTrack(e, rec, 'resize') });
  const el = h('section', { class: 'tile', 'data-type': it.type, 'data-id': it.id, onpointerdown: () => setFocus(it.id) }, th, body, rz);
  rec.el = el; rec.body = body;
  tiles.set(it.id, rec);
  field.append(el);
  rec.api = mod.render(body, { it, setStatus: t => { status.replaceChildren(t); }, editing }) || {};
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
function renameWs() {
  const n = prompt(S.wsRenamePrompt, ws().name);
  if (n && n.trim()) { ws().name = n.trim().slice(0, 20); save(); renderBar(); }
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

function renderBar() {
  const nav = $('#wsbar');
  nav.replaceChildren(
    ...state.ws.map((w, i) => h('button', { class: 'wsb' + (i === state.active ? ' on' : ''), onclick: () => switchWs(i), title: S.wsTitle(i + 1), 'data-ws': i },
      h('b', { text: i + 1 }), w.name && w.name !== String(i + 1) ? w.name : null)),
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
}

/* ═════════════ modules ═════════════ */
MODULES.clock.render = body => {
  const t = h('div', { class: 'ck-t' }), d = h('div', { class: 'ck-d' }), p = h('div', { class: 'ck-p' }, h('i'));
  body.append(h('div', { class: 'ck' }, t, d, p));
  const fmt = new Intl.DateTimeFormat(S.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  const tick = () => {
    const n = new Date();
    t.textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
    t.dataset.s = pad(n.getSeconds());
    d.textContent = fmt.format(n);
    const pr = (n.getHours() * 3600 + n.getMinutes() * 60 + n.getSeconds()) / 86400;
    p.firstChild.style.width = (pr * 100).toFixed(2) + '%';
    p.title = S.dayPassed(Math.round(pr * 100));
  };
  tick();
  return { tick };
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

MODULES.links.render = (body, ctx) => {
  const it = ctx.it;
  const draw = () => {
    const groups = state.groups.filter(g => !it.cfg.tab || g.tab === it.cfg.tab);
    body.replaceChildren(groups.length
      ? h('div', { class: 'lg' }, groups.map(g => h('div', {}, h('div', { class: 'lgh', text: g.name }),
        g.links.map(l => { const a = h('a', { class: 'lk', href: safeUrl(l.url) }, h('i'), l.name), c = dotColor(l); if (c) a.firstChild.style.setProperty('--c', c); return a; }))))
      : h('div', { class: 'empty' }, S.linksEmpty));
    if (!ctx.editing) ctx.setStatus(it.cfg.tab || '');
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
  return { refresh: draw, enter: () => { const a = body.querySelector('a.lk'); if (!a) return false; a.focus(); } };
};

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
  add(S.cmdRenameWs, '', renameWs);
  add(S.cmdDeleteWs, '', delWs);
  if (focusId) {
    add(S.cmdDeleteTile, 'X', () => removeTile(focusId));
    add(S.cmdDuplicateTile, '', () => duplicateTile(focusId));
    add(S.cmdResetSize, '', () => resetTileSize(focusId));
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
