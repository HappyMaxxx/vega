# Changelog

## 0.6.0

Existing data is kept: every new setting is optional.

### Added
- **Air-raid alerts widget (Ukraine).** Pin up to 6 oblasts and see their live alert status on a schematic map — click a circle to pin or unpin it. A rough, honestly-ranged arrival estimate derives from how the alert area has been spreading between polls, at a speed you pick per threat type; you can also mark a threat point and time by hand. A trip planner compares the estimate against places you might go (*comfortable* / *tight* / *won't make it*). Optional browser notification and sound when a pinned oblast turns active.
- **Choice of alert status source, per tile.** The official [alerts.in.ua](https://alerts.in.ua/) API (a personal token, stored only in your browser; whole-oblast *and* partial status), or [kudyletyt.com](https://www.kudyletyt.com/) (no token; an independent, volunteer-run mirror of the same feed, whole-oblast status only — see *Known limitations*).
- **Live tracks (optional, off by default).** The alerts widget can also show individual drone/missile tracks from kudyletyt.com. A track heading your way sharpens the estimate and draws its own line on the map; turning it on (or choosing kudyletyt.com as the alert source) asks a shared permission.
- Every configurable tile's *Configure…* now has a consistent list-editor pattern for add/remove rows (places, custom sounds, events, zones), shared across widgets.

### Changed
- New optional host permission `https://api.alerts.in.ua/*`, asked only when alerts.in.ua is your source and you save a token.
- New optional host permission `https://api.kudyletyt.com/*`, asked only if you choose kudyletyt.com as your source or turn on live tracks.
- New cache key `hud.alerts` (the last known oblast statuses and, if enabled, tracks — no personal data).

### Known limitations
- The alerts map is schematic (oblast centre points, not traced borders): VEGA has no licensed boundary data for all 27 oblasts yet.
- kudyletyt.com (both as an alert source and for live tracks) is an unofficial, volunteer-run project with no formal terms; its data can be late, incomplete or wrong, and the feature may be adjusted if its maintainers ask. As an alert source it also only detects whole-oblast alerts, not partial ones.
- It is a planning aid, not a safety source. Always follow the official alert and the sirens.

## 0.5.0

Existing data is kept: every new setting is optional and the defaults look exactly like before.

### Added
- **Rename workspaces in place.** Double-click a workspace tab (or press `F2`) and type, like a sheet tab. `Enter` saves, `Esc` cancels.
- **Clock styles.** *Configure…* on a clock tile: Standard, Large, Minimal, Stacked, Analog, Binary or Words, with left/centre/right and top/middle/bottom alignment, font weight, date format, 12/24-hour time, seconds and the day-progress bar. Each clock has its own settings.
- **Links settings per tile.** Layout (columns, one column, chips), number of columns, alignment, marker (dot, first letter, none), text size, heading colour, group names on/off, open in a new tab, and a hand-picked set of groups. The same dialog can add a link to a group.
- **World clocks.** Several time zones on one tile with the difference from your time. Add and remove zones, rename them, choose 12/24-hour time.
- **Countdown.** Days, or days/hours/minutes, until your dates. Yearly events, optional time, sorting, hide past events.
- **Rates.** Three sources per tile: official National Bank of Ukraine rates (with the change since the previous day), monobank **buy / sell** prices, and **crypto** (Binance best bid / ask and 24-hour change). Choose the currencies or coins, the base or quote currency, the amount and the decimals. Works from a cache when offline.
- **Ambient sounds.** Real recordings of rain, thunderstorm, wind in the woods, ocean, stream and birds, birdsong and a fireplace (public domain / CC0, streamed from archive.org only while playing), plus white, pink and brown noise generated in the browser. One slider each; add your own sounds by link (an audio file or a radio stream). Sleep timer with a fade-out, optional "play while the focus timer runs". The sound keeps playing when you switch workspace.
- **Tile names.** Every configurable tile can have its own title.

### Changed
- New optional host permissions for the rates widget: `https://bank.gov.ua/*`, `https://api.monobank.ua/*`, `https://data-api.binance.vision/*`. Nothing new is required at install.
- New cache key `hud.rates` (exchange rates and prices). It holds no personal data and can be deleted at any time.
- The air-raid alerts widget (map with your region in focus, plus an arrival estimate) moves to 0.6.0 as a single widget.

## 0.4.0

Existing data is kept. This release adds the outages widget, city search for the weather, and fixes the toolbar menu opening duplicate tabs.

### Added
- **Outages widget.** Shows whether the power is on, a live countdown to the next change, and today's and tomorrow's schedule on a 24-hour bar, in a layout that adapts to the tile size. Three sources: *bezsvitla.com.ua* (every region of Ukraine; find your queue by street and house, or enter it manually), *Yasno* (Kyiv and Dnipro) and *Paste a schedule* (any region). Schedules are cached, so the tile works offline. Each tile has its own name, so you can add several (for example *Home* and *Work*). Set up from the tile menu (*Configure…*), with `Enter` on an unconfigured tile, or from the command bar.
- **Per-tile setup:** *Configure…* in the tile menu and the command bar for widgets that have settings.
- **City search** in Settings: find a city by name and fill the weather location. The geocoding host is an optional permission, asked on first use.
- Video wallpapers show duration, size and bitrate (local files) and warn about 4K.
- README: widget screenshots, wallpaper examples, permissions and data tables. `docs/WIDGETS.md`: outages shipped; ambient sounds, radio/music player, more outage sources and wallpaper presets recorded as planned.

### Fixed
- The toolbar button's *Settings* and *Open VEGA*, and the add-ons *Preferences* page, now reuse an open VEGA tab instead of always opening a new one. No extra permission is needed.

### Changed
- All interface text is English.
- Minimum Firefox version is now 140 (needed for optional host permissions and for the data-collection declaration). `web-ext lint`: 0 errors, 0 warnings.
- New optional host permissions: `https://bezsvitla.com.ua/*`, `https://geocoding-api.open-meteo.com/*` and `https://app.yasno.ua/*`. Nothing new is required at install.

### Known issues and follow-ups
- Schedules depend on third-party sites. If one changes its page format, use *Paste a schedule* until the adapter is updated.
- Local wallpapers are not included in JSON exports.
- "Focus the page on a new tab" still needs a check on your own Firefox.

## 0.3.0

Existing data is kept: layout, tasks, notes and links load unchanged, and links saved by earlier builds keep their own colours.

### Added
- **Go inside a tile from the keyboard.** `Enter` on a tile goes inside it, `Esc` comes back. Notes get the caret; tasks and links are walked with arrows or `h j k l` (`Space` ticks a task, `x` removes it, `Enter` opens a link, `Ctrl+Enter` opens it in a new tab); the timer's buttons are reached with left/right.
- **Wallpapers.** The background is now a real image/video element: fit modes (fill, fit inside, actual size), MP4/WebM/OGV by URL (muted, looping, pauses when hidden, respects reduced motion), and local files of up to 300 MB stored in IndexedDB. Settings reports the source size against your screen in device pixels and warns when an image will be enlarged and look soft. Optional edge sharpening for enlarged still images.
- **Settings from the toolbar button and from the add-ons Preferences page.**
- **Focus the page on a new tab (Firefox)**, optional, in Settings. An optional second switch hides the helper tab from "recently closed" (asks for the optional `sessions` permission).
- `docs/WIDGETS.md` (widget reference and checklist), `CONTRIBUTING.md`, `SECURITY.md`, a new README with screenshots.
- `Referrer-Policy: no-referrer` for wallpaper requests, so more image hosts accept them.

### Changed
- Default link groups and the default weather location are now neutral. Dots follow the theme for new installs; existing data keeps its colours.
- Test fixture content is placeholder data, and a test fails if personal strings enter the repository.
- Video wallpapers turn off the tile blur (it is expensive over moving video).

### Known issues and follow-ups
- Local wallpapers are not included in JSON exports.
- "Focus the page" works by re-opening the tab, so it can flicker briefly. It could not be verified inside the browser's own address bar in automated tests; try it on your Firefox.
- `web-ext lint` reports 0 errors and 2 warnings: `data_collection_permissions` is officially supported from Firefox 140, while the minimum version stays 115.
- Stacked narrow layout still has no drag, resize or keyboard move.
- Links are still edited as JSON (an in-page editor is planned).

## 0.2.0

Existing data is kept: the layout, tasks, notes and links saved by 0.1.0 load unchanged. Before the first run after the update, the old data is copied to `localStorage['hud.v1.backup']`. The storage keys and the Firefox add-on id are unchanged.

### Added
- Extension icon (compass star with HUD corner brackets) in 16, 32, 48, 96 and 128 px, also used as the page favicon.
- **Themes** in Settings: Gruvbox Material (default), Tokyo Night, Catppuccin Mocha, Nord, Rosé Pine, Paper (light), Arc Reactor. Swatch cards with live preview, optional accent colour, and a switch to colour link dots from the theme. The theme is applied before first paint. Every theme passes WCAG AA (enforced by tests).
- **Tile menu** (hover or keyboard focus, or `m`): delete, duplicate, move to workspace, reset size. Hover close button.
- **Move tiles between workspaces**: `Shift+1`–`9`, the menu, the command bar, or drag a tile onto a workspace button. Identity, settings, size and notes are kept; the tile takes the first free slot (or lands below when the target is full). Undoable.
- **Undo stack** (20 steps) for delete, duplicate, reset size and moves.
- Empty workspaces show add-module buttons. Command bar has a key-hint footer.
- Tests (`npm test`): grid engine, migration of real 0.1.0 data, moves and undo, theme contrast, release hygiene.

### Changed
- **UI language is English** (all strings in `strings.js`). Fresh installs get English default group names; existing data is untouched.
- Visual redesign: quieter HUD, 4 px tiles, longer corner brackets on the focused tile, opaque tiles (blur only with a background image).
- Clock, weather and timer re-layout by tile size down to the minimum. The timer has four layouts (ring and time, ring beside time, time only, compact buttons).
- Below ~700 px wide, tiles stack in one column. This is display only; the saved layout is never changed.
- Notes of a deleted tile move into its undo entry instead of staying behind.

### Fixed
- "null" shown in toasts; the "4 4" workspace button; tiles flying in from the corner on every workspace switch.
- Deleting a workspace now removes its tiles' notes.
- Unknown tile types are kept in the data instead of being dropped.
- `--dim` text failed AA contrast.

### Known issues and follow-ups
- Undo lives in memory. If you delete a tile and close the tab before undoing, that tile's notes are gone (the layout itself is saved). The `hud.v1.backup` copy is only taken on update, import and reset.
- Verified as a plain page in Chromium and Firefox, and as an unpacked Manifest V3 extension in Chromium. A signed Firefox build and `web-ext lint` have not been run.
- In Firefox the minus sign in the weather temperature falls back to a wider glyph.
- The ring-beside timer layout shows an empty ring (time is next to it).
- Stacked narrow layout has no drag, resize or keyboard move. Touch drag is not supported.
- Links are still edited as JSON (planned: in-page editor).
- No in-app language switch yet (strings are centralised for it).
- Palette ranking: workspace and tile commands could be ranked or grouped better.
