"""Render the "how it works" explainer images from a completed real-data analysis.

The UI explains the method with four real panels from one analysis: the satellite photo
before the event, the photo after it, the change the system detected, and the response
priority squares it produced. Everything comes from the analysis' own artefacts and
database rows - nothing is drawn by hand - and the dates are written to
``frontend/public/images/credits.json`` (attribution) and ``frontend/src/data/explainer-images.json``
(read by the UI).

    python scripts/make_explainer_images.py <analysis_id> [--prefix explain-sindh-2022]

Run it with the same ``AEGIS_DATA_DIR`` as the API that produced the analysis.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from sqlalchemy import select

from aegis.config import get_settings
from aegis.db import Analysis, PriorityCell, session_scope

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "images"
PRIORITY_RGB = {"Critical": (198, 40, 40), "High": (239, 108, 0), "Moderate": (233, 179, 8), "Low": (42, 157, 143)}  # docs/design.md
WIDTH = 720


def _lonlat_to_px(corners: list[list[float]], size: tuple[int, int]):
    """Bilinear inverse of the overlay corners (TL, TR, BR, BL) - exact for the small, axis-aligned AOIs used here."""
    (x0, y0), (x1, _), (_, y1), _ = corners
    w, h = size

    def f(lon: float, lat: float) -> tuple[float, float]:
        return (lon - x0) / (x1 - x0) * w, (y0 - lat) / (y0 - y1) * h

    return f


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("analysis_id")
    ap.add_argument("--prefix", default="explain-sindh-2022")
    args = ap.parse_args()

    layers_dir = get_settings().artifacts_dir / args.analysis_id / "layers"
    meta = {m["id"]: m for m in json.loads((layers_dir / "layers.json").read_text())}
    for need in ("s2_pre_rgb", "s2_post_rgb", "affected"):
        if need not in meta:
            raise SystemExit(f"layer '{need}' missing - choose a completed flood analysis with Sentinel-2 before and after")

    def load(lid: str) -> Image.Image:
        return Image.open(layers_dir / f"{lid}.png").convert("RGBA")

    before, after, affected = load("s2_pre_rgb"), load("s2_post_rgb"), load("affected")
    scale = WIDTH / before.width
    size = (WIDTH, round(before.height * scale))

    def flat(im: Image.Image) -> Image.Image:
        bg = Image.new("RGBA", im.size, (238, 236, 230, 255))
        return Image.alpha_composite(bg, im).convert("RGB").resize(size, Image.LANCZOS)

    # change: the after photo, slightly muted, with the detected extent in strong blue
    a = np.asarray(affected).astype(np.float32)
    mask = (a[..., 3] > 0).astype(np.float32)[..., None]
    base = np.asarray(Image.alpha_composite(Image.new("RGBA", after.size, (238, 236, 230, 255)), after).convert("RGB")).astype(np.float32)
    muted = base * 0.62 + 255 * 0.38
    blue = np.array([24, 92, 214], np.float32)
    change = muted * (1 - mask * 0.82) + blue * mask * 0.82
    change_im = Image.fromarray(change.clip(0, 255).astype(np.uint8)).resize(size, Image.LANCZOS)

    # priorities: response squares coloured by category over the muted after photo
    with session_scope() as s:
        a_row = s.get(Analysis, args.analysis_id)
        if a_row is None:
            raise SystemExit("analysis not found in this database")
        cells = s.scalars(select(PriorityCell).where(PriorityCell.analysis_id == args.analysis_id)).all()
        rows = [(c.override_category or c.category, c.geometry) for c in cells]
        name = a_row.name
    prio = Image.fromarray(muted.clip(0, 255).astype(np.uint8)).resize(size, Image.LANCZOS).convert("RGBA")
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    to_px = _lonlat_to_px(meta["affected"]["corners"], size)
    for cat, geom in rows:
        ring = geom["coordinates"][0]
        pts = [to_px(lon, lat) for lon, lat in ring]
        r, g, b = PRIORITY_RGB[cat]
        draw.polygon(pts, fill=(r, g, b, 120), outline=(r, g, b, 235))
    prio = Image.alpha_composite(prio, layer).convert("RGB")

    OUT.mkdir(parents=True, exist_ok=True)
    outputs = {"before": flat(before), "after": flat(after), "change": change_im, "priorities": prio}
    for key, im in outputs.items():
        im.save(OUT / f"{args.prefix}-{key}.jpg", quality=84, optimize=True, progressive=True)

    credits_path = OUT / "credits.json"
    credits = json.loads(credits_path.read_text()) if credits_path.exists() else {}
    year = meta["s2_post_rgb"]["date"][:4]
    credits[args.prefix] = {
        "analysis": name,
        "before_date": meta["s2_pre_rgb"]["date"][:10],
        "after_date": meta["s2_post_rgb"]["date"][:10],
        "panels": list(outputs),
        "credit": f"Contains modified Copernicus Sentinel data {year}; detection and priorities computed by AegisEO",
    }
    credits_path.write_text(json.dumps(credits, indent=2) + "\n")
    # the UI reads dates and credit from src/ (Vite cannot import JSON from public/)
    ui_data = OUT.parents[1] / "src" / "data" / "explainer-images.json"
    ui_data.parent.mkdir(parents=True, exist_ok=True)
    ui_data.write_text(json.dumps({args.prefix: credits[args.prefix]}, indent=2) + "\n")
    print(json.dumps(credits[args.prefix], indent=2))


if __name__ == "__main__":
    main()
