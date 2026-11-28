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
A clock with seven styles, set per tile in *Configure…* (tile menu `m`, or the command bar).
- **Styles:** *Standard* (time, seconds, date, day-progress bar), *Large*, *Minimal* (time only), *Stacked* (hours over minutes), *Analog* (SVG dial), *Binary* (BCD dots), *Words* ("quarter past nine").
- **Settings (`cfg`):** `style`, `align` (`left` | `center` | `right`), `valign` (`top` | `middle` | `bottom`), `weight` (`light` | `regular` | `bold`), `date` (`long` | `short` | `numeric` | `none`), `hour12`, `seconds`, `progress`, `name` (tile title). Defaults reproduce the pre-0.5 look, so existing clocks are unchanged.
- **Layouts:** by size: no progress bar below ~110 px tall, no date below ~70 px, one row (time left, date right) for the standard style when wide and short, seconds hidden below ~190 px wide. The analog dial scales to the free space and follows the alignment.
- **Keyboard:** no inner mode; `m` → *Configure…*.

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
Groups of links. Each tile shows all groups, only one tab, or a hand-picked set of groups. Every tile has its own look.
- **Settings (`cfg`, in *Configure…*):** `groups` (list of `tab/name` keys; empty = follow `tab`, the edit-mode tab picker), `layout` (`columns` | `list` | `chips`), `cols` (1–4, 0 = automatic), `align`, `icons` (`dot` | `letter` | `none`), `size` (`small` | `normal` | `large`), `color` (heading colour from a theme token), `headers`, `newTab`, `name`.
- **Quick add:** the same dialog has *Add a link* (group, name, `https://` address); the link is added to the group at once. Other links are still edited as JSON in Settings.
- **Colours:** link dots use each link's own colour, or the theme palette when "Use theme colours for link dots" is on (default for new installs).
- **Keyboard:** `Enter` goes inside; arrows or `h j k l` move to the nearest link in that direction; `Enter` opens it, `Ctrl+Enter` opens a new tab.

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

### World clocks ✅
Several time zones on one tile: name, time, the difference from your own time (`+7h`, `−5h 30m`) and `tomorrow`/`yesterday` when the date differs.
- **Settings (`cfg`):** `zones` (up to 8 × `{ tz, label }`, IANA names such as `Asia/Tokyo`; a fresh tile starts with New York, London, Tokyo), `local` (your own time first), `offsets`, `hour12`, `seconds`, `name`. Add and remove zones in *Configure…*; invalid names are refused.
- **Data:** none, it uses the browser's time-zone database (`Intl`). No permissions.
- **Layouts:** rows adapt to the tile; the difference column hides below ~160 px wide.

### Countdown ✅
Days (or days, hours, minutes) until your dates.
- **Settings (`cfg`):** `events` (up to 12 × `{ id, name, date, time?, yearly }`), `detail` (`days` | `full`), `order` (`soonest` | `manual`), `hidePast`, `name`. Yearly events roll over to next year; events with a time count down to the minute (to the second in `full`), all-day events count calendar days. A single event is shown large.
- **Data:** none. No permissions.

### Rates ✅
Exchange rates and crypto prices from one of three sources, chosen per tile.
- **Sources:**
  - *National Bank of Ukraine* (default): the official rate, with the change since the previous published day. Any currency the bank publishes can be the base, cross rates (EUR in USD) go through hryvnia.
  - *monobank*: **buy / sell** prices against the hryvnia, as on a bank board. Buy is what the bank pays you, sell is what you pay. Pairs without a buy/sell quote show the cross rate.
  - *Crypto (Binance)*: **buy / sell** are the best bid and ask, plus the 24-hour change. Choose the coins (any ticker Binance lists against the quote) and the quote currency (USDT, EUR or UAH). A pair that does not exist shows a dash.
