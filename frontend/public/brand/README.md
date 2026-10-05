# Novatio brand assets

## Seal — the invariant

The mark states the product's invariant: **one invoice, one writer.** Three
invoice lines converge on a gate and exactly one path emerges, carrying the
value. That is single-writer deduplication — the property that makes a
receivable impossible to pledge twice, and the reason the product is not just
another Canton demo.

## Wordmark — the name

Extruded 3D "NOVATIO" in Orbitron Bold. The name IS the logo — at first glance
anyone seeing it reads the product identity directly. The extrusion (depth 14
font units, yaw 18°, pitch 10°) conveys seriousness and value transfer.

Chosen over two other drafted concepts (a novation arc, an opposing-arrow DvP
mark) because it spells the product name and the favicon is where the mark
appears most and smallest — the seal handles the favicon, the wordmark handles
the name.

### Files

| File | Purpose |
|---|---|
| `novatio-mark.svg` | The seal, source of truth. 64-unit viewBox, one file scales from 16px favicon to 2048px master. |
| `novatio-mark-dark.svg` | Same geometry with paper strokes, for the ink panels used throughout the dashboard. An ink mark on an ink panel is invisible. |
| `novatio-mark-mono.svg` | Two-tone flat variant. At 16px the green gate crowds the ink lines, so favicons use this. |
| `novatio-wordmark.svg` | The 3D wordmark, source of truth. 1200×630 viewBox, one file scales from banner to 2048px master. |
| `novatio-wordmark-2048.png`, `-dark-2048.png` | Raster masters, 2048px. |
| `novatio-banner.svg` / `../novatio-banner.png` | 1200x630 social card. Band plan documented in the SVG's header comment. |
| `../favicon-{16,32,48,180}.png` | Browser-requested favicon sizes and apple-touch. |

## Palette

Taken from `frontend/src/index.css` hex-for-hex, so the brand and the product
are unambiguously the same thing:

| Token | Hex | Used for |
|---|---|---|
| `gold` | `#A8853A` | the value being transferred; accents |
| `gold-soft` | `#C9A75C` | gradient start; descriptors; front faces |
| `ink` | `#0B1F3A` | primary strokes; dark panels |
| `accent` | `#1E4D3A` | the gate / bound that holds the invariant |
| `paper` | `#F6F3EC` | backgrounds; dark-variant strokes |

## Geometry rules

### Seal
- 4.5-unit strokes on a 64-unit viewBox: ≥1.5 units at 16px, so strokes hold
  at favicon size instead of filling in.
- No interior detail under ~4 units.
- Rectangular, not circular: the mark stays a crisp square tile in a browser
  tab rather than a dot, which is why the old circular `.brand-mark` border was
  removed from `index.css`.

### Wordmark
- Orbitron Bold: geometric sans-serif, wide-spaced, reads "technical".
- Extrusion depth 14 font units; camera yaw 18°, pitch 10°.
- Flat shading in world space: front faces lit (#C9A75C), walls mid (#A8853A),
  back darkest (#2B3A55). Light from front-right-above.
- Painter's sort by view-space z; no transparency, no gradients.

## Rendering

`google-chrome --headless` caps SVG screenshots at ~512px of content and pads
the rest of the window with white, so a `--window-size=2048,2048` screenshot is
NOT a 2048px render. Render at 512 and upscale with LANCZOS, then check the
content bounding box before trusting any master. The wordmark master was
rendered at `--force-device-scale-factor=2` (content 1042×1060px) and
upscaled to 2048px — verified with 125,421 hard edges.