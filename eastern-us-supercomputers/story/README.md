# The Counter Map — scrollytelling story

Open `story.html` (served over http, e.g. `python3 -m http.server`).

| Change… | Edit |
|---|---|
| Text, chapter order, timeline spans, cameras, which layers show | `chapters.js` |
| How a layer looks or animates, add a new layer | `layers.js` (add an entry to `LAYERS`, then use its id in a chapter) |
| Colors, fonts, spacing, pins, HUD | `story.css` (tokens at the top) |
| Scroll mechanics, cursor lens, zones canvas | `engine.js` |

Dev helpers: `story.html?chapter=4` jumps to chapter 4; add `&debug` to see chapter, step, progress, year and zoom.

Each chapter holds its first/last 14% at its start/end year (`HOLD` in engine.js), so timelines have clear starts and stops.
Soft zones are illustrative unless a chapter's note says otherwise; approximate geometry is labeled on the map.

After editing any story file, bump the version so browsers don't keep a cached copy:
`sed -i '' -E 's/2026-10-28l/NEW/g' index.html story/engine.js story/layers.js` (or any find/replace of the tag).
