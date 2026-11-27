# Changelog

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
