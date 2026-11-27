# Fixtures

`v0.1.0-customized.json` has the exact structure written by the 0.1.0 build (default layout, moved and resized tiles,
tasks, a note keyed by tile id, edited links, an extra workspace). The content (link names, URLs, tasks, notes, place)
is sanitised placeholder data. Tests load it through `normalize()` to prove that data saved by old builds survives upgrades.
