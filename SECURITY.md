# Security policy

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Please report security problems privately through GitHub: **Security → Report a vulnerability** on this repository. Do not open a public issue for a vulnerability.

Include what you found, how to reproduce it, and which version and browser you used. You can expect an acknowledgement within a few days.

## Scope notes

- VEGA stores data only in your browser (`localStorage`, and IndexedDB for a local wallpaper) and sends nothing to a server of its own. The only required network access is the weather lookup to `api.open-meteo.com`.
- Tokens for future optional widgets are stored locally and sent only to the service they belong to.
- Optional permissions (`tabs`, `bookmarks`, `history`, `sessions`) are requested only when you enable the related feature.
