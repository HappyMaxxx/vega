/* Runs synchronously in <head>, before first paint, so the saved theme never flashes.
   Also exposes VEGA.applyTheme() for live changes. Classic script, no inline code (extension CSP). */
(function (g) {
  'use strict';
  var V = g.VEGA = g.VEGA || {};
  var lum = function (hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  // WCAG contrast ratio of two #rrggbb colours
  V.contrast = function (a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  V.applyTheme = function (theme, accent) {
    var d = document.documentElement;
    d.setAttribute('data-theme', theme || 'gruvbox');
    if (/^#[0-9a-f]{6}$/i.test(accent || '')) {
      d.style.setProperty('--accent', accent);
      d.style.setProperty('--on-accent', lum(accent) > 0.3 ? 'var(--ink-dark)' : 'var(--ink-light)');
    } else {
      d.style.removeProperty('--accent');
      d.style.removeProperty('--on-accent');
    }
  };
  try {
    var s = JSON.parse(g.localStorage.getItem('hud.v1')).settings || {};
    V.applyTheme(s.theme, s.accent);
  } catch (e) { V.applyTheme(); }
})(globalThis);
