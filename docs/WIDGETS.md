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
| Outages | `outage` | 3×3 | 2×2 | 12×8 | `cfg` per tile, cache `hud.outage` |

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

### Outages ✅
Whether the power is on right now, live second-by-second countdown to the next change, and today's and tomorrow's schedule (Kyiv time).
- **Sources (per tile):**
  - *bezsvitla.com.ua* (default): automatic for all regions of Ukraine (`kyiv`, 21 active oblasts, 3 limited oblasts), with optional address-based queue detection (Kyiv and cities with street data) and queue dropdown/manual fallback. Refreshes every 15 minutes and caches offline. Includes a clickable source link to `bezsvitla.com.ua` in the footer.
  - *Yasno*: automatic for the operators Yasno publishes (Kyiv, Dnipro).
  - *Paste a schedule*: works for any region by pasting text from a Telegram bot or operator site.
- **Settings:** open with the tile menu (`m` → *Configure…*), `Enter` on an unconfigured tile, or the command bar.
- **Config (`cfg`):** `source` (`bezsvitla` | `yasno` | `paste`), `regionSlug`, `regionName`, `queue`, `cityId`, `cityName`, `sourceUrl` for bezsvitla.com.ua; `region`, `dso`, `group` for Yasno; `paste` (`date`, `today`, `tomorrow`, `savedAt`, `raw`, `meaning`) for pasted text.
- **Permissions:** optional host permission for `https://bezsvitla.com.ua/*` (or `https://app.yasno.ua/*`), asked on save/search via `ensureOrigin()`. Pasted schedules need nothing.
- **Layouts:** vertical card view (live countdown pill, today/tomorrow tabs, slot rows with active slot highlighted) on portrait/square tiles → horizontal timeline (segmented 24h bar with explicit start/end boundary labels at every zone transition + today/tomorrow summary) on wide/short tiles → compact strip on minimal heights.
- **Keyboard:** `Enter` refreshes, or opens the setup dialog when unconfigured.

---

## Planned widgets

Each entry says what it needs. Anything that talks to a new host asks for that host permission only when the widget is added or enabled, never at install.

### More outage sources 📋
Automatic schedules for more regions, as separate adapters behind the same widget.
- **Custom JSON URL:** point a tile at any URL that serves a documented JSON format (for example a community mirror or your own script). Needs an optional host permission for that host.
- **Operator adapters:** added only where the operator or a maintained open-data project publishes a stable, permitted feed. Requests for permission or an API go to the site owners first.
- **Config:** `source: "json"`, `url`, `group`.

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

### GitHub panel 📋 (unscheduled)
Your pull-request work in one tile.
- **Shows:** pull requests you authored (with review and CI state), review requests waiting for you, issues assigned to you, notifications and mentions. Optional: workflow runs on your repositories, new releases of repositories you watch, Dependabot and security alerts.
- **Data:** GitHub REST API with a personal access token (a fine-grained, read-only token is enough). The token is stored only in your browser and sent only to GitHub.
- **Permissions:** optional host permission for `https://api.github.com/*`, requested when the widget is enabled.
- **Config (`cfg`):** `token`, `repos` (filter), `show` (`prs` / `reviews` / `issues` / `notifications` / `ci`), `refreshMinutes`.
- **Size:** default 4×4, min 3×2, max 8×10. Compact layout: three counters ("2 to review · 1 failing · 4 open").
- **Keyboard:** `Enter` goes inside; arrows move through items; `Enter` opens the item on GitHub, `Ctrl+Enter` in a new tab.
- **Open questions:** rate limits (conditional requests and caching), and GitHub Enterprise hosts (a custom host asks for its own permission).

### Calendar (ICS) 📋 (unscheduled)
An agenda for today and the next few days, with the next event highlighted and a countdown.
- **Data:** an ICS feed URL. This also covers Google Calendar through its *secret address in iCal format* (read-only, no sign-in flow), and Outlook, Apple and Proton calendars through their published ICS links. Recurring events are expanded locally.
- **Permissions:** optional host permission for the calendar host.
- **Config:** `url` (one or several), `days`, `showAllDay`, `colorByCalendar`.
- **Size:** default 3×4, min 2×2, max 6×10. Compact layout: only "next event in 25 min".
- **Limits:** an ICS link is read-only and refreshes on the calendar provider's schedule (often every few hours).

