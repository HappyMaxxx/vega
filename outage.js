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

// minutes -> "2 h 15 min" / "45 min"
const duration = min => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? (m % 60 ? `${h} h ${m % 60} min` : `${h} h`) : `${m} min`; };
const intervals = day => (day && day.status === 'known' ? day.slots.filter(s => s.type === 'off').map(s => [s.start, s.end]) : []);

const out = { DAY, kyivNow, addDays, clock, clockEnd, merge, dayFromOff, emptyDay, parseSchedule, dayFromParsed, fromYasno, yasnoGroups, fromPasted, align, status, duration, intervals };
(g.VEGA = g.VEGA || {}).outage = out;
if (typeof module !== 'undefined' && module.exports) module.exports = out;
})(typeof globalThis !== 'undefined' ? globalThis : this);
