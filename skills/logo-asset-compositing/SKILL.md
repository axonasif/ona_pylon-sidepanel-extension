---
name: logo-asset-compositing
description: Source official logo assets, rasterize SVGs cleanly, remove edge artifacts, and compose app or extension icons from multiple brand marks. Use when Codex needs to update or create repo-scoped icons, favicons, extension icons, or branded composite marks and must avoid white fringes, bad centering, or low-quality reused rasters.
---

# Logo Asset Compositing

Create or update icon assets using official brand sources whenever possible.

## Use this workflow

1. Find the official source asset first.
2. Prefer SVG over PNG.
3. Keep the primary brand mark dominant unless the user explicitly wants a co-branded or playful treatment.
4. Treat old raster icons as fallback/reference material only.

## Working rules

- Prefer official media-kit or site-served SVG assets over screenshots or old PNGs.
- Do not rely on browser thumbnail generation for final icon output.
- Rasterize SVGs with a proper renderer so transparency stays clean.
- If a logo will be composited inside or on top of another mark, build the clean base icon first and get that approved before adding overlays.
- Preserve transparency in the final exported icons.
- For tiny sizes such as `16x16`, check legibility separately; a composition that works at `128x128` may fail when reduced.

## Recommended workflow

### 1. Source the asset

- Inspect the official website, media kit, or network requests for the real logo asset URL.
- Save the exact source URL in notes or commit messages when it matters.
- If the user asks for a specific variant like "black symbol", "white symbol", or "wordmark", use that exact official variant instead of recoloring another asset.

### 2. Build a clean base icon

- Render the official SVG directly to PNG with a proper renderer.
- Avoid macOS Quick Look thumbnails or similar shortcuts for final assets; they can introduce:
  - white backgrounds
  - misaligned crops
  - white anti-aliased edge halos
- Verify:
  - transparent background
  - no white fringe pixels
  - centered composition
  - appropriate fill of the output canvas

### 3. Composite secondary marks

- If adding a partner/product badge, use an official vector source for that mark too.
- Resize and place the secondary mark intentionally:
  - corner overlay if the primary mark should remain dominant
  - inset/inside-hole placement only if the user wants a more playful treatment
- Do not let the secondary mark visually replace the primary mark unless explicitly requested.

### 4. Export final icon sizes

- Generate the largest master first, then downscale to the required sizes.
- For browser extension icons, the common set is:
  - `16x16`
  - `48x48`
  - `128x128`
- Recheck the smallest size visually.

## Project lessons from this repo

- The Ona official black symbol from `https://ona.com/media` was the right base source.
- The old extension icon was useful only as a reference for the historical Pylon badge treatment, not as a trustworthy source for clean pixels.
- Quick Look thumbnail rendering caused white edge artifacts and poor crop behavior.
- CairoSVG produced a clean transparent raster from the official SVG and avoided the fringe problem.
- The clean base icon should be approved before reintroducing a partner badge.

## Tools that worked well

- Browser DevTools / network inspection:
  - to locate official SVG asset URLs on vendor sites
- Python virtualenv in `/tmp`:
  - safe place to install one-off imaging dependencies
- `cairosvg`:
  - for clean SVG to PNG rasterization
- Pillow:
  - for resizing, cropping, masking, and compositing

## Minimal implementation pattern

Read [references/process.md](references/process.md) for the detailed step-by-step process and example commands.

