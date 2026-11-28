/* VEGA outage schedules: pure logic, no DOM. Classic script + Node-compatible (tests).
   A schedule is normalised to days: { date: 'YYYY-MM-DD', status: 'known' | 'waiting' | 'unknown', slots: [{ start, end, type }] }
   where start/end are minutes from local midnight (Europe/Kyiv) and type is 'on' | 'off' | 'maybe'.
   Slots cover the whole day (0..1440) when status is 'known'. */
(function (g) {
'use strict';
const DAY = 1440;
const pad = n => String(n).padStart(2, '0');
const clock = min => `${pad(Math.floor((min % DAY) / 60))}:${pad(min % 60)}`;
const clockEnd = min => (min === DAY ? '24:00' : clock(min));

/* ───────────── time ───────────── */
const KYIV = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function kyivNow(ms) {
  const p = Object.fromEntries(KYIV.formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute, seconds: +p.second };
}
const addDays = (date, n) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ───────────── building days ───────────── */
function merge(slots) {                                     // join neighbours of the same type
  const out = [];
  for (const s of slots) {
    const last = out[out.length - 1];
    if (last && last.type === s.type && last.end === s.start) last.end = s.end; else out.push({ ...s });
  }
  return out;
}

// full-day slots from a list of 'off' intervals [[from, to], ...]
function dayFromOff(date, off, status = 'known') {
  const iv = off.map(([a, b]) => [Math.max(0, a), Math.min(DAY, b)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const slots = []; let at = 0;
  for (const [a, b] of iv) {
    if (a > at) slots.push({ start: at, end: a, type: 'on' });
    const from = Math.max(a, at);
    if (b > from) { slots.push({ start: from, end: b, type: 'off' }); at = b; }
  }
  if (at < DAY) slots.push({ start: at, end: DAY, type: 'on' });
  return { date, status, slots: merge(slots) };
}
const emptyDay = (date, status) => ({ date, status, slots: [] });

/* ───────────── pasted text ("00:00 - 08:00, 14:00 - 18:30") ───────────── */
const RANGE = /(\d{1,2})[:.](\d{2})\s*(?:-|–|—|−|‑|до|по|to|till|until)\s*(\d{1,2})[:.](\d{2})/gi;
const ON_HINT = /🟢|💡|✅|світло\s+(?:є|буде|з['’]явиться)|power\s+on/i;
const OFF_HINT = /🔴|⚫|🪫|❌|відключ|не\s+буде|немає\s+світла|power\s+off|outage/i;
const valid = (h, m) => h < 24 && m < 60 || (h === 24 && m === 0);

// Reads times out of free text. `meaning` is what a time range without any hint stands for: 'off' (outage) or 'on' (power).
// Lines that mention "tomorrow"/"завтра" switch to the next day; "today"/"сьогодні" switches back.
function parseSchedule(text, meaning = 'off') {
  const days = { today: [], tomorrow: [] }; let day = 'today', found = 0;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (/завтра|tomorrow/i.test(line)) day = 'tomorrow'; else if (/сьогодні|today/i.test(line)) day = 'today';
    const type = ON_HINT.test(line) && !OFF_HINT.test(line) ? 'on' : OFF_HINT.test(line) && !ON_HINT.test(line) ? 'off' : meaning;
    for (const m of line.matchAll(RANGE)) {
      const [h1, m1, h2, m2] = [+m[1], +m[2], +m[3], +m[4]];
      if (!valid(h1, m1) || !valid(h2, m2)) continue;
      const a = h1 * 60 + m1, b = h2 * 60 + m2;
      if (a === b) continue;
      const parts = b > a ? [[a, b]] : [[a, DAY], [0, b]];  // 22:00-02:00 wraps around midnight
      for (const p of parts) if (p[1] > p[0]) { days[day].push({ from: p[0], to: p[1], type }); found++; }
    }
  }
  return { days, found };
}

// pasted intervals -> a normalised day. Mixed hints: listed 'off' times are outages and the rest is power. Only 'on' times: the rest is an outage.
function dayFromParsed(date, intervals) {
  if (!intervals.length) return emptyDay(date, 'unknown');
  const offs = intervals.filter(i => i.type === 'off').map(i => [i.from, i.to]);
  const ons = intervals.filter(i => i.type === 'on').map(i => [i.from, i.to]);
  if (offs.length || !ons.length) return dayFromOff(date, offs);
  const inv = []; let at = 0;
  for (const [a, b] of ons.sort((x, y) => x[0] - y[0])) { if (a > at) inv.push([at, a]); at = Math.max(at, b); }
  if (at < DAY) inv.push([at, DAY]);
  return dayFromOff(date, inv);
}

/* ───────────── bezsvitla.com.ua catalog & HTML parser ───────────── */
const BEZSVITLA_BASE = 'https://bezsvitla.com.ua';
const BEZSVITLA_REGIONS = [
  { slug: 'kyiv', name: 'Kyiv city', kind: 'kyiv60', active: true, hasStreets: true },
  { slug: 'kyivska-oblast', name: 'Kyiv Oblast', kind: 'sub', active: true },
  { slug: 'lvivska-oblast', name: 'Lviv Oblast', kind: 'sub', active: true },
  { slug: 'dnipropetrovska-oblast', name: 'Dnipropetrovsk Oblast', kind: 'sub', active: true },
  { slug: 'odeska-oblast', name: 'Odesa Oblast', kind: 'sub', active: true },
  { slug: 'kharkivska-oblast', name: 'Kharkiv Oblast', kind: 'sub', active: true },
  { slug: 'vinnytska-oblast', name: 'Vinn\u0079tsia Oblast', kind: 'sub', active: true },
  { slug: 'volynska-oblast', name: 'Volyn Oblast', kind: 'sub', active: true },
  { slug: 'zhytomyrska-oblast', name: 'Zhytomyr Oblast', kind: 'sub', active: true },
  { slug: 'zakarpatska-oblast', name: 'Zakarpattia Oblast', kind: 'sub', active: true },
  { slug: 'zaporizka-oblast', name: 'Zaporizhzhia Oblast', kind: 'sub', active: true },
  { slug: 'ivano-frankivska-oblast', name: 'Ivano-Frankivsk Oblast', kind: 'sub', active: true },
  { slug: 'kirovohradska-oblast', name: 'Kirovohrad Oblast', kind: 'sub', active: true },
  { slug: 'mykolaivska-oblast', name: 'Mykolaiv Oblast', kind: 'sub', active: true },
  { slug: 'poltavska-oblast', name: 'Poltava Oblast', kind: 'sub', active: true },
  { slug: 'rivnenska-oblast', name: 'Rivne Oblast', kind: 'sub', active: true },
  { slug: 'sumska-oblast', name: 'Sumy Oblast', kind: 'sub', active: true },
  { slug: 'ternopilska-oblast', name: 'Ternopil Oblast', kind: 'sub', active: true },
  { slug: 'khmelnytska-oblast', name: 'Khmelnytskyi Oblast', kind: 'sub', active: true },
  { slug: 'cherkaska-oblast', name: 'Cherkasy Oblast', kind: 'sub', active: true },
  { slug: 'chernivetska-oblast', name: 'Chernivtsi Oblast', kind: 'int12', active: true },
  { slug: 'chernihivska-oblast', name: 'Chernihiv Oblast', kind: 'sub', active: true },
  { slug: 'donetska-oblast', name: 'Donetsk Oblast', kind: 'sub', active: false },
  { slug: 'luhanska-oblast', name: 'Luhansk Oblast', kind: 'sub', active: false },
  { slug: 'khersonska-oblast', name: 'Kherson Oblast', kind: 'sub', active: false },
];
const SUB_QUEUES = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2'];
const INT12_QUEUES = Array.from({ length: 12 }, (_, i) => String(i + 1));
const KYIV60_QUEUES = Array.from({ length: 60 }, (_, i) => `${i + 1}.1`);
const bezsvitlaRegion = slug => BEZSVITLA_REGIONS.find(r => r.slug === slug) || null;
function bezsvitlaQueues(slug) {
  const r = bezsvitlaRegion(slug);
  if (!r) return SUB_QUEUES;
  return r.kind === 'kyiv60' ? KYIV60_QUEUES : r.kind === 'int12' ? INT12_QUEUES : SUB_QUEUES;
}
function normalizeBezsvitlaQueue(slug, raw) {
  let s = String(raw || '').trim().replace(/^(?:черга|група|підчерга)\s*/i, '').replace(/[-,]/g, '.').replace(/\s+/g, '');
  if (!s) return '';
  const r = bezsvitlaRegion(slug);
  if (r && r.kind === 'int12') {
    const pair = s.match(/^(\d+)\.(\d+)$/);
    if (pair) return String((+pair[1] - 1) * 2 + (+pair[2] >= 2 ? 2 : 1));
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 && n <= 12 ? String(n) : s;
  }
  if (r && r.kind === 'kyiv60' && /^\d+$/.test(s)) return `${s}.1`;
  if ((!r || r.kind === 'sub') && /^\d+$/.test(s)) return `${s}.1`;
  return s;
}
function bezsvitlaUrl(slug, queue) {
  const r = bezsvitlaRegion(slug);
  const q = normalizeBezsvitlaQueue(slug, queue);
  if (!slug) return BEZSVITLA_BASE;
  if (!q) return `${BEZSVITLA_BASE}/${slug}`;
  if (r && r.kind === 'int12' && /^\d+$/.test(q)) {
    const n = +q;
    return `${BEZSVITLA_BASE}/${slug}/cherha-${Math.ceil(n / 2)}-${n % 2 ? 1 : 2}`;
  }
  return `${BEZSVITLA_BASE}/${slug}/cherha-${q.replace(/\./g, '-')}`;
}

const decodeAttr = s => String(s || '')
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const hmToMin = s => {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = +m[1], min = +m[2];
  return (h === 24 && min === 0) ? DAY : (h >= 0 && h < 24 && min >= 0 && min < 60) ? h * 60 + min : null;
};
const BZ_STATE = { ON: 'on', OFF: 'off', MAYBE: 'maybe', POSSIBLE: 'maybe', UNKNOWN: 'maybe' };
function slotsFromBzJson(raw) {
  let arr;
  try { arr = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return []; }
  if (!Array.isArray(arr)) return [];
  const slots = [];
  for (const x of arr) {
    const start = hmToMin(x && x.from), end = hmToMin(x && x.to);
    if (start === null || end === null || end <= start) continue;
    slots.push({ start, end, type: BZ_STATE[String(x.state || '').toUpperCase()] || 'maybe' });
  }
  return merge(slots.sort((a, b) => a.start - b.start));
}
function slotsFromBzDom(cardHtml) {
  const slots = [];
  const re = /bz-schedule-slot--(on|off|maybe)[\s\S]*?(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/gi;
  for (const m of cardHtml.matchAll(re)) {
    const start = hmToMin(m[2]), end = hmToMin(m[3]);
    if (start !== null && end !== null && end > start) slots.push({ start, end, type: m[1].toLowerCase() });
  }
  return merge(slots.sort((a, b) => a.start - b.start));
}
function parseBzUpdated(html) {
  const t = html.match(/bz-schedule-hero__stamp--updated[\s\S]*?<time[^>]*datetime="([^"]+)"/i);
  if (t) return t[1];
  const u = html.match(/bz-schedule-card__updated[^>]*>\s*(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (u) return `${u[3]}-${u[2]}-${u[1]}T${u[4]}:${u[5]}:00+02:00`;
  return '';
}
function pickBzCard(html, queue) {
  const cards = [...String(html || '').matchAll(/<article\b[^>]*bz-schedule-card[\s\S]*?<\/article>/gi)].map(m => m[0]);
  if (!cards.length) return String(html || '');
  if (cards.length === 1 || !queue) return cards[0];
  const q = String(queue).trim(), slugPart = `cherha-${q.replace(/\./g, '-')}`;
  return cards.find(c => c.includes(slugPart) || new RegExp(`(?:Черга|Група)\\s*${q.replace('.', '\\.')}(?!\\d)`, 'i').test(c)) || cards[0];
}
function fromBezsvitlaHtml(html, queue, tomorrowHtml, fallbackDate) {
  if (!html) return null;
  const text = String(html);
  const card = pickBzCard(text, queue);
  const attr = name => {
    const m = card.match(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
    return m ? decodeAttr(m[1] !== undefined ? m[1] : m[2]) : '';
  };
  const dateMatch = attr('data-schedule-date') || (text.match(/data-schedule-date="(\d{4}-\d{2}-\d{2})"/) || [])[1] || fallbackDate || '';
  let todaySlots = slotsFromBzJson(attr('data-schedule-intervals'));
  if (!todaySlots.length) todaySlots = slotsFromBzDom(card);
  let tmSlots = slotsFromBzJson(attr('data-schedule-tomorrow'));
  if (!tmSlots.length && tomorrowHtml) {
    const tmCard = pickBzCard(String(tomorrowHtml), queue);
    const tmAttr = name => {
      const m = tmCard.match(new RegExp(`${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
      return m ? decodeAttr(m[1] !== undefined ? m[1] : m[2]) : '';
    };
    tmSlots = slotsFromBzJson(tmAttr('data-schedule-intervals'));
    if (!tmSlots.length) tmSlots = slotsFromBzDom(tmCard);
  }
  const hasCard = /bz-schedule-card|bz-schedule-countdown/i.test(text);
  if (!hasCard && !todaySlots.length) return null;
  const d0 = dateMatch || kyivNow(Date.now()).date;
  const d1 = addDays(d0, 1);
  return {
    updated: parseBzUpdated(text),
    days: [
      todaySlots.length ? { date: d0, status: 'known', slots: todaySlots } : emptyDay(d0, 'waiting'),
      tmSlots.length ? { date: d1, status: 'known', slots: tmSlots } : emptyDay(d1, 'waiting'),
    ],
  };
}
function extractCityId(html) {
  const m = String(html || '').match(/(?:data-city-id=["']|city_id\s*[:=]\s*["']?)(\d+)/i);
  return m ? +m[1] : 0;
}

/* ───────────── sources ───────────── */
const YASNO_TYPE = { NotPlanned: 'on', Definite: 'off' };
function fromYasno(json, group) {
  const gr = json && json[group];
  if (!gr) return null;
  const conv = d => {
    if (!d) return emptyDay('', 'unknown');
    const date = String(d.date || '').slice(0, 10);
    const slots = (d.slots || []).map(s => ({ start: s.start, end: s.end, type: YASNO_TYPE[s.type] || 'maybe' }));
    return { date, status: d.status === 'ScheduleApplies' && slots.length ? 'known' : d.status === 'WaitingForSchedule' ? 'waiting' : 'unknown', slots: merge(slots) };
  };
  return { updated: gr.updatedOn || '', days: [conv(gr.today), conv(gr.tomorrow)] };
}
// sorted group names of a Yasno response: "1.1", "2.1", ..., "10.1"
const yasnoGroups = json => Object.keys(json || {}).filter(k => json[k] && typeof json[k] === 'object' && json[k].today).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b));

// pasted schedule saved in a tile: { date: Kyiv date when pasted, today: [...], tomorrow: [...] } -> normalised days for `date`
function fromPasted(saved, date) {
  if (!saved || !saved.date) return null;
  const mk = (d, iv) => dayFromParsed(d, iv || []);
  const shift = saved.date === date ? 0 : saved.date === addDays(date, -1) ? 1 : -1;
  if (shift < 0) return { updated: '', days: [emptyDay(date, 'unknown'), emptyDay(addDays(date, 1), 'unknown')], stale: true };
  const today = shift === 0 ? saved.today : saved.tomorrow, tomorrow = shift === 0 ? saved.tomorrow : [];
  return { updated: saved.savedAt || '', days: [mk(date, today), tomorrow && tomorrow.length ? mk(addDays(date, 1), tomorrow) : emptyDay(addDays(date, 1), 'waiting')] };
}

// Make sure days[0] is `date`: a cached schedule from yesterday has today as its second day.
function align(days, date) {
  if (days[0] && days[0].date === date) return days;
  if (days[1] && days[1].date === date) return [days[1], emptyDay(addDays(date, 1), 'waiting')];
  return [emptyDay(date, 'unknown'), emptyDay(addDays(date, 1), 'unknown')];
}

/* ───────────── what is happening now ───────────── */
// days[0] must be today. Returns { kind, endsAt, open } where endsAt is minutes from today's midnight (may exceed 1440)
// and open means the known schedule ended before the state changed.
function status(days, nowMin) {
  const today = days[0], tomorrow = days[1];
  if (!today || today.status !== 'known') return { kind: 'unknown' };
  const slots = [...today.slots, ...(tomorrow && tomorrow.status === 'known' ? tomorrow.slots.map(s => ({ ...s, start: s.start + DAY, end: s.end + DAY })) : [])];
  const i = slots.findIndex(s => nowMin >= s.start && nowMin < s.end);
  if (i < 0) return { kind: 'unknown' };
  const kind = slots[i].type; let end = slots[i].end;
  for (let j = i + 1; j < slots.length && slots[j].type === kind && slots[j].start === end; j++) end = slots[j].end;
  const known = slots[slots.length - 1].end;
  return { kind, endsAt: end, open: end >= known };
}

// minutes -> "2 h 15 min" / "45 min" (kept for pure logic & tests) + Ukrainian variant + HH:MM:SS countdown
const duration = min => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`; };
const durationText = min => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`; };
const hms = sec => { const s = Math.max(0, Math.floor(sec)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60; return `${pad(h)}:${pad(m)}:${pad(r)}`; };
const secondsUntil = (endsAtMin, now) => Math.max(0, (endsAtMin - now.minutes) * 60 - (now.seconds || 0));
const intervals = day => (day && day.status === 'known' ? day.slots.filter(s => s.type === 'off').map(s => [s.start, s.end]) : []);

const out = {
  DAY, kyivNow, addDays, clock, clockEnd, merge, dayFromOff, emptyDay, parseSchedule, dayFromParsed,
  BEZSVITLA_BASE, BEZSVITLA_REGIONS, bezsvitlaRegion, bezsvitlaQueues, normalizeBezsvitlaQueue, bezsvitlaUrl, fromBezsvitlaHtml, extractCityId,
  fromYasno, yasnoGroups, fromPasted, align, status, duration, durationText, hms, secondsUntil, intervals,
};
(g.VEGA = g.VEGA || {}).outage = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
