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

const out = {
  CLOCK_STYLES, ALIGN_H, ALIGN_V, DATE_FORMATS, WEIGHTS, clockCfg, clockParts, timeWords, bcd, analogAngles, dateText,
  COMMON_ZONES, validZone, zoneLabel, worldCfg, zoneNow, diffText, DEFAULT_ZONES,
  parseLocal, countdownCfg, countdown, sortEvents,
  NBU, nbuDate, parseNbu, convert, ratesCfg, MONO, ISO_NUM, parseMono, BINANCE, QUOTES, parseTicker,
  LINK_LAYOUTS, LINK_ICONS, LINK_SIZES, LINK_COLORS, linksCfg,
  SOUNDS, STREAMS, SYNTH, CUSTOM_MAX, SLEEP_OPTIONS, ambientCfg, createAmbient, noiseData,
};
(g.VEGA = g.VEGA || {}).w = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
