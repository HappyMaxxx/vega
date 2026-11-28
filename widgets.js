/* VEGA widget helpers: pure logic for the clock styles, world clocks, countdown, currency rates, links layout
   and the ambient sound engine. No DOM. Classic script + Node-compatible, so the tests can run it. */
(function (g) {
'use strict';

const pad = n => String(n).padStart(2, '0');
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const pick = (v, list, d) => list.includes(v) ? v : d;
const int = (v, d, lo, hi) => { const n = Math.round(+v); return Number.isFinite(n) && v !== '' && v !== null ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';

/* ───────────── clock ───────────── */
const CLOCK_STYLES = ['standard', 'large', 'minimal', 'stacked', 'analog', 'binary', 'words'];
const ALIGN_H = ['left', 'center', 'right'], ALIGN_V = ['top', 'middle', 'bottom'];
const DATE_FORMATS = ['long', 'short', 'numeric', 'none'], WEIGHTS = ['light', 'regular', 'bold'];

// Defaults reproduce the look of the clock before it had settings.
function clockCfg(c) {
  c = isObj(c) ? c : {};
  return {
    name: str(c.name, 40),
    style: pick(c.style, CLOCK_STYLES, 'standard'),
    align: pick(c.align, ALIGN_H, 'left'),
    valign: pick(c.valign, ALIGN_V, 'middle'),
    weight: pick(c.weight, WEIGHTS, 'regular'),
    date: pick(c.date, DATE_FORMATS, 'long'),
    hour12: !!c.hour12,
    seconds: c.seconds !== false,
    progress: c.progress !== false,
  };
}

function clockParts(d, hour12) {
  const h = d.getHours();
  return {
    hh: hour12 ? String(((h + 11) % 12) + 1) : pad(h),
    mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    ampm: hour12 ? (h < 12 ? 'AM' : 'PM') : '',
  };
}

const HOUR_WORDS = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven'];
const MIN_WORDS = { 5: 'five past', 10: 'ten past', 15: 'quarter past', 20: 'twenty past', 25: 'twenty-five past', 30: 'half past', 35: 'twenty-five to', 40: 'twenty to', 45: 'quarter to', 50: 'ten to', 55: 'five to' };
// "quarter past nine": rounds to the nearest five minutes.
function timeWords(h, m) {
  let r = Math.round(m / 5) * 5, hh = h;
  if (r === 60) { r = 0; hh = (h + 1) % 24; }
  if (r === 0 && hh === 0) return 'midnight';
  if (r === 0 && hh === 12) return 'noon';
  const word = x => HOUR_WORDS[x % 12];
  if (r === 0) return `${word(hh)} o’clock`;
  return r > 30 ? `${MIN_WORDS[r]} ${word(hh + 1)}` : `${MIN_WORDS[r]} ${word(hh)}`;
}

// Binary-coded decimal: one column of four bits per digit, most significant bit first.
const bcd = digits => digits.map(c => { const n = +c; return [8, 4, 2, 1].map(b => (n & b) ? 1 : 0); });

const analogAngles = d => {
  const s = d.getSeconds(), m = d.getMinutes() + s / 60, h = (d.getHours() % 12) + m / 60;
  return { hour: h * 30, minute: m * 6, second: s * 6 };
};

function dateText(d, fmt, locale) {
  if (fmt === 'none') return '';
  const o = fmt === 'short' ? { weekday: 'short', day: 'numeric', month: 'short' }
    : fmt === 'numeric' ? { day: '2-digit', month: '2-digit', year: 'numeric' }
      : { weekday: 'long', day: 'numeric', month: 'long' };
  return new Intl.DateTimeFormat(locale, o).format(d);
}

/* ───────────── world clocks ───────────── */
const COMMON_ZONES = ['UTC', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Warsaw', 'Europe/Kyiv', 'Europe/Istanbul', 'Asia/Dubai', 'Asia/Kolkata',
  'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland', 'America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Toronto'];

const validZone = tz => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return typeof tz === 'string' && tz.length > 0; } catch { return false; } };
const zoneLabel = tz => String(tz).split('/').pop().replace(/_/g, ' ');

const DEFAULT_ZONES = [{ tz: 'America/New_York', label: '' }, { tz: 'Europe/London', label: '' }, { tz: 'Asia/Tokyo', label: '' }];

function worldCfg(c) {
  c = isObj(c) ? c : {};
  const src = Array.isArray(c.zones) ? c.zones : DEFAULT_ZONES;
  const zones = [];
  for (const z of src) {
    if (!isObj(z) || !validZone(z.tz) || zones.length >= 8) continue;
    zones.push({ tz: z.tz, label: str(z.label, 24) });
  }
  return { name: str(c.name, 40), zones, hour12: !!c.hour12, seconds: !!c.seconds, offsets: c.offsets !== false, local: c.local !== false };
}

const wallParts = (tz, date) => {
  const o = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(date))
    if (p.type !== 'literal') o[p.type] = +p.value;
  return o;
};
const wallMs = p => Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);

