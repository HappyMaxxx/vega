# Contributing to VEGA

Thanks for helping. VEGA is a small, dependency-free project, and a few rules keep it that way.

## Setup

```
git clone https://github.com/HappyMaxxx/vega.git
cd vega
npm install     # dev only: jsdom for the tests
npm test
```

There is no build step. Edit the files and reload the page (open `index.html`, or load the folder as an unpacked extension).

## Rules

- **Vanilla HTML, CSS and JavaScript.** No frameworks, no bundlers, no runtime dependencies. The extension must keep working when `index.html` is opened directly.
- **Extension CSP.** No inline scripts, no inline event handlers, no remote scripts or fonts. System font stacks only.
- **Hotkeys use `event.code`** (physical keys), never `event.key` for letters, so they work in every keyboard layout.
- **Keyboard parity.** Every mouse action needs a keyboard path and the other way round.
- **Strings live in `strings.js`.** No user-visible text elsewhere.
- **All UI text is English.** Labels, menus, region names, errors and docs. Cyrillic is allowed only where it is functional (parsing keywords, API values, the keyboard-layout map).
- **Colours come from theme tokens.** Literal colours belong only in `themes.css` (and user data). Every theme must keep WCAG AA contrast for text; the tests check it.
- **Data changes are additive.** Extend `normalize()` in `state.js`, keep old data working, never drop unknown fields, never wipe user data. Storage keys do not change.
- **Performance.** A new tab must render instantly from `localStorage`. No work that delays first paint. Respect `prefers-reduced-motion`.
- **Permissions.** Do not add a required permission. Anything that needs a new host or API is optional and requested at runtime, only when the feature is enabled, and listed in the README permissions table.
- **No personal data in the repo.** Default links, fixtures and examples must be generic. A test fails if known personal strings appear.

## Adding a widget

Follow [How a widget is built](docs/WIDGETS.md#how-a-widget-is-built) and update the widget reference and checklist in the same pull request.

## Tests

`npm test` runs the smoke tests (grid engine, migration of saved data, moves and undo, keyboard modes, theme contrast, release hygiene). Add a test with every behaviour change. When you fix a bug, add the test that would have caught it.

## Pull requests

Keep them small and focused, and describe what you changed and how you checked it. If you change the look, attach a screenshot in at least one dark and one light theme. If you change the data model, say how old data is migrated.

## Releases

Bump `version` in `manifest.json` (every release needs a new version), add an entry to `CHANGELOG.md`, and build the zip with `manifest.json` at the root (no parent folder, no `.git`, no `tests/`). Keep `browser_specific_settings.gecko.data_collection_permissions` and the add-on id unchanged.
