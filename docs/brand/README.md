# Brand mark

An italic "s" with a red full stop: the full stop that ends a story. The "s" is Newsreader Italic converted to outlines, so the files need no font.

| Colour | Hex |
|---|---|
| Black (field) | `#0B0B0B` |
| White ("s") | `#FFFFFF` |
| Red (full stop) | `#E1251B` |

## Files
- `logo.svg`: master artwork (512 units), used for `public/favicon.svg` and the 192 and 512 px PNGs.
- `logo-small.svg`: small-size artwork for the 16, 32 and 48 px images in `public/favicon.ico`. It uses a heavier weight, and the full stop is snapped to the 16 px grid (3×3 px, resting on the baseline) so it stays crisp in a browser tab.

## Icons in `public/`
- `favicon.ico`: 16, 32 and 48 px.
- `favicon.svg`
- `apple-touch-icon.png`: 180 px, full-bleed (iOS rounds the corners itself).
- `icon-192.png` and `icon-512.png`
- `icon-maskable-512.png`: artwork kept inside the 80% safe zone.
- `site.webmanifest`

The tags live in `src/components/Favicons.astro`, which the public layout and the admin pages include.