// Time in `tz` at `date`, how far it is from this computer's time, and whether it is another calendar day.
function zoneNow(tz, date) {
  const w = wallParts(tz, date), utcSec = Math.floor(date.getTime() / 1000) * 1000;
  const off = Math.round((wallMs(w) - utcSec) / 60000), localOff = -date.getTimezoneOffset();
  const L = { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: 0, minute: 0, second: 0 };
  const dayDiff = Math.round((Date.UTC(w.year, w.month - 1, w.day) - wallMs(L)) / 864e5);
  return { hour: w.hour % 24, minute: w.minute, second: w.second, offsetMin: off, diffMin: off - localOff, dayDiff };
}

function diffText(min) {
  if (!min) return 'same time';
  const a = Math.abs(min), h = Math.floor(a / 60), m = a % 60;
  return (min < 0 ? '−' : '+') + (h ? h + 'h' : '') + (h && m ? ' ' : '') + (m ? m + 'm' : '');
}

/* ───────────── countdown ───────────── */
function parseLocal(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return null;
  const t = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  const hh = t ? +t[1] : 0, mi = t ? +t[2] : 0;
  const d = new Date(+m[1], +m[2] - 1, +m[3], hh, mi, 0, 0);
  if (d.getFullYear() !== +m[1] || d.getMonth() !== +m[2] - 1 || d.getDate() !== +m[3] || hh > 23 || mi > 59) return null;
  return d;
}

function countdownCfg(c) {
  c = isObj(c) ? c : {};
  const used = new Set();
  const events = (Array.isArray(c.events) ? c.events : []).filter(isObj).slice(0, 12).map(e => {
    let id = typeof e.id === 'string' && e.id ? e.id : Math.random().toString(36).slice(2, 8);
    if (used.has(id)) id = Math.random().toString(36).slice(2, 8);
    used.add(id);
    return { id, name: str(e.name, 40), date: str(e.date, 10), time: /^\d{1,2}:\d{2}$/.test(e.time || '') ? e.time : '', yearly: !!e.yearly };
  }).filter(e => parseLocal(e.date, e.time));
  return { name: str(c.name, 40), events, detail: pick(c.detail, ['days', 'full'], 'days'), hidePast: !!c.hidePast, order: pick(c.order, ['soonest', 'manual'], 'soonest') };
}

const dayStart = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const calDays = (a, b) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);

// Where an event stands right now. Yearly events roll to their next occurrence; all-day events count calendar days.
function countdown(ev, now) {
  let t = parseLocal(ev.date, ev.time);
  if (!t) return null;
  const timed = !!ev.time;
  if (ev.yearly) {
    const base = parseLocal(ev.date, ev.time), keep = d => timed ? d.getTime() >= now.getTime() : calDays(now, d) >= 0;
    t = new Date(now.getFullYear(), base.getMonth(), base.getDate(), base.getHours(), base.getMinutes(), 0, 0);
    if (!keep(t)) t = new Date(now.getFullYear() + 1, base.getMonth(), base.getDate(), base.getHours(), base.getMinutes(), 0, 0);
  }
  const ms = t.getTime() - now.getTime(), days = calDays(now, t);
  const today = !timed && days === 0;
  const past = timed ? ms < 0 : days < 0;
  const a = Math.abs(ms), tot = Math.floor(a / 1000);
  return { target: t, ms, past, today, days, absDays: Math.abs(days), d: Math.floor(tot / 86400), h: Math.floor(tot % 86400 / 3600), m: Math.floor(tot % 3600 / 60), s: tot % 60, timed };
}

function sortEvents(events, now, order) {
  const list = events.map(e => ({ e, c: countdown(e, now) })).filter(x => x.c);
  if (order === 'manual') return list;
  const key = x => (x.c.past ? 1e15 : 0) + Math.abs(x.c.ms);
  return list.sort((a, b) => key(a) - key(b));
}

/* ───────────── currency rates (National Bank of Ukraine open data) ───────────── */
const NBU = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json';
const nbuDate = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const CODE = /^[A-Z]{3}$/;

// -> { date: 'YYYY-MM-DD', rates: { USD: 41.2, ... } } in hryvnia per one unit; UAH itself is always 1.
function parseNbu(json) {
  if (!Array.isArray(json)) return null;
  const rates = { UAH: 1 };
  let date = '';
  for (const r of json) {
    if (!isObj(r) || !CODE.test(r.cc) || !(+r.rate > 0)) continue;
    rates[r.cc] = +r.rate;
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(r.exchangedate || '');
    if (m && !date) date = `${m[3]}-${m[2]}-${m[1]}`;
  }
  return Object.keys(rates).length > 1 ? { date, rates } : null;
}