### Google Calendar and Google Tasks 📋 (unscheduled, after the ICS calendar)
Calendar events plus your Google to-do list ("list of things to do"), with the ability to tick tasks off.
- **Phase 1:** events through the ICS link above (nothing to sign in to). Google Tasks cannot be read this way.
- **Phase 2:** Google Calendar and Google Tasks APIs through OAuth. Sign-in uses the browser's identity API (`identity` permission, optional) and read-only scopes first; write access (tick a task, add an event) is a separate opt-in.
- **Needs a decision before building:** Google requires an OAuth client. Either the project registers one (and passes Google's verification for the scopes it uses) or each user creates their own client ID and pastes it in. The second keeps the project independent but is more work for the user.
- **Config:** `calendars`, `taskLists`, `days`, `showCompleted`.

### Jira panel 📋 (unscheduled)
Your Jira work in one tile.
- **Shows:** issues assigned to you, or the result of any JQL query you save; status, priority, key and summary; a filter for the current sprint. Optional: move an issue to another status from the tile.
- **Data:** Jira Cloud REST API with your email and an API token (stored locally), or a personal access token for Jira Data Center. OAuth 2.0 may come later.
- **Permissions:** optional host permission for your own Jira site (`https://<your-site>.atlassian.net/*` or your self-hosted address), requested when the widget is enabled.
- **Config:** `site`, `auth`, `jql`, `maxResults`, `fields`, `groupBy` (`status` / `project` / `none`).
- **Size:** default 4×4, min 3×2, max 8×10. Compact layout: counters per status.
- **Keyboard:** same pattern as the GitHub panel (`Enter` inside, arrows, `Enter` to open, `Ctrl+Enter` in a new tab).

### Jira-style tasks 📋 (unscheduled)
Turn the Tasks widget from a plain checklist into a lightweight tracker that lives entirely in your browser.
- **Fields (all optional):** key (for example `HOME-12`, generated per project), title, description, status (a customisable workflow such as To do / In progress / Done), priority, labels, due date, estimate, project, parent task (sub-tasks).
- **Views:** the current list view (grouped by status), and a separate **Board** widget with one column per status where tiles move with the keyboard (`h`/`l` change status).
- **Command bar:** `+ Write the report !high #work @fri` adds a task with priority, label and due date.
- **Compatibility:** purely additive. Existing tasks (`{id, text, done}`) keep working; `done` stays valid and maps to the final status. Nothing is migrated destructively and exports keep the new fields.
- **Later, optional:** two-way sync with Jira so a Jira issue can appear as a task and a local task can be pushed to a project. This depends on the Jira panel above.
- **Open questions:** how much workflow customisation is worth the added screen space, and whether several task lists (per project) should share one widget.

### Ambient sounds 📋 (unscheduled)
A small mixer of background sounds: rain, wind, ocean, city, birds, a café, fireplace, plus white/pink/brown noise. Each has its own volume; a sleep timer fades everything out.
- **How:** noise-based sounds (white/pink/brown noise, rain, wind, waves) are synthesised with the Web Audio API, so they work offline and need no files. Recorded loops (birds, city, café) come from files you add yourself (kept in IndexedDB like local wallpapers) or from CC0 loops listed with their licences.
- **Config:** `mix` (sound id → volume), `sleepMinutes`.
- **Permissions:** none for synthesised sounds and local files.
- **Limits:** browsers only start audio after a click or key press, so a new tab shows a *Play* button instead of starting by itself. Audio stops when the tab navigates away from VEGA; a player that survives that needs a background context (and extra permissions), which is a separate decision.

### Radio and music player 📋 (unscheduled)
Station-style playback: lofi and chill internet radio, plus your own songs.
- **Radio:** stations are internet radio stream URLs (MP3/AAC over HTTP). A short curated list ships with the credit and source of each station, and you can add your own URL. Only streams that allow this kind of listening are listed.
- **Your music:** audio files you add, stored locally (IndexedDB), as playlists with shuffle, shown as "stations" in the style of a game's in-car radio. Files never leave your machine.
- **Controls:** play/pause, next, volume, media keys through the Media Session API; keyboard-first (`Space`, `←`/`→`).
- **Config:** `station`, `playlist`, `volume`.
- **Permissions:** optional host permission per stream host. Local files need none.
- **Open questions:** how popular it will be (kept small on purpose), and the same autoplay and tab-lifetime limits as ambient sounds.

### Wallpaper presets 💡 (postponed)
A picker with ready-made wallpapers. Postponed because it needs content VEGA is allowed to redistribute: original animated loops generated for the project, or links to freely licensed sources with credit. Large files would be hosted as release assets, not in the git history.

### More integrations 💡
Ideas that follow the same pattern (token stored locally, optional host permission, one adapter per service): GitLab merge requests and pipelines, Linear issues, Todoist or Microsoft To Do lists, Notion database view, Slack or email unread counts (these need OAuth), Sentry issue counts, uptime/status pages.

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
- [x] Outages widget (Yasno + pasted schedule)
- [x] City search for the weather location (geocoding)
- [x] Toolbar menu reuses an open VEGA tab
- [ ] More outage sources (custom JSON URL, operator adapters)

**0.5.0**
- [ ] Air-raid alerts map
- [ ] Threat ETA calculator

**Later (unscheduled)**
- [ ] GitHub panel (pull requests, reviews, issues, notifications, CI)
- [ ] Calendar (ICS), which also covers Google Calendar events
- [ ] Google Calendar and Google Tasks through OAuth
- [ ] Jira panel (assigned issues, JQL, sprint)
- [ ] Jira-style tasks (status, priority, labels, due date, sub-tasks, project keys)
- [ ] Board widget (kanban view of tasks)
- [ ] Jira sync for tasks (optional, after the Jira panel)
- [ ] RSS reader
- [ ] Bookmarks
- [ ] Recent history
- [ ] Countdown
- [ ] Quick capture
- [ ] More integrations (GitLab, Linear, Todoist, Notion, ...)
- [ ] Ambient sounds (rain, wind, city, birds, noise)
- [ ] Radio and music player (internet radio, local songs)
- [ ] Wallpaper presets (postponed)
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
