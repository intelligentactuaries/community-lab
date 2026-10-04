#!/usr/bin/env python3
"""Community Lab IDE's application icons, from the brand mark (../../brand).

    python3 desktop/scripts/make-icons.py

Writes desktop/resources/icons/{icon.png (1024), icon.ico, icon.icns} from
brand/community-lab_C<version>.svg, rasterised with cairosvg (the brand
generator's own dependency) and packed with Pillow. Regenerate the mark first
when the version's major.minor changes:

    python3 brand/generate_logo.py --version 0.2
"""
import io, json, os, sys

import cairosvg
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "desktop", "resources", "icons")

version = json.load(open(os.path.join(ROOT, "desktop", "package.json")))["version"]
tag = ".".join(version.split(".")[:2]).replace(".", "_")
svg_path = os.path.join(ROOT, "brand", f"community-lab_C{tag}.svg")
if not os.path.exists(svg_path):
    sys.exit(f"{svg_path} is missing: run  python3 brand/generate_logo.py --version {'.'.join(version.split('.')[:2])}")
svg = open(svg_path, "rb").read()


def raster(px: int) -> Image.Image:
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg, output_width=px, output_height=px))).convert("RGBA")


os.makedirs(OUT, exist_ok=True)
big = raster(1024)
big.save(os.path.join(OUT, "icon.png"))
# Windows: every size the shell asks for, each rasterised at its own size (not scaled down from 1024).
ico_sizes = [16, 24, 32, 48, 64, 128, 256]
raster(256).save(os.path.join(OUT, "icon.ico"), sizes=[(s, s) for s in ico_sizes])
# macOS
big.save(os.path.join(OUT, "icon.icns"))
for name in ("icon.png", "icon.ico", "icon.icns"):
    p = os.path.join(OUT, name)
    print(f"wrote {p} ({os.path.getsize(p):,} bytes)")