// Monobank: a public list of buy/sell prices against the hryvnia, keyed by ISO numeric currency codes.
const MONO = 'https://api.monobank.ua/bank/currency';
const ISO_NUM = { 840: 'USD', 978: 'EUR', 826: 'GBP', 985: 'PLN', 756: 'CHF', 392: 'JPY', 203: 'CZK', 36: 'AUD', 124: 'CAD', 156: 'CNY', 949: 'TRY', 348: 'HUF', 752: 'SEK', 578: 'NOK', 208: 'DKK', 981: 'GEL', 498: 'MDL', 944: 'AZN', 51: 'AMD', 398: 'KZT', 784: 'AED', 376: 'ILS', 356: 'INR', 702: 'SGD', 410: 'KRW', 986: 'BRL', 946: 'RON', 975: 'BGN' };
// -> { USD: { buy, sell } | { cross } } for pairs against UAH (980). "buy" is the price the bank pays you, "sell" the price you pay.
function parseMono(json) {
  if (!Array.isArray(json)) return null;
  const rows = {};
  for (const r of json) {
    if (!isObj(r) || r.currencyCodeB !== 980 || !ISO_NUM[r.currencyCodeA]) continue;
    const code = ISO_NUM[r.currencyCodeA];
    if (+r.rateBuy > 0 && +r.rateSell > 0) rows[code] = { buy: +r.rateBuy, sell: +r.rateSell };
    else if (+r.rateCross > 0) rows[code] = { cross: +r.rateCross };
  }
  return Object.keys(rows).length ? rows : null;
}

// Binance public market data (no key): the best bid is what you get when you sell, the best ask is what you pay.
const BINANCE = 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=';
const COIN = /^[A-Z0-9]{2,10}$/, QUOTES = ['USDT', 'EUR', 'UAH'];
function parseTicker(j) {
  if (!isObj(j) || !(+j.lastPrice > 0)) return null;
  return { last: +j.lastPrice, bid: +j.bidPrice > 0 ? +j.bidPrice : null, ask: +j.askPrice > 0 ? +j.askPrice : null, change: Number.isFinite(+j.priceChangePercent) ? +j.priceChangePercent : null };
}

const convert = (rates, amount, from, to) => rates && rates[from] && rates[to] ? amount * rates[from] / rates[to] : null;

function ratesCfg(c) {
  c = isObj(c) ? c : {};
  const codes = [];
  for (const x of Array.isArray(c.codes) ? c.codes : ['USD', 'EUR']) {
    const up = String(x).trim().toUpperCase();
    if (CODE.test(up) && !codes.includes(up) && codes.length < 8) codes.push(up);
  }
  const base = CODE.test(String(c.base || '').toUpperCase()) ? String(c.base).toUpperCase() : 'UAH';
  const amount = Number.isFinite(+c.amount) && +c.amount > 0 && +c.amount <= 1e9 ? +c.amount : 1;
  const coins = [];
  for (const x of Array.isArray(c.coins) ? c.coins : ['BTC', 'ETH']) {
    const up = String(x).trim().toUpperCase();
    if (COIN.test(up) && !coins.includes(up) && coins.length < 8) coins.push(up);
  }
  return { name: str(c.name, 40), source: pick(c.source, ['nbu', 'mono', 'crypto'], 'nbu'), base, codes, coins, quote: pick(c.quote, QUOTES, 'USDT'), amount, decimals: int(c.decimals, 2, 0, 6), change: c.change !== false };
}

/* ───────────── links layout ───────────── */
const LINK_LAYOUTS = ['columns', 'list', 'chips'], LINK_ICONS = ['dot', 'letter', 'none'], LINK_SIZES = ['small', 'normal', 'large'];
const LINK_COLORS = ['', 'accent', 'green', 'aqua', 'blue', 'purple', 'yellow', 'hot', 'red'];

function linksCfg(c) {
  c = isObj(c) ? c : {};
  return {
    ...c,
    name: str(c.name, 40),
    tab: typeof c.tab === 'string' && c.tab ? c.tab : undefined,
    groups: Array.isArray(c.groups) && c.groups.length ? c.groups.filter(x => typeof x === 'string') : undefined,
    layout: pick(c.layout, LINK_LAYOUTS, 'columns'),
    cols: int(c.cols, 0, 0, 4),
    align: pick(c.align, ALIGN_H, 'left'),
    icons: pick(c.icons, LINK_ICONS, 'dot'),
    size: pick(c.size, LINK_SIZES, 'normal'),
    color: pick(c.color, LINK_COLORS, ''),
    headers: c.headers !== false,
    newTab: !!c.newTab,
  };
}

