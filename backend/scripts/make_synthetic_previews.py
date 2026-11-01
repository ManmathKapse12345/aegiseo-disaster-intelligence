"""Render preview images of the simulated scenes (post-event true colour) for the UI cards.

    python scripts/make_synthetic_previews.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from aegis.synthetic import SyntheticConfig, make_scene

OUT = Path(__file__).resolve().parents[2] / "frontend" / "public" / "images"
SCENES = {
    "synthetic-flood": SyntheticConfig(hazard="flood", seed=7, cloud_cover_post=0.3),
    "synthetic-flood-cloudy": SyntheticConfig(hazard="flood", seed=11, cloud_cover_post=0.9),
    "synthetic-wildfire": SyntheticConfig(hazard="wildfire", seed=3, cloud_cover_post=0.1),
    "synthetic-landslide": SyntheticConfig(hazard="landslide", seed=3, cloud_cover_post=0.1),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, cfg in SCENES.items():
        obs = make_scene(cfg).bundle.get("S2", "post")
        rgb = np.stack([obs.bands["B04"], obs.bands["B03"], obs.bands["B02"]], axis=-1)
        img = (np.clip(np.nan_to_num(rgb) * 3.0, 0, 1) ** (1 / 1.2) * 255).astype(np.uint8)
        Image.fromarray(img).resize((640, 640), Image.LANCZOS).save(OUT / f"{name}.jpg", quality=85)
        print("wrote", name)


if __name__ == "__main__":
    main()
