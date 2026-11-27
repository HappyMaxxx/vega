/* VEGA state: defaults, normalize(), load with safety backup. Classic script + Node-compatible. */
(function (g) {
'use strict';
const grid = (typeof require === 'function' && typeof module !== 'undefined') ? require('./grid.js') : g.VEGA.grid;
const { COLS, clamp } = grid;

const KEY = 'hud.v1', BACKUP = 'hud.v1.backup', BAD = 'hud.v1.backup.bad';
const REV = 2;                       // additive data revision; `v` stays 1 so older builds still read the data
const uid = () => Math.random().toString(36).slice(2, 9);

const G = (tab, name, links) => ({ id: uid(), tab, name, links: links.map(([n, u, c]) => ({ name: n, url: u, color: c })) });
const T = (type, x, y, w, h, cfg) => ({ id: uid(), type, x, y, w, h, cfg: cfg || {} });

function defaults() {
  return {
    v: 1, rev: REV,
    active: 0,
    ws: [
      { id: uid(), name: 'work', items: [
        T('clock', 0, 0, 3, 2), T('weather', 3, 0, 3, 2), T('timer', 6, 0, 3, 2), T('tasks', 9, 0, 3, 5),
        T('links', 0, 2, 5, 3, { tab: 'dev' }), T('links', 5, 2, 4, 3, { tab: 'other' }),
        T('links', 0, 5, 5, 3, { tab: 'myself' }), T('notes', 5, 5, 7, 3),
      ] },
      { id: uid(), name: 'chill', items: [
        T('links', 0, 0, 8, 5, { tab: 'chill' }), T('clock', 8, 0, 4, 2), T('weather', 8, 2, 4, 3),
      ] },
      { id: uid(), name: 'focus', items: [T('timer', 1, 1, 5, 5), T('tasks', 6, 1, 5, 5)] },
    ],
    // Neutral starter links. Colours are left out on purpose: dots follow the theme (settings.linkTheme).
    groups: [
      G('dev', 'code', [['GitHub', 'https://github.com/'], ['GitLab', 'https://gitlab.com/'], ['Stack Overflow', 'https://stackoverflow.com/']]),
      G('dev', 'docs', [['MDN', 'https://developer.mozilla.org/'], ['DevDocs', 'https://devdocs.io/'], ['W3Schools', 'https://www.w3schools.com/']]),
      G('dev', 'learn', [['freeCodeCamp', 'https://www.freecodecamp.org/'], ['MIT OpenCourseWare', 'https://ocw.mit.edu/'], ['LeetCode', 'https://leetcode.com/problemset/']]),
      G('other', 'tools', [['Excalidraw', 'https://excalidraw.com/'], ['Squoosh', 'https://squoosh.app/'], ['regex101', 'https://regex101.com/'], ['Can I use', 'https://caniuse.com/']]),
      G('other', 'design', [['Figma', 'https://www.figma.com/'], ['Coolors', 'https://coolors.co/'], ['Canva', 'https://www.canva.com/']]),
      G('myself', 'mail', [['Gmail', 'https://mail.google.com/'], ['Calendar', 'https://calendar.google.com/']]),
      G('myself', 'files', [['Drive', 'https://drive.google.com/'], ['Dropbox', 'https://www.dropbox.com/'], ['Photos', 'https://photos.google.com/']]),
      G('chill', 'social', [['YouTube', 'https://www.youtube.com/'], ['Twitch', 'https://www.twitch.tv/'], ['Reddit', 'https://www.reddit.com/']]),
      G('chill', 'games', [['Chess.com', 'https://www.chess.com/'], ['Monkeytype', 'https://monkeytype.com/'], ['Tetris', 'https://tetris.com/']]),
      G('chill', 'reading', [['Wikipedia', 'https://www.wikipedia.org/'], ['Hacker News', 'https://news.ycombinator.com/']]),
    ],
    tasks: [],
    timer: { mode: 'focus', running: false, remaining: 25 * 60, endsAt: 0 },
    data: {},
    settings: {
      engine: 'g',
      engines: {
        g: ['https://google.com/search?q=', 'Google'],
        d: ['https://duckduckgo.com/?q=', 'DuckDuckGo'],
        y: ['https://youtube.com/results?search_query=', 'YouTube'],
        r: ['https://www.reddit.com/search/?q=', 'Reddit'],
        gh: ['https://github.com/search?q=', 'GitHub'],
        p: ['https://www.pinterest.com/search/pins/?q=', 'Pinterest'],
      },
      place: 'Kyiv', lat: 50.4501, lon: 30.5234,
      focusMin: 25, breakMin: 5, bg: '',
      theme: 'gruvbox',        // theme id, see style.css [data-theme]
      accent: '',              // '' = theme accent, otherwise #rrggbb override
      bgFit: 'cover',          // cover | contain | actual (1 image pixel = 1 screen pixel)
      bgLocal: false,          // true = the wallpaper is a local file kept in IndexedDB (see bgstore.js)
      bgSharpen: false,        // sharpen enlarged still images (SVG filter)
      focusPage: false,        // Firefox: move focus from the address bar to the page on a new tab
      focusForget: false,      // also hide that helper tab from 'recently closed' (optional permission: sessions)
      linkTheme: true,         // true = colour link dots from the theme instead of per-link colours (fresh installs only)
    },
  };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const num = (v, d) => Number.isFinite(+v) && v !== null && v !== '' ? Math.round(+v) : d;

function normItem(i, seen) {
  const w = clamp(num(i.w, 1), 1, COLS);
  let id = typeof i.id === 'string' && i.id ? i.id : uid();
  if (seen.has(id)) id = uid();
  seen.add(id);
  // Unknown `type` values are kept on purpose: future modules and downgrades must never lose data.
  return { ...i, id, type: String(i.type), x: clamp(num(i.x, 0), 0, COLS - w), y: Math.max(0, num(i.y, 0)), w, h: Math.max(1, num(i.h, 1)), cfg: isObj(i.cfg) ? i.cfg : {} };
}

// Merge arbitrary stored data over defaults. Additive: unknown fields survive, nothing is dropped.
function normalize(s) {
  const d = defaults();
  if (!isObj(s) || !Array.isArray(s.ws) || !s.ws.length) return d;
  const st = isObj(s.settings) ? s.settings : {};
  const out = {
    ...d, ...s, v: 1, rev: REV,
    settings: { ...d.settings, ...st, engines: { ...d.settings.engines, ...(isObj(st.engines) ? st.engines : {}) } },
    timer: { ...d.timer, ...(isObj(s.timer) ? s.timer : {}) },
    groups: Array.isArray(s.groups) ? s.groups : d.groups,
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    data: isObj(s.data) ? s.data : {},
  };
  if (typeof out.settings.theme !== 'string' || !out.settings.theme) out.settings.theme = d.settings.theme;
  if (!/^#[0-9a-f]{6}$/i.test(out.settings.accent || '')) out.settings.accent = '';
  if (!['cover', 'contain', 'actual'].includes(out.settings.bgFit)) out.settings.bgFit = 'cover';
  for (const k of ['bgLocal', 'bgSharpen', 'focusPage', 'focusForget']) out.settings[k] = !!out.settings[k];
  // data saved by an older build has no linkTheme: keep the look it had (per-link colours)
  out.settings.linkTheme = 'linkTheme' in st ? !!st.linkTheme : false;
  out.groups.forEach(gr => { if (!gr.id) gr.id = uid(); gr.links = Array.isArray(gr.links) ? gr.links : []; });
  const seen = new Set();
  out.ws = s.ws.filter(isObj).map(w => ({ ...w, id: w.id || uid(), name: typeof w.name === 'string' ? w.name : '', items: (Array.isArray(w.items) ? w.items : []).filter(isObj).map(i => normItem(i, seen)) }));
  if (!out.ws.length) return d;
  out.active = clamp(num(out.active, 0), 0, out.ws.length - 1);
  return out;
}

// Read + normalize from a Storage-like object. Writes a raw backup to `hud.v1.backup` before
// anything is reset or migrated, so a bad build can never destroy the user's data.
function load(storage) {
  let raw = null, parsed = null;
  try { raw = storage.getItem(KEY); } catch { /* blocked */ }
  if (raw) { try { parsed = JSON.parse(raw); } catch { /* corrupt */ } }
  const usable = isObj(parsed) && Array.isArray(parsed.ws) && parsed.ws.length > 0;
  const put = (k, v) => { try { storage.setItem(k, v); } catch { /* full or blocked */ } };
  if (raw) {
    if (usable && (parsed.v !== 1 || parsed.rev !== REV)) put(BACKUP, raw);        // first run after an update
    else if (!usable) { let has = null; try { has = storage.getItem(BACKUP); } catch { /* ignore */ } put(has ? BAD : BACKUP, raw); }
  }
  return normalize(parsed);
}

const out = { KEY, BACKUP, BAD, REV, uid, defaults, normalize, load };
(g.VEGA = g.VEGA || {}).state = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