/* ───────────── ambient sounds: real recordings streamed on demand, plus synthesised noise ───────────── */
// Public-domain / CC0 recordings hosted on archive.org (credits in docs/WIDGETS.md). Nothing is requested until you press Play
// with that sound above zero. Browsers load <audio> from any https host, so no extension permission is involved.
const IA = 'https://archive.org/download/';
const STREAMS = {
  rain:    { url: IA + 'naturesounds-soundtheraphy/Light%20Gentle%20Rain.ogg' },
  thunder: { url: IA + 'thunderstorm_ms_relax_water/thunderstorm.ogg' },
  wind:    { url: IA + 'soundica-fs-447408-tedellis-binaural-wind-sounds-birds-woods-mp3/447408.mp3' },
  ocean:   { url: IA + 'ocean-sea-sounds/Gentle%20Ocean.ogg' },
  stream:  { url: IA + 'naturesounds-soundtheraphy/Relaxing%20Nature%20Sounds%20-%20Trickling%20Stream%20Sounds%20%26%20Birds.ogg' },
  forest:  { url: IA + 'naturesounds-soundtheraphy/Relaxing%20Nature%20Sounds%20-%20Birdsong%20Sound.ogg' },
  fire:    { url: IA + 'FireFavorite/Fire%20Favorite.ogg' },
};
const SYNTH = ['white', 'pink', 'brown'];
const SOUNDS = [...Object.keys(STREAMS), ...SYNTH];
const SLEEP_OPTIONS = [0, 15, 30, 45, 60, 90];
const CUSTOM_MAX = 6;

function ambientCfg(c) {
  c = isObj(c) ? c : {};
  const custom = [], used = new Set();
  for (const x of Array.isArray(c.custom) ? c.custom : []) {
    if (!isObj(x) || custom.length >= CUSTOM_MAX) continue;
    const url = str(x.url, 500), name = str(x.name, 24);
    if (!/^https:\/\/[^\s/]+\S*$/i.test(url) || !name) continue;
    let id = /^c[a-z0-9]{3,8}$/.test(x.id || '') ? x.id : 'c' + Math.random().toString(36).slice(2, 7);
    if (used.has(id)) id = 'c' + Math.random().toString(36).slice(2, 7);
    used.add(id); custom.push({ id, name, url });
  }
  const known = [...SOUNDS, ...custom.map(x => x.id)];
  const sounds = [], src = Array.isArray(c.sounds) ? c.sounds : ['rain', 'thunder', 'wind', 'ocean', 'fire', 'brown'];
  for (const s of src) if (known.includes(s) && !sounds.includes(s)) sounds.push(s);
  const lv = isObj(c.levels) ? c.levels : { rain: 0.6 };
  const levels = {};
  for (const s of known) { const v = +lv[s]; levels[s] = Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : 0; }
  const m = +c.master;
  return { name: str(c.name, 40), sounds, custom, levels, master: Number.isFinite(m) && c.master !== '' && c.master !== null ? Math.min(1, Math.max(0, m)) : 0.8, sleepMin: SLEEP_OPTIONS.includes(+c.sleepMin) ? +c.sleepMin : 0, withTimer: !!c.withTimer };
}

function noiseData(kind, n) {
  const a = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') a[i] = w;
    else if (kind === 'pink') {                      // Paul Kellet's refined filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; a[i] = last * 3.5; }   // brown
  }
  return a;
}