- **Data and caching:** `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json` (cached 1 h), `https://api.monobank.ua/bank/currency` (cached 5 min; the API allows one request a minute), `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=…` (cached 1 min). All cached in `hud.rates` (one entry per source), shown from the cache immediately and marked *offline* when the network fails. Prices are informational, not financial advice.
- **Settings (`cfg`):** `source` (`nbu` | `mono` | `crypto`), `codes` (up to 8 currencies, for NBU and monobank), `base` (NBU only), `coins` and `quote` (crypto), `amount` (price of N units), `decimals` (0–6), `change`, `name`. Add and remove currencies and coins in *Configure…*; codes a source does not publish are refused once its data has been loaded.
- **Permissions:** optional host, asked when you save a source: `https://bank.gov.ua/*`, `https://api.monobank.ua/*` or `https://data-api.binance.vision/*`.
- **Layouts:** buy/sell sources show two price columns with a header; the change column hides below ~250 px wide.

### Ambient sounds ✅
A mixer of background sounds with one slider each: real recordings (rain, thunderstorm, wind in the woods, ocean, stream and birds, birdsong, fireplace) plus three generated noises (white, pink, brown). You can also add your own sounds by link.
- **Where the sound comes from:** the recordings are streamed from archive.org while they play (public domain or CC0, 3–36 minutes, looped). Nothing is requested until you press *Play* with that sound above zero, and a stream pauses when its slider goes back to zero. The noises are generated with the Web Audio API and work offline. No extension permission is needed (browsers load `<audio>` from any https host); playing a recording contacts archive.org like opening any web page would.
- **Your own sounds (`cfg.custom`, up to 6):** a name and an `https://` link to an audio file or an internet radio stream. Files loop; radio streams just keep playing.
- **Settings (`cfg`):** `sounds` (which rows the tile shows), `levels` (sound id → 0–1, saved when you let go of a slider), `master`, `sleepMin` (0, 15, 30, 45, 60, 90; fades out over the last ten seconds), `withTimer` (play while the focus timer is running), `custom`, `name`.
- **Behaviour:** audio starts only after you press *Play* (browsers require a user gesture). The sound keeps playing when you switch workspace or save settings, and stops when the tile is deleted or the tab is closed. A sound that cannot be loaded (offline, blocked link) is greyed out with a tooltip.
- **Keyboard:** `Enter` goes inside (focus on *Play*); `Tab` moves between controls; sliders respond to the arrow keys.
- **Permissions:** none.
- **Credits (all from archive.org):** *Light Gentle Rain*, *Gentle Ocean*, *Relaxing Nature Sounds – Trickling Stream Sounds & Birds* and *– Birdsong Sound* (CC0, `naturesounds-soundtheraphy`, `ocean-sea-sounds`); *Fire Favorite* (CC0, recorded by inchadney, `FireFavorite`); *TedEllis binaural wind sounds birds woods* (CC0, Yarmonics, `soundica-fs-447408-tedellis-binaural-wind-sounds-birds-woods-mp3`); *thunderstorm* (public domain mark, `thunderstorm_ms_relax_water`). If a link ever disappears, the sound shows as unavailable and can be replaced in `widgets.js` (`STREAMS`) without any data migration.

---

## Planned widgets

Each entry says what it needs. Anything that talks to a new host asks for that host permission only when the widget is added or enabled, never at install.

