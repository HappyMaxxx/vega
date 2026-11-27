# VEGA widgets

Every tile on a VEGA board is a widget ("module" in the code). This file is the reference for the widgets that exist, the settings they have, and the checklist of what is planned.

Status legend: ✅ shipped · 🚧 in progress · 📋 planned (scoped) · 💡 idea (not scoped yet)

- [Shipped widgets](#shipped-widgets)
- [Planned widgets](#planned-widgets)
- [Checklist](#checklist)
- [How a widget is built](#how-a-widget-is-built)

---

## Shipped widgets

Sizes are grid cells (the board is 12 columns wide, 8 rows visible). A tile can be resized between `min` and `max`; each widget re-lays itself out with container queries, so every allowed size is meant to look intentional.

| Widget | Type id | Default | Min | Max | Stored in |
| --- | --- | --- | --- | --- | --- |
| Clock | `clock` | 3×2 | 2×1 | 8×5 | nothing |
| Weather | `weather` | 3×2 | 2×1 | 8×6 | `settings.place/lat/lon`, cache `hud.weather` |
| Focus timer | `timer` | 3×3 | 2×2 | 8×8 | `timer`, `settings.focusMin/breakMin` |
| Tasks | `tasks` | 3×5 | 2×2 | 8×12 | `tasks` (shared by all task tiles) |
| Notes | `notes` | 4×3 | 2×2 | 12×12 | `data[tileId].text` |
| Links | `links` | 5×3 | 2×1 | 12×12 | `groups` (shared), `cfg.tab` per tile |

### Clock ✅
Large time with seconds, the date, and a thin bar showing how much of the day has passed.
- Layouts: full (time, date, progress) → no progress below ~110 px tall → time only below ~70 px → one row (time left, date right) when wide and short. Seconds are hidden below ~190 px wide.
- Settings: none yet. Ideas: 12/24 h, show seconds, time zone.
- Keyboard: no inner mode.

### Weather ✅
Current temperature, condition, "feels like" and wind, plus a 3-day forecast when the tile is large enough.
- Data: Open-Meteo (`https://api.open-meteo.com`, the only required host permission). Cached for 15 minutes, shown from cache immediately, marked "(stale)" when offline.
- Layouts: one row (small) → temperature and condition → adds details → adds the 3-day forecast at ≥ 260 px wide and ≥ 170 px tall.
- Settings (global, in Settings): city label, latitude, longitude.
- Keyboard: `Enter` refreshes.

### Focus timer ✅
Focus and break countdown with a progress ring, shared across all timer tiles and across workspaces. Shows the running time in the bottom bar and in the tab title. Plays a short beep when a session ends.
- Layouts: ring with time inside and a label → ring with time inside → ring beside the time (short and wide, ≥ 270 px) → time and buttons only (short and narrow).
- Settings (global): focus minutes, break minutes.
- Keyboard: `Space` starts or pauses from tile level; `Enter` goes inside, `←`/`→` (or `h`/`l`) move between the buttons.

### Tasks ✅
A single list shared by every tasks tile: add, tick, delete. Open tasks first, done tasks below.
- Add from anywhere: command bar → `+ buy milk`.
- Keyboard: `Enter` goes inside (cursor in the input); `↓` reaches the list; `↑`/`↓` or `j`/`k` move; `Space` ticks; `x` or `Delete` removes; `i` returns to the input.

### Notes ✅
Free text, saved as you type. Each notes tile has its own text (it travels with the tile when you move or duplicate it, and goes into the undo entry when you delete it).
- Keyboard: `Enter` puts the caret in the text; `Esc` comes out.

### Links ✅
Groups of links. Each tile shows all groups, or only one tab (set in edit mode with the picker in the tile header).
- Colours: link dots use each link's own colour, or the theme palette when "Use theme colours for link dots" is on (default for new installs).
- Settings: links are edited as JSON in Settings today (an in-page editor is planned).
- Keyboard: `Enter` goes inside; arrows or `h j k l` move to the nearest link in that direction; `Enter` opens it, `Ctrl+Enter` opens a new tab.

---

## Planned widgets

Each entry says what it needs. Anything that talks to a new host asks for that host permission only when the widget is added or enabled, never at install.

### Power outages 📋 (target 0.4.0)
Shows whether power is on now, when it changes next, and today's schedule as a timeline.
- **Data:** public outage-schedule feeds published by the regional operators or community mirrors. The exact sources are chosen and verified when the widget is built; the widget is designed around a small adapter per source so a broken feed can be swapped.
- **Permissions:** optional host permission for the selected source.
- **Config (`cfg`):** `region`, `group` (queue/subgroup), `source`.
- **Size:** default 3×3, min 2×2, max 6×6. Compact layout: a single "on until 18:00" line.
- **Refresh:** every 15 minutes, cached; shows the last known schedule when offline.
- **Open questions:** feed stability and format differences between operators.

### Air-raid alerts map 📋 (target 0.5.0)
An oblast map coloured by current alert status, with the duration of active alerts and an optional browser notification when your pinned regions change.
- **Data:** an alerts API. These require a personal token (free for non-commercial use on request). The token is stored only in your browser (`localStorage`), never sent anywhere except to that API.
- **Permissions:** optional host permission for the API host. Notifications are optional and requested on enable.
- **Config:** `token`, `pinned` regions, `notify` on/off.
- **Size:** default 4×4, min 3×3, max 8×8. The map is an embedded SVG (no remote tiles).
- **Important:** this is a convenience display. It is not a replacement for official alerts and sirens.

### Threat ETA calculator 📋 (target 0.5.0)
A calculator, not a live tracker. You choose a point (a place name from a built-in list or coordinates) and a threat type; it computes the great-circle distance to your pinned locations and an approximate time of flight from a speed table, and shows what time an alert might be expected if none has been declared yet.
- **Data:** none. It runs offline with typical published speeds per type (editable in the widget settings).
- **Permissions:** none.
- **Config:** `home` (your location), `speeds` table.
- **Limits, stated plainly:** VEGA does not receive live flight tracks. There is no public API for them, and scraping chat channels is fragile and out of scope. Results are rough estimates; they ignore routing, altitude and manoeuvres, and must not be used as a safety decision. The widget carries this notice.

### GitHub panel 📋
Open pull requests, review requests and notifications.
- **Data:** GitHub REST API with a personal access token stored locally. **Permissions:** optional host permission for `https://api.github.com/*`, requested when enabled.
- **Config:** `token`, `repos`, `show` (prs / reviews / notifications).

### Calendar (ICS) 📋
Next events from an ICS URL. **Config:** `url`, `days`. **Permissions:** optional host permission for the calendar host.

### RSS reader 📋
Latest items from feeds. **Config:** `feeds`, `limit`. **Permissions:** optional host permission per feed host.

### Bookmarks 📋
Browse or search bookmarks inside a tile. **Permissions:** optional `bookmarks` (already used by the command bar).

### Recent history 📋
Recently visited pages. **Permissions:** optional `history`.

### Countdown 📋
Days or hours until a date. **Config:** `label`, `date`. No network, no permissions.

### Quick capture 📋
One-line inbox that appends to Tasks or to a Notes tile. **Config:** `target`.

### Ideas 💡
Clipboard shelf, habit streaks, world clocks, currency rates, system stats (not possible from a page without extra permissions).

---

## Checklist

**Shipped**
- [x] Clock
- [x] Weather
- [x] Focus timer
- [x] Tasks
- [x] Notes
- [x] Links

**0.4.0**
- [ ] Power outages
- [ ] City search for the weather location (geocoding)

**0.5.0**
- [ ] Air-raid alerts map
- [ ] Threat ETA calculator

**Later**
- [ ] GitHub panel
- [ ] Calendar (ICS)
- [ ] RSS reader
- [ ] Bookmarks
- [ ] Recent history
- [ ] Countdown
- [ ] Quick capture
- [ ] In-page link editor (not a widget, but unlocks per-tile link lists)

---

## How a widget is built

1. **Register the size limits** in `META` in `grid.js`: `def`, `min`, `max` as `[w, h]`. Add the title in `strings.js` (`mod.<type>`).
2. **Implement `MODULES.<type>.render(body, ctx)`** in `app.js`. `ctx` gives you `it` (the tile: `id`, `cfg`, size), `setStatus(text|Node)` for the right side of the header, and `editing`.
   It may return any of these hooks:

   | Hook | When it runs |
   | --- | --- |
   | `tick()` | every second (global ticker) |
   | `refresh()` | when shared data changed (`refresh('<type>')`) |
   | `resize()` | after the tile was resized |
   | `commit()` | before the tile is removed or moved: flush pending input |
   | `destroy()` | when the tile is torn down: clear timers |
   | `enter()` | the user pressed `Enter` on the tile; focus your first control. Return `false` if there is nothing to go inside. |

3. **Persistence.** Per-tile configuration goes in `it.cfg`. Per-tile data goes in `state.data[it.id]` (it follows the tile through moves and undo). Shared data goes in a top-level key of `state`. Everything is additive: extend `normalize()` in `state.js` with safe defaults and never drop unknown fields.
4. **Layout.** The tile body is a size container. Use `@container` queries in `style.css` and check the minimum and maximum sizes. Add the widget to the size matrix when you test.
5. **Keyboard parity.** Every action needs a keyboard path. Implement `enter()` and handle arrows/`h j k l` inside the widget; `Esc` leaving is handled for you.
6. **Colours.** Use theme tokens only (`var(--accent)`, …). Literal colours are rejected by the tests.
7. **Network.** Request host permissions at runtime (`optional_permissions`/optional hosts), only when the widget is enabled, and document it in the README permissions table.
8. **Tests and docs.** Add smoke tests, add the widget here (settings, sizes, data, permissions), and tick it off in the checklist.