// One engine per tile. Nothing is created or requested until play(): browsers only allow audio after a click or key press.
// `Ctor` is the AudioContext class (for the noises), `makeAudio()` returns an <audio>-like element (for the streams).
function createAmbient(Ctor, makeAudio) {
  let ctx = null, master = null, playing = false, level = 0.8;
  const levels = {}, customUrls = {}, noise = {}, streams = {}, failed = new Set();
  const NOISE_GAIN = { white: 0.35, pink: 0.6, brown: 0.9 };
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const urlOf = id => customUrls[id] || (STREAMS[id] && STREAMS[id].url) || '';
  const isNoise = id => SYNTH.includes(id);

  function buildNoise() {
    if (ctx || !Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain(); master.gain.value = level; master.connect(ctx.destination);
    for (const id of SYNTH) {
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 6) || 1, ctx.sampleRate || 44100);
      buf.getChannelData(0).set(noiseData(id, buf.length));
      const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const out = ctx.createGain(); out.gain.value = (levels[id] || 0) * NOISE_GAIN[id];
      src.connect(out); out.connect(master); src.start();
      noise[id] = { src, out };
    }
  }
  function syncStream(id) {
    const lv = levels[id] || 0, url = urlOf(id);
    let s = streams[id];
    if (!url) return;
    if (!playing || lv <= 0) { if (s) s.el.pause(); return; }
    if (!s || s.url !== url) {
      if (s) { s.el.pause(); }
      const el = makeAudio();
      el.loop = true; el.preload = 'none';
      el.addEventListener('error', () => { failed.add(id); if (api.onChange) api.onChange(id); });
      el.addEventListener('playing', () => { if (failed.delete(id) && api.onChange) api.onChange(id); });
      el.src = url;
      s = streams[id] = { el, url };
    }
    s.el.volume = clamp01(lv * level);
    if (s.el.paused) { failed.delete(id); const p = s.el.play(); if (p && p.catch) p.catch(() => { failed.add(id); if (api.onChange) api.onChange(id); }); }
  }
  const syncAll = () => { for (const id of Object.keys(levels)) if (!isNoise(id)) syncStream(id); };

  const api = {
    onChange: null,
    get playing() { return playing; },
    failed: id => failed.has(id),
    setSources(list) { for (const k of Object.keys(customUrls)) delete customUrls[k]; for (const x of list) customUrls[x.id] = x.url; },
    setLevels(map) { for (const id of Object.keys(map)) api.setLevel(id, map[id]); },
    setLevel(id, v) {
      levels[id] = +v || 0;
      if (isNoise(id)) { if (noise[id]) noise[id].out.gain.value = levels[id] * NOISE_GAIN[id]; } else if (playing) syncStream(id);
    },
    setMaster(v) { level = +v || 0; if (master) master.gain.value = level; for (const [id, s] of Object.entries(streams)) s.el.volume = clamp01((levels[id] || 0) * level); },
    async play() {
      playing = true;
      buildNoise();
      syncAll();
      if (ctx && ctx.resume) await ctx.resume();
    },
    async pause() { playing = false; for (const s of Object.values(streams)) s.el.pause(); if (ctx && ctx.suspend) await ctx.suspend(); },
    destroy() {
      playing = false;
      for (const s of Object.values(streams)) { s.el.pause(); s.el.removeAttribute('src'); if (s.el.load) s.el.load(); }
      for (const k of Object.keys(streams)) delete streams[k];
      for (const n of Object.values(noise)) { try { n.src.stop(); } catch { /* not started */ } }
      for (const k of Object.keys(noise)) delete noise[k];
      if (ctx && ctx.close) { try { ctx.close(); } catch { /* already closed */ } }
      ctx = null; master = null;
    },
  };
  return api;
}

/* ───────────── air-raid alerts (Ukraine): alerts.in.ua status per oblast, a schematic map, and an estimate
   derived only from how the alert area has been spreading (no live target feed is publicly available; see
   docs/WIDGETS.md). Everything here is pure: the fetch, the SVG and the polling live in app.js. ───────────── */
