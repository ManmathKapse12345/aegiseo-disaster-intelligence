"""Render the UI's hero and case-study images from real Sentinel-2 L2A acquisitions.

Each image is a true-colour composite of the clearest acquisition in a window, produced
with the platform's own readers. Output goes to frontend/public/images with a JSON file
recording the item ids and dates for attribution
("contains modified Copernicus Sentinel data <year>").

    python scripts/make_images.py [name ...]     # all images, or only the named ones
"""

from __future__ import annotations

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

from aegis.geo.aoi import AOI
from aegis.geo.grid import Grid
from aegis.sources.imagery import ImageryReader
from aegis.sources.stac import PlanetaryComputer

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "images"
U = UTC
JOBS = [
    # name, bbox, window start, window end, resolution m, output width
    ("hero-sindh-2022", (67.45, 26.45, 68.25, 26.80), datetime(2022, 9, 5, tzinfo=U), datetime(2022, 9, 12, tzinfo=U), 60, 1800),
    ("case-sindh-2022", (67.62, 26.56, 67.96, 26.80), datetime(2022, 9, 5, tzinfo=U), datetime(2022, 9, 12, tzinfo=U), 40, 640),
    ("case-emilia-2023", (11.74, 44.45, 12.04, 44.61), datetime(2023, 5, 20, tzinfo=U), datetime(2023, 5, 28, tzinfo=U), 30, 640),
    ("case-derna-2023", (22.55, 32.69, 22.73, 32.79), datetime(2023, 9, 12, tzinfo=U), datetime(2023, 9, 22, tzinfo=U), 20, 640),
    ("case-palisades-2025", (-118.66, 34.01, -118.46, 34.12), datetime(2025, 1, 14, tzinfo=U), datetime(2025, 2, 5, tzinfo=U), 20, 640),
    ("case-wayanad-2024", (76.08, 11.42, 76.22, 11.54), datetime(2024, 8, 1, tzinfo=U), datetime(2024, 12, 31, tzinfo=U), 20, 640),
]


def render(bands: dict[str, np.ndarray]) -> np.ndarray:
    rgb = np.stack([bands["B04"], bands["B03"], bands["B02"]], axis=-1)
    rgb = np.nan_to_num(rgb, nan=0.0)
    # percentile stretch on valid pixels for a natural, bright look
    valid = rgb.sum(axis=-1) > 0
    lo, hi = np.percentile(rgb[valid], 1) if valid.any() else 0.0, np.percentile(rgb[valid], 99.2) if valid.any() else 1.0
    out = np.clip((rgb - lo) / max(hi - lo, 1e-6), 0, 1) ** (1 / 1.25)
    return (out * 255).astype(np.uint8)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    pc = PlanetaryComputer()
    rd = ImageryReader(pc)
    only = set(sys.argv[1:])
    credits_path = OUT / "credits.json"
    credits = json.loads(credits_path.read_text()) if only and credits_path.exists() else {}
    for name, bbox, start, end, res, width in JOBS:
        if only and name not in only:
            continue
        aoi = AOI.from_bbox(*bbox)
        grid = Grid.for_aoi(aoi, res, 6_000_000)
        mask = grid.aoi_mask(aoi)
        acqs = [a for a in pc.find_acquisitions("S2", aoi, start, end, max_cloud=30) if a.aoi_coverage > 0.9]
        if not acqs:
            print(f"[skip] {name}: no clear acquisition", flush=True)
            continue
        best = min(acqs, key=lambda a: a.cloud_cover if a.cloud_cover is not None else 100)
        obs = rd.read_s2(best, grid, "post", mask)
        img = Image.fromarray(render(obs.bands))
        img = ImageEnhance.Contrast(ImageEnhance.Color(img).enhance(1.12)).enhance(1.05)
        h = int(img.height * width / img.width)
        img = img.resize((width, h), Image.LANCZOS)
        img.save(OUT / f"{name}.jpg", quality=86, optimize=True, progressive=True)
        credits[name] = {"date": best.datetime.date().isoformat(), "items": [i.id for i in best.items],
                         "credit": f"Contains modified Copernicus Sentinel data {best.datetime.year}"}
        print(f"[ok] {name}: {best.datetime.date()} cloud {best.cloud_cover} -> {width}x{h}", flush=True)
    credits_path.write_text(json.dumps(credits, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
