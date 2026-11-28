/* VEGA grid engine: pure functions, no DOM. Works as a classic script and under Node (tests). */
(function (g) {
'use strict';

const COLS = 12, ROWS = 8;

// Size limits per module type: [w, h] in grid cells. Titles live in strings.js.
const META = {
  clock:   { def: [3, 2], min: [2, 1], max: [8, 5] },
  weather: { def: [3, 2], min: [2, 1], max: [8, 6] },
  timer:   { def: [3, 3], min: [2, 2], max: [8, 8] },
  tasks:   { def: [3, 5], min: [2, 2], max: [8, 12] },
  notes:   { def: [4, 3], min: [2, 2], max: [12, 12] },
  links:   { def: [5, 3], min: [2, 1], max: [12, 12] },
  outage:  { def: [3, 3], min: [2, 2], max: [12, 8] },
  ambient:   { def: [3, 3], min: [2, 2], max: [8, 8] },
  rates:     { def: [3, 2], min: [2, 1], max: [8, 8] },
  countdown: { def: [3, 2], min: [2, 1], max: [8, 8] },
  worldclock:{ def: [4, 2], min: [2, 1], max: [8, 8] },
  alerts:    { def: [5, 4], min: [3, 3], max: [8, 8] },
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const collides = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function pushDown(sim, mover) {
  const hits = sim.filter(o => o !== mover && collides(mover, o)).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const o of hits) {
    if (collides(mover, o)) { o.y = mover.y + mover.h; pushDown(sim, o); }
  }
}

// Simulate moving/resizing tile `id` by `patch` on a copy of `snap`. Returns the new layout.
function computeLayout(snap, id, patch) {
  const sim = snap.map(i => ({ ...i }));
  const m = sim.find(i => i.id === id);
  const mod = META[m.type];
  Object.assign(m, patch);
  if (mod) {
    m.w = clamp(m.w, mod.min[0], Math.min(mod.max[0], COLS));
    m.h = clamp(m.h, mod.min[1], mod.max[1]);
  }
  m.x = clamp(m.x, 0, COLS - m.w);
  m.y = Math.max(0, m.y);
  pushDown(sim, m);
  return sim;
}

// First free top-left slot (row-major) for a w×h tile among `items`.
function firstFree(items, w, h) {
  for (let y = 0; y < 200; y++) for (let x = 0; x <= COLS - w; x++) {
    const r = { x, y, w, h };
    if (!items.some(o => collides(r, o))) return { x, y };
  }
  return { x: 0, y: items.reduce((m, o) => Math.max(m, o.y + o.h), 0) };
}

// Put `item` into `items` keeping its x/y when that slot is free, otherwise the first free slot.
// Size is clamped to the grid but never changed otherwise. Mutates and returns `item`.
function place(items, item) {
  item.w = clamp(item.w, 1, COLS);
  item.x = clamp(item.x, 0, COLS - item.w);
  item.y = Math.max(0, item.y);
  if (items.some(o => o.id !== item.id && collides(item, o))) Object.assign(item, firstFree(items.filter(o => o.id !== item.id), item.w, item.h));
  return item;
}

// Pull tiles upward until they touch something. Mutates items.
function autopack(items) {
  const placed = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    while (it.y > 0 && !placed.some(p => collides({ ...it, y: it.y - 1 }, p))) it.y--;
    placed.push(it);
  }
  return items;
}

// Nearest tile in direction dir ('l'|'r'|'u'|'d') from `cur`, among `items`.
function neighbour(items, cur, dir) {
  const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  let best = null, bs = Infinity;
  for (const o of items) {
    if (o === cur) continue;
    const dx = o.x + o.w / 2 - cx, dy = o.y + o.h / 2 - cy;
    const main = dir === 'l' ? -dx : dir === 'r' ? dx : dir === 'u' ? -dy : dy;
    const side = (dir === 'l' || dir === 'r') ? Math.abs(dy) : Math.abs(dx);
    if (main <= 0) continue;
    const s = main + side * 2;
    if (s < bs) { bs = s; best = o; }
  }
  return best;
}

const out = { COLS, ROWS, META, clamp, collides, pushDown, computeLayout, firstFree, place, autopack, neighbour };
(g.VEGA = g.VEGA || {}).grid = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
