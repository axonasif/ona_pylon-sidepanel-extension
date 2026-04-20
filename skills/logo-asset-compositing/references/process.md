# Logo Asset Compositing Process

This reference documents the exact process that worked well while iterating on this repo's extension icon.

## Goal

Build clean co-branded icons without:

- white fringe pixels
- accidental white backgrounds
- off-center logos
- oversized overlays that obscure the primary brand

## Step-by-step process

### 1. Find the official vector asset

For Ona:

- media page exposed:
  - `https://ona.com/ona-symbol-black.svg`

For Pylon:

- homepage network request exposed the logo SVG
- for the playful inset treatment, extracting the official symbol path from the homepage SVG was preferable to reusing the old raster badge

## 2. Avoid thumbnail-based rasterization for final output

What failed:

- rendering with macOS Quick Look and then trying to cut out the icon

Problems observed:

- white pixels at the edges
- wrong crop / alignment
- baked white background

## 3. Use a temp virtualenv when needed

This worked well:

```bash
python3 -m venv /tmp/ona-icon-venv
/tmp/ona-icon-venv/bin/pip install Pillow cairosvg
```

Why:

- keeps the repo clean
- avoids adding image-processing dependencies to the project itself
- makes it easy to script multiple previews quickly

## 4. Rasterize SVGs with CairoSVG

Pattern:

```python
import cairosvg

cairosvg.svg2png(
    url="/tmp/source.svg",
    write_to="/tmp/output.png",
    output_width=128,
    output_height=128,
)
```

This produced a transparent, edge-clean PNG where Quick Look did not.

## 5. Verify transparency and bounding box

Useful check with Pillow:

```python
from PIL import Image

img = Image.open("/tmp/output.png").convert("RGBA")
print(img.getchannel("A").getbbox())
```

If needed, also count suspicious white opaque pixels:

```python
count = 0
for y in range(img.height):
    for x in range(img.width):
        r, g, b, a = img.getpixel((x, y))
        if a and r > 240 and g > 240 and b > 240:
            count += 1
print(count)
```

## 6. Compose overlays with Pillow

Typical pattern:

```python
from PIL import Image, ImageDraw

base = Image.open("/tmp/base-icon.png").convert("RGBA")
badge = Image.open("/tmp/badge.png").convert("RGBA")

badge = badge.resize((46, 46), Image.Resampling.LANCZOS)
base.alpha_composite(badge, (78, 78))
base.save("/tmp/composed.png")
```

For circular masks:

```python
mask = Image.new("L", badge.size, 0)
ImageDraw.Draw(mask).ellipse((0, 0, badge.size[0]-1, badge.size[1]-1), fill=255)
base.paste(badge, (x, y), mask)
```

## 7. Review at both large and tiny sizes

Always inspect:

- the preview/master icon, e.g. `128x128`
- the actual tiny extension icon, e.g. `16x16`

Reason:

- a composition can look balanced at `128x128` and collapse at `16x16`

## 8. Iterate in this order

The most reliable design iteration sequence was:

1. get the primary brand mark clean
2. confirm centering and transparency
3. add the secondary badge or inset treatment
4. review at small sizes
5. only then write final files

This reduced churn significantly compared with iterating on a flawed base asset.

## Suggested prompt pattern for future use

Use this skill to source official SVG logos, rasterize them cleanly, and create a transparent co-branded icon set for this repo without white edge artifacts.