### Air-raid alerts (Ukraine) ✅
One widget that answers two questions: *where are alerts right now*, and *how soon might one start where I am*, so you can decide whether to go to a shop or café that closes during an alert.
- **Map and focus:** every oblast as a circle on a schematic map (positioned by its real centre coordinates, not traced boundaries — VEGA has no licensed boundary geometry yet, see *Known limits* below), coloured by its current status (`red` / `yellow` / `partial` / none). Click or (`Tab`, `Enter`/`Space`) a circle to pin or unpin it — that is also how you choose your first oblast. Pinned oblasts get a ring; with *focus* on (the default), the rest of the map dims by distance from the nearest pinned oblast, so your region stays readable. Up to 6 oblasts can be pinned at once.
- **Alert feed, two interchangeable sources (per tile):**
  1. *[alerts.in.ua](https://alerts.in.ua/)* (default): the official per-oblast status API, with a personal token (free for personal use, requested at alerts.in.ua/api-request), stored only in `localStorage` and sent only to that API. Gives both whole-oblast and partial (sub-oblast) status.
  2. *[kudyletyt.com](https://www.kudyletyt.com/)*: the same project behind *Live tracks* below also mirrors the official feed, with no token needed. It is matched by the Ukrainian region name against VEGA's 27 oblasts, and only its whole-oblast (`State`-level) rows can be trusted this way — a sub-oblast ("partial") alert through this source is invisible, since the feed gives no oblast for its raion/hromada rows. Same unofficial-source caveats as the tracks feed.

  Either way, polled every 30 seconds; the last status is cached and marked *offline* when a poll fails.
- **Arrival estimate ("ETA"):** two sources, used automatically when they apply:
  1. *From the alert feed (always available).* How the alert area has been spreading between polls (which oblast went active most recently, how long ago, and the distance to your pinned oblast), at a speed you choose per threat type (an editable table: Shahed-type drone, cruise missile, ballistic missile).
  2. *From a live track (when "Live tracks" is on and one points at you).* See below — it uses the track's own position, heading and a per-type speed instead of guessing from alert spread, which is usually a tighter, more specific estimate.

  Whichever is sooner is shown, as a ±30% range, labelled with where it came from ("from the alert feed", "from a live jet-powered drone track", …), and only while something fresh enough is still plausible — it disappears rather than show a number that would already be overdue. You can also mark a threat by hand (an oblast and "as of saving now"), for a tip from a channel you follow. A dashed line on the map shows what the shown estimate is based on.
- **Live tracks (optional, off by default, unofficial):** individual drone/missile markers (type, heading, status) from [kudyletyt.com](https://www.kudyletyt.com/) (Telegram channel [t.me/kudy_letyt](https://t.me/kudy_letyt)), an independent volunteer project built from public monitoring channels — not alerts.in.ua, not affiliated with VEGA. Its API (`api.kudyletyt.com/tracks`) needs no key and answers with `Access-Control-Allow-Origin: *`, but the project publishes no formal terms of use, so this stays an opt-in, best-effort source: turn it on in *Configure…*, which asks its own optional host permission. A track only drives the estimate when it is `active` and its heading points within 45° of your pinned oblast; an arrow on the map shows every track regardless, fainter once it is no longer active. This note will be updated, or the feature adjusted or removed, if the project's maintainers (reachable via the Telegram channel) ask for that.
- **Trip planner:** save places with the minutes you need to get there; each gets a *comfortable* / *tight* / *won't make it* badge against the current estimate (the pessimistic end of the range, on purpose). It is planning advice, not a safety instruction.
- **Notifications:** an optional browser notification (and an optional short sound) the moment a *pinned* oblast turns active, once per activation. Both are off by default; enabling asks the ordinary browser notification permission, not a WebExtension one.
- **Settings (`cfg`):** `source` (`alertsinua` | `kudyletyt`), `token`, `pinned` (oblast ids, up to 6), `focus`, `threat`, `speeds` (editable table), `useTracks`, `trackSpeeds` (editable table: propeller/jet-powered/fast attack drone), `manualFrom`/`manualSetAt`, `places` (name + minutes), `notify`, `sound`, `name`.
- **Data:** the alerts API (token-gated, polled every 30 s) and, if enabled, the tracks API (polled every 20 s); great-circle maths from built-in oblast centre coordinates otherwise. Cached in `hud.alerts` (`{ oblast, tracks }`).
- **Permissions:** optional host `https://api.alerts.in.ua/*`, asked when you save a token (if that is your source); optional host `https://api.kudyletyt.com/*`, asked if you choose it as your source, or if you turn on live tracks (one permission covers both).
- **Size:** default 5×4, min 3×3, max 8×8. The map hides on very short tiles (`@container`); the status line and the estimate stay.
- **Known limits, stated plainly:** the map is schematic (centroids, not real borders) until VEGA has a licensed boundary source for all 27 oblasts. The kudyletyt.com alert source and live tracks both come from the same unofficial, volunteer-run project with no formal terms, and can be late, incomplete or wrong; the kudyletyt.com alert source also cannot see partial (sub-oblast) alerts, only whole-oblast ones. Without a usable track on course the estimate falls back to alert spread and a speed you pick. Either way it ignores routing, altitude, manoeuvres, and alerts that start with no warning; a ballistic threat leaves minutes or none at all. In-memory alert and track history resets on reload (the current status survives, the history does not). **It is a planning aid, never a safety source — always follow the official alert and the sirens.** The widget repeats this in its own text.


### More outage sources 📋
Automatic schedules for more regions, as separate adapters behind the same widget.
- **Custom JSON URL:** point a tile at any URL that serves a documented JSON format (for example a community mirror or your own script). Needs an optional host permission for that host.
- **Operator adapters:** added only where the operator or a maintained open-data project publishes a stable, permitted feed. Requests for permission or an API go to the site owners first.
- **Config:** `source: "json"`, `url`, `group`.

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

### Ambient sounds: recorded loops 💡
Birds, city and café loops from files you add yourself (kept in IndexedDB like local wallpapers) or from CC0 loops listed with their licences. The synthesised mixer is already shipped.

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
- [x] Clock styles and alignment (7 styles, per-tile settings)
- [x] Links settings per tile (layout, columns, markers, groups, quick add)
- [x] World clocks
- [x] Countdown
- [x] Rates (NBU, monobank, crypto)
- [x] Ambient sounds

**0.6.0**
- [x] Air-raid alerts widget: schematic map with the chosen oblast(s) in focus, the alerts.in.ua feed, a spread-based arrival estimate, a trip planner, notifications
- [x] Air-raid alerts: optional live tracks from kudyletyt.com (unofficial, opt-in)
- [ ] Air-raid alerts: a real boundary map (licensed oblast/raion polygons)

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
- [ ] Quick capture
- [ ] More integrations (GitLab, Linear, Todoist, Notion, ...)
- [ ] Ambient sounds: recorded loops
- [ ] Radio and music player (internet radio, local songs)
- [ ] Wallpaper presets (postponed)
- [ ] In-page link editor (not a widget, but unlocks per-tile link lists)

---

## How a widget is built

1. **Register the size limits** in `META` in `grid.js`: `def`, `min`, `max` as `[w, h]`. Add the title in `strings.js` (`mod.<type>`).
2. **Implement `MODULES.<type>.render(body, ctx)`** in `app.js`. `ctx` gives you `it` (the tile: `id`, `cfg`, size), `setStatus(text|Node)` for the right side of the header, `setTitle(text)` for a custom tile name, and `editing`. Put pure logic (settings validation, formatting, maths) in `widgets.js` so the tests can cover it without a DOM.
   It may return any of these hooks:

   | Hook | When it runs |
   | --- | --- |
   | `tick()` | every second (global ticker) |
   | `refresh()` | when shared data changed (`refresh('<type>')`) |
   | `resize()` | after the tile was resized |
   | `commit()` | before the tile is removed or moved: flush pending input |
   | `destroy()` | when the tile is torn down: clear timers |
   | `enter()` | the user pressed `Enter` on the tile; focus your first control. Return `false` if there is nothing to go inside. |
   | `configure()` | the tile has settings: shows *Configure…* in the tile menu and the command bar. Use `cfgModal()`, the field helpers (`fld`, `mkSel`, `mkChk`, `mkText`), `listEditor()` for add/remove lists and `applyCfg()` to store the result in `it.cfg`. |

3. **Persistence.** Per-tile configuration goes in `it.cfg`. Per-tile data goes in `state.data[it.id]` (it follows the tile through moves and undo). Shared data goes in a top-level key of `state`. Everything is additive: extend `normalize()` in `state.js` with safe defaults and never drop unknown fields.
4. **Layout.** The tile body is a size container. Use `@container` queries in `style.css` and check the minimum and maximum sizes. Add the widget to the size matrix when you test.
5. **Keyboard parity.** Every action needs a keyboard path. Implement `enter()` and handle arrows/`h j k l` inside the widget; `Esc` leaving is handled for you.
6. **Colours.** Use theme tokens only (`var(--accent)`, …). Literal colours are rejected by the tests.
7. **Network.** Request host permissions at runtime (`optional_permissions`/optional hosts), only when the widget is enabled, and document it in the README permissions table.
8. **Tests and docs.** Add smoke tests, add the widget here (settings, sizes, data, permissions), and tick it off in the checklist.