// Order fixed by the alerts.in.ua API (the 27-character status string): index == position in that string.
// Coordinates are each oblast's approximate centre, used only for distance and direction, not as a legal boundary.
const OBLASTS = [
  { id: 'crimea', name: 'Crimea', lat: 45.3, lon: 34.4 },
  { id: 'volyn', name: 'Volyn', lat: 50.75, lon: 25.3 },
  { id: 'vinnytsia', name: 'Vinn\u0079tsia', lat: 49.2, lon: 28.5 },
  { id: 'dnipropetrovsk', name: 'Dnipropetrovsk', lat: 48.45, lon: 35.0 },
  { id: 'donetsk', name: 'Donetsk', lat: 48.0, lon: 37.8 },
  { id: 'zhytomyr', name: 'Zhytomyr', lat: 50.6, lon: 28.7 },
  { id: 'zakarpattia', name: 'Zakarpattia', lat: 48.4, lon: 23.2 },
  { id: 'zaporizhzhia', name: 'Zaporizhzhia', lat: 47.3, lon: 35.8 },
  { id: 'ivano-frankivsk', name: 'Ivano-Frankivsk', lat: 48.7, lon: 24.7 },
  { id: 'kyiv-city', name: 'Kyiv (city)', lat: 50.45, lon: 30.52 },
  { id: 'kyiv-oblast', name: 'Kyiv Oblast', lat: 50.6, lon: 30.3 },
  { id: 'kirovohrad', name: 'Kirovohrad', lat: 48.5, lon: 32.3 },
  { id: 'luhansk', name: 'Luhansk', lat: 48.9, lon: 39.3 },
  { id: 'lviv', name: 'Lviv', lat: 49.9, lon: 24.2 },
  { id: 'mykolaiv', name: 'Mykolaiv', lat: 47.1, lon: 31.6 },
  { id: 'odesa', name: 'Odesa', lat: 46.6, lon: 30.2 },
  { id: 'poltava', name: 'Poltava', lat: 49.6, lon: 34.5 },
  { id: 'rivne', name: 'Rivne', lat: 50.8, lon: 26.4 },
  { id: 'sevastopol', name: 'Sevastopol', lat: 44.6, lon: 33.5 },
  { id: 'sumy', name: 'Sumy', lat: 50.9, lon: 34.8 },
  { id: 'ternopil', name: 'Ternopil', lat: 49.5, lon: 25.6 },
  { id: 'kharkiv', name: 'Kharkiv', lat: 49.9, lon: 36.3 },
  { id: 'kherson', name: 'Kherson', lat: 46.6, lon: 33.0 },
  { id: 'khmelnytskyi', name: 'Khmelnytskyi', lat: 49.4, lon: 26.9 },
  { id: 'cherkasy', name: 'Cherkasy', lat: 49.3, lon: 31.9 },
  { id: 'chernivtsi', name: 'Chernivtsi', lat: 48.3, lon: 25.9 },
  { id: 'chernihiv', name: 'Chernihiv', lat: 51.5, lon: 31.3 },
];
const OBLAST_BY_ID = Object.fromEntries(OBLASTS.map((o, i) => [o.id, i]));
const CODE_LEVEL = { R: 'red', Y: 'yellow', P: 'partial', N: null };          // v2 active_air_raid_alerts_by_oblast.json
const ALERTS_ENDPOINT = 'https://api.alerts.in.ua/v2/iot/active_air_raid_alerts_by_oblast.json';
// Two interchangeable status sources, per tile: the official API (a personal token, oblast *and* partial status),
// or kudyletyt.com's own mirror of it (no token, but only whole-oblast alerts are detected — see docs/WIDGETS.md).
const ALERTS_SOURCES = ['alertsinua', 'kudyletyt'];
const KUDYLETYT_ALERTS_ENDPOINT = 'https://api.kudyletyt.com/alerts';
const ALERTS_PINNED_MAX = 6, ALERTS_PLACES_MAX = 8, ALERTS_FRESH_MIN = 90;    // an event older than this no longer drives an estimate
const THREAT_TYPES = ['drone', 'cruise', 'ballistic'];
// Typical published speeds (km/h), editable per tile. Rough and public: not a substitute for an official source.
const THREAT_SPEEDS = { drone: 170, cruise: 880, ballistic: 4800 };

// The 27-char string from the API -> one row per oblast, in the fixed order above.
function parseOblastString(str) {
  if (typeof str !== 'string' || str.length !== OBLASTS.length) return null;
  return OBLASTS.map((o, i) => {
    const code = str[i], level = CODE_LEVEL[code];
    return { ...o, idx: i, code, level, active: code !== 'N' && code !== undefined };
  });
}

