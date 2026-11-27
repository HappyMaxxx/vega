/* VEGA UI strings (English). Every user-visible string lives here so other languages can be added
   later by swapping this object. Functions take parameters. */
(function (g) {
'use strict';
const S = {
  lang: 'en', locale: 'en-GB',

  // modules
  mod: { clock: 'clock', weather: 'weather', timer: 'focus', tasks: 'tasks', notes: 'notes', links: 'links' },
  addModule: 'Add',
  moduleWord: 'module',

  // generic
  close: 'Close', cancel: 'Cancel', save: 'Save', undo: 'Undo', saved: 'Saved',

  // tiles
  tileRemoved: 'Tile removed',
  tileDelete: 'Delete tile',
  tileMenu: 'Tile menu',
  tileDuplicate: 'Duplicate',
  tileMoveItem: (name) => `Move to ${name}`,
  tileResetSize: 'Reset size',
  tileMoveTo: 'Move to workspace',
  tileMoved: (name) => `Tile moved to "${name}"`,
  tileMovedFull: (name) => `Tile moved to "${name}" (placed below, no free slot)`,
  tileDuplicated: 'Tile duplicated',
  tileSizeReset: 'Size reset',
  wsNone: (n) => `No workspace ${n}`,
  tilesPacked: 'Tiles packed',
  nothingToUndo: 'Nothing to undo',
  moveTileCmd: 'Move tile to workspace…',
  moveTileTo: (name) => `Move tile to ${name}`,

  // workspaces
  wsLabel: 'Workspaces', wsTitle: (n) => `Workspace ${n}`, wsNewTitle: 'New workspace',
  wsDefaultName: 'new',
  wsCreated: 'New workspace. Press A to add a module.',
  wsRenamePrompt: 'Workspace name',
  wsNeedOne: 'At least one workspace is required',
  wsDeleteConfirm: (name) => `Delete workspace "${name}" and its tiles?`,
  wsEmptyTitle: 'Nothing here yet',
  wsEmptyHint: 'Add a module, or press A',

  // modes
  modeResize: 'resize: h j k l, Esc', modeEdit: 'edit', modeInside: 'inside: Esc to leave',

  // timer
  timerStart: 'start', timerPause: 'pause', timerReset: 'reset', timerNext: 'skip',
  timerResetTitle: 'Reset', timerNextTitle: 'Switch between focus and break',
  timerFocus: 'focus', timerBreak: 'break', pageTitle: 'Home',
  timerFocusDone: 'Focus session finished. Time for a break.', timerBreakDone: 'Break finished.',

  // clock / weather
  dayPassed: (p) => `${p}% of the day has passed`,
  wxTitle: 'Click to refresh',
  wxNoData: 'No weather data',
  wxRetry: 'Check your connection and click to retry',
  wxFeels: (t, w) => `feels like ${t}, wind ${w} m/s`,
  wxStale: ' (stale)',
  wx: { clear: 'clear', mostlyClear: 'mostly clear', partly: 'partly cloudy', cloudy: 'cloudy', fog: 'fog', drizzle: 'drizzle', rain: 'rain', snow: 'snow', showers: 'showers', snowShowers: 'snow showers', storm: 'thunderstorm' },

  // tasks / notes / links
  taskPlaceholder: 'new task, Enter', taskNew: 'New task', taskDone: 'Toggle done', taskDelete: 'Delete',
  taskDeleteAria: 'Delete task', taskAdded: 'Task added',
  tasksEmpty: 'Nothing here yet. Add a task above, or press / and type "+ text".',
  tasksOpen: (n) => `${n} open`,
  notesPlaceholder: 'notes…', notesLabel: 'Notes',
  linksEmpty: 'No links here. Add some in settings (comma key).',
  linksTabPick: 'Which tab to show', linksAll: 'all',

  // palette
  palettePlaceholder: 'Links, commands, "! g query", "+ task"', paletteLabel: 'Search and commands',
  cmdWs: (name) => 'Workspace: ' + name, cmdAdd: (name) => 'Add: ' + name,
  cmdEdit: 'Edit mode', cmdPack: 'Auto-pack tiles', cmdTimerToggle: 'Timer: start or pause', cmdTimerReset: 'Timer: reset',
  cmdNewWs: 'New workspace', cmdRenameWs: 'Rename workspace', cmdDeleteWs: 'Delete workspace',
  cmdDeleteTile: 'Delete focused tile', cmdDuplicateTile: 'Duplicate focused tile', cmdResetSize: 'Reset focused tile size', cmdUndo: 'Undo',
  cmdSettings: 'Settings and links', cmdHelp: 'Keyboard shortcuts', cmdExport: 'Export data (JSON)', cmdImport: 'Import data (JSON)',
  cmdPerms: 'Allow tabs, bookmarks and history', cmdTheme: (name) => 'Theme: ' + name,
  hintExt: 'extension',
  addTask: (t) => 'Add task: ' + t, hintTasks: 'tasks',
  searchIn: (n, q) => `Search ${n}: ${q}`, openUrl: (q) => 'Open ' + q, hintAddr: 'address',
  kindTab: 'tab', kindBookmark: 'bookmark', kindHistory: 'history',
  permsGranted: 'Granted. Open search again.', permsDenied: 'Permission not granted', permsFail: 'Could not request permissions',

  palFoot: [['↑ ↓', 'select'], ['Enter', 'run'], ['Ctrl+Enter', 'new tab'], ['Esc', 'close']],

  // bar
  hintSearch: 'search', hintKeys: 'keys',

  // help
  helpTitle: 'Keyboard shortcuts', or: ' or ',
  helpRows: [
    [['/', 'Ctrl+K'], 'Search links, commands and tabs. "! g text" searches Google, "+ text" adds a task'],
    [['h j k l', 'arrows'], 'Move focus between tiles'],
    [['Shift + h j k l'], 'Move the focused tile'],
    [['Shift + 1 – 9'], 'Send the focused tile to workspace N'],
    [['r'], 'Resize mode: h narrower, l wider, k shorter, j taller. Esc exits'],
    [['e'], 'Edit mode: grid, tile menus, link tab picker'],
    [['m'], 'Menu of the focused tile (delete, duplicate, move, reset size)'],
    [['Enter'], 'Go inside the focused tile: type in notes, walk through tasks and links with arrows or h j k l. Esc comes back'],
    [['a'], 'Add a module'],
    [['x', 'z'], 'Delete the focused tile, undo (up to 20 steps)'],
    [['1 – 9'], 'Switch workspace'],
    [['Space'], 'Start or pause the timer when its tile is focused'],
    [[','], 'Settings, themes, links, export and import'],
    [['Esc'], 'Close a dialog or leave a mode'],
    [['Mouse'], 'Drag a tile by its header, resize from the corner, drop it on a workspace below to move it'],
  ],
  helpFoot: 'Keys are matched by physical position, so they work in any keyboard layout.',

  // data
  exported: 'Saved hud-home.json', imported: 'Data imported', importBad: 'This does not look like a hud-home.json file',

  // settings
  settingsTitle: 'Settings',
  setWeather: 'Weather', setPlace: 'City (label)', setLat: 'Latitude', setLon: 'Longitude',
  setTimerSearch: 'Timer and search', setFocusMin: 'Focus, min', setBreakMin: 'Break, min', setEngine: 'Default search engine',
  setBg: 'Background', setBgUrl: 'Image or video URL (optional)',
  setBgFile: 'Local file', bgPick: 'Choose file…', bgRemoveFile: 'Remove', bgFileNone: 'none',
  setBgFit: 'Fit', bgFits: { cover: 'Fill the screen (crop edges)', contain: 'Fit inside (no cropping)', actual: 'Actual size (no scaling)' },
  setBgSharpen: 'Sharpen enlarged images',
  bgTooBig: 'File is larger than 300 MB', bgStoreFail: 'Could not store the file', bgLoadFail: 'Background could not be loaded',
  bgProbing: 'Checking…', bgUnknown: 'Cannot read the size of this file',
  bgInfo: (w, h, sw, sh, scale) => `Source ${w}×${h}, screen ${sw}×${sh} (device pixels). ` + (scale > 1.05
    ? `It is enlarged ${scale.toFixed(1)}×, so it will look soft. Use at least ${sw}×${sh}.` : 'Large enough: it stays sharp.'),
  bgVideoNote: 'Video plays muted and loops; it pauses when the tab is hidden.',
  setLinks: 'Links (JSON)', setLinksAria: 'Links as JSON',
  setLinksBad: 'Links: invalid JSON. Expected an array of groups {tab, name, links}.',
  setData: 'Data', export: 'Export', import: 'Import', resetAll: 'Reset everything',
  resetConfirm: 'Reset layout, tasks and links to defaults?',
  setAppearance: 'Appearance', accentLow: 'Low contrast on this theme',
  setNewTab: 'New tab',
  setFocusPage: 'Focus the page, not the address bar',
  setFocusForget: 'Hide the helper tab from "recently closed" (asks for the sessions permission)',
  focusNote: 'Works by re-opening the new tab once, so it may flicker briefly. Hotkeys then work immediately.',
  popupOpen: 'Open VEGA', popupSettings: 'Settings',
  setTheme: 'Theme', setAccent: 'Accent colour', accentAuto: 'Theme colour', accentReset: 'Reset accent',
  setLinkTheme: 'Use theme colours for link dots',
  themes: { gruvbox: 'Gruvbox Material', tokyo: 'Tokyo Night', mocha: 'Catppuccin Mocha', nord: 'Nord', rose: 'Rosé Pine', paper: 'Paper (light)', arc: 'Arc Reactor' },
};
(g.VEGA = g.VEGA || {}).S = S;
if (typeof module !== 'undefined' && module.exports) module.exports = S;
})(typeof globalThis !== 'undefined' ? globalThis : this);