function haversineKm(a, b) {
  const R = 6371, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
const minutesRemaining = (distanceKm, speedKmh, elapsedMin) => distanceKm / speedKmh * 60 - elapsedMin;
const nearestPinnedKm = (idx, pinnedIdx) => pinnedIdx.length ? Math.min(...pinnedIdx.map(p => haversineKm(OBLASTS[idx], OBLASTS[p]))) : null;

// A rough, honestly-banded estimate (±30%) for how soon a spreading alert might reach `targetIdx`, from the most
// recent still-fresh activation of another oblast. Returns null when there is nothing fresh enough to go on, or
// when the model already expects the alert to have arrived (an overdue guess is worse than no guess).
function estimateFromEvents(events, targetIdx, speedKmh, now) {
  const fresh = events.filter(e => e.idx !== targetIdx && (now - e.at) / 60000 <= ALERTS_FRESH_MIN).sort((a, b) => b.at - a.at);
  if (!fresh.length) return null;
  const e = fresh[0], elapsed = (now - e.at) / 60000, remaining = minutesRemaining(haversineKm(OBLASTS[e.idx], OBLASTS[targetIdx]), speedKmh, elapsed);
  if (remaining <= 0) return null;
  return { minLeft: Math.max(1, Math.round(remaining * 0.7)), maxLeft: Math.round(remaining * 1.3), fromIdx: e.idx };
}
// Same shape, from a threat point and time you set by hand (e.g. from a channel you follow) instead of the alert feed.
function estimateFromManual(manual, targetIdx, speedKmh, now) {
  if (!manual || !(manual.idx >= 0)) return null;
  const elapsed = (now - manual.setAt) / 60000, remaining = minutesRemaining(haversineKm(OBLASTS[manual.idx], OBLASTS[targetIdx]), speedKmh, elapsed);
  if (remaining <= 0) return null;
  return { minLeft: Math.max(1, Math.round(remaining * 0.7)), maxLeft: Math.round(remaining * 1.3), fromIdx: manual.idx };
}
// 'comfortable' (plenty of margin), 'tight' (cutting it close), 'wait' (would not make it), 'unknown' (no estimate yet).
const tripCompare = (remainingMin, tripMin, margin = 10) => remainingMin == null ? 'unknown' : tripMin + margin <= remainingMin ? 'comfortable' : tripMin <= remainingMin ? 'tight' : 'wait';

// Equirectangular projection (longitude scaled by latitude, so the shape is not stretched) into a fixed, testable
// coordinate space. The map in app.js just reads x/y; nothing here touches the DOM.
const ALERTS_SPACE = { w: 640, h: 440, pad: 24 };
// The same fixed transform backs projectOblasts() and project(): a point keeps the same x/y either way.
const ALERTS_XFORM = (() => {
  const lat0 = 48.4 * Math.PI / 180, cos = Math.cos(lat0);
  const xs = OBLASTS.map(o => o.lon * cos), ys = OBLASTS.map(o => -o.lat);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const { w, h, pad } = ALERTS_SPACE, sx = (w - 2 * pad) / (x1 - x0), sy = (h - 2 * pad) / (y1 - y0), s = Math.min(sx, sy);
  const ox = pad + (w - 2 * pad - (x1 - x0) * s) / 2, oy = pad + (h - 2 * pad - (y1 - y0) * s) / 2;
  return { cos, x0, y0, s, ox, oy };
})();
function projectPoint(lat, lon) {
  const t = ALERTS_XFORM;
  return { x: t.ox + (lon * t.cos - t.x0) * t.s, y: t.oy + (-lat - t.y0) * t.s };
}
function projectOblasts() {
  return OBLASTS.map((o, i) => ({ ...o, idx: i, ...projectPoint(o.lat, o.lon) }));
}
// Compass bearing (0-360, 0 = north) from a to b, and the signed angular gap between two bearings (-180..180).
function bearingDeg(a, b) {
  const rad = d => d * Math.PI / 180, lat1 = rad(a.lat), lat2 = rad(b.lat), dLon = rad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2), x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const bearingGap = (a, b) => { const d = ((b - a + 540) % 360) - 180; return d; };

// ───── live tracks (optional, off by default): an independent, unofficial OSINT project, not alerts.in.ua ─────
// kudyletyt.com (Telegram channel t.me/kudy_letyt), built from public Telegram monitoring channels. Its API
// has no authentication and answers with Access-Control-Allow-Origin: *, but publishes no formal terms of use —
// treat it as a best-effort community source, shown only when you turn it on, and attributed in the widget. See
// docs/WIDGETS.md for the full note.
const TRACKS_ENDPOINT = 'https://api.kudyletyt.com/tracks';
const TRACK_TYPES = ['drone', 'jet', 'molnia'];
// Rough, published, editable speeds (km/h) per track type. "jet" = jet-engine ("reactive") Shahed-type drones,
// faster than propeller ones; "molnia" = a small fast attack drone. All approximate.
const TRACK_SPEEDS = { drone: 170, jet: 550, molnia: 250 };
const TRACK_CONE_DEG = 45;                           // how far off a track's heading may be from "straight at you" and still count

// The feed's points are [lon, lat] (GeoJSON order). One row per track, using its most recent observed position.
function parseTracks(json) {
  if (!isObj(json) || !Array.isArray(json.tracks)) return null;
  const rows = [];
  for (const t of json.tracks) {
    if (!isObj(t) || !Array.isArray(t.pts) || !t.pts.length) continue;
    const last = t.pts[t.pts.length - 1];
    if (!isObj(last) || !Array.isArray(last.pt) || last.pt.length !== 2) continue;
    const [lon, lat] = last.pt;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows.push({
      id: str(t.id, 20) || 'track', type: TRACK_TYPES.includes(t.type) ? t.type : 'drone',
      active: t.status === 'active', heading: Number.isFinite(+t.heading) ? ((+t.heading % 360) + 360) % 360 : null,
      lat, lon, lastSeen: Number.isFinite(+t.lastSeen) ? +t.lastSeen : (Number.isFinite(+last.t) ? +last.t : 0),
      toward: isObj(t.toward) && typeof t.toward.name === 'string' ? t.toward.name : '',
    });
  }
  return { ts: Date.now(), tracks: rows };
}

// Does `track`, extrapolated from its last seen position at `speedKmh` along its own heading, look like it could
// reach oblast `targetIdx`? Only counts a track whose heading points within TRACK_CONE_DEG of the straight line to
// the target — one actually crossing Ukraine on an unrelated path should not drive an estimate for you.
function estimateFromTrack(track, targetIdx, speedKmh, now) {
  if (!track.active || track.heading == null) return null;
  const target = OBLASTS[targetIdx], toward = bearingDeg(track, target);
  if (Math.abs(bearingGap(track.heading, toward)) > TRACK_CONE_DEG) return null;
  const elapsed = (now - track.lastSeen) / 60000;
  if (elapsed < 0 || elapsed > ALERTS_FRESH_MIN) return null;
  const remaining = minutesRemaining(haversineKm(track, target), speedKmh, elapsed);
  if (remaining <= 0) return null;
  return { minLeft: Math.max(1, Math.round(remaining * .7)), maxLeft: Math.round(remaining * 1.3), trackId: track.id, trackType: track.type };
}

function alertsCfg(c) {
  c = isObj(c) ? c : {};
  const pinned = [...new Set((Array.isArray(c.pinned) ? c.pinned : []).filter(id => id in OBLAST_BY_ID))].slice(0, ALERTS_PINNED_MAX);
  const speeds = isObj(c.speeds) ? c.speeds : {};
  const sp = {}; for (const t of THREAT_TYPES) { const v = +speeds[t]; sp[t] = Number.isFinite(v) && v > 0 && v <= 30000 ? v : THREAT_SPEEDS[t]; }
  const tspeeds = isObj(c.trackSpeeds) ? c.trackSpeeds : {};
  const tsp = {}; for (const t of TRACK_TYPES) { const v = +tspeeds[t]; tsp[t] = Number.isFinite(v) && v > 0 && v <= 30000 ? v : TRACK_SPEEDS[t]; }
  const used = new Set(), places = [];
  for (const p of Array.isArray(c.places) ? c.places : []) {
    if (!isObj(p) || places.length >= ALERTS_PLACES_MAX) continue;
    const name = str(p.name, 30), minutes = int(p.minutes, NaN, 1, 600);
    if (!name || !Number.isFinite(minutes)) continue;
    let id = /^p[a-z0-9]{3,8}$/.test(p.id || '') ? p.id : 'p' + Math.random().toString(36).slice(2, 7);
    if (used.has(id)) id = 'p' + Math.random().toString(36).slice(2, 7);
    used.add(id); places.push({ id, name, minutes });
  }
  const manualFrom = typeof c.manualFrom === 'string' && c.manualFrom in OBLAST_BY_ID ? c.manualFrom : '';
  const manualSetAt = manualFrom !== '' && Number.isFinite(+c.manualSetAt) && +c.manualSetAt > 0 ? +c.manualSetAt : undefined;
  return {
    name: str(c.name, 40), source: pick(c.source, ALERTS_SOURCES, 'alertsinua'), token: str(c.token, 200),
    pinned,
    focus: c.focus !== false, threat: pick(c.threat, THREAT_TYPES, 'drone'), speeds: sp,
    useTracks: !!c.useTracks, trackSpeeds: tsp,
    manualFrom, manualSetAt, places, notify: !!c.notify, sound: !!c.sound,
  };
}

const out = {
  CLOCK_STYLES, ALIGN_H, ALIGN_V, DATE_FORMATS, WEIGHTS, clockCfg, clockParts, timeWords, bcd, analogAngles, dateText,
  COMMON_ZONES, validZone, zoneLabel, worldCfg, zoneNow, diffText, DEFAULT_ZONES,
  parseLocal, countdownCfg, countdown, sortEvents,
  NBU, nbuDate, parseNbu, convert, ratesCfg, MONO, ISO_NUM, parseMono, BINANCE, QUOTES, parseTicker,
  LINK_LAYOUTS, LINK_ICONS, LINK_SIZES, LINK_COLORS, linksCfg,
  SOUNDS, STREAMS, SYNTH, CUSTOM_MAX, SLEEP_OPTIONS, ambientCfg, createAmbient, noiseData,
  OBLASTS, OBLAST_BY_ID, CODE_LEVEL, ALERTS_ENDPOINT, ALERTS_SOURCES, KUDYLETYT_ALERTS_ENDPOINT, ALERTS_PINNED_MAX, ALERTS_PLACES_MAX, ALERTS_FRESH_MIN, THREAT_TYPES, THREAT_SPEEDS,
  parseOblastString, haversineKm, minutesRemaining, nearestPinnedKm, estimateFromEvents, estimateFromManual, tripCompare,
  ALERTS_SPACE, projectOblasts, projectPoint, bearingDeg, bearingGap, alertsCfg,
  TRACKS_ENDPOINT, TRACK_TYPES, TRACK_SPEEDS, TRACK_CONE_DEG, parseTracks, estimateFromTrack,
};
(g.VEGA = g.VEGA || {}).w = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
