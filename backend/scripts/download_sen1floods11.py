"""Download the hand-labelled subset of Sen1Floods11 (Bonafilia et al., 2020).

Only the Python standard library is used so the script can run before the
backend's dependencies are installed.

What is downloaded (from the public GCS bucket ``sen1floods11``, version v1.1):
  * official hand-labelled split lists (train / valid / test / bolivia)
  * per chip: S1Hand (VV, VH in dB), S2Hand (13-band L1C TOA x 10000),
    LabelHand (-1 nodata, 0 not-water, 1 water) and JRCWaterHand (permanent water)

Robustness features:
  * resumable - files that already exist with the expected size are skipped
  * atomic writes - data is written to ``*.part`` and renamed when complete
  * size verification against the HTTP Content-Length header
  * retries with exponential back-off and jitter
  * a manifest (``manifest.json``) with source URL, size and SHA-256 per file

Usage::

    python scripts/download_sen1floods11.py --out ../data/datasets/sen1floods11
"""

from __future__ import annotations

import argparse
import concurrent.futures as cf
import csv
import hashlib
import io
import json
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

BASE_URL = "https://storage.googleapis.com/sen1floods11/v1.1"
SPLITS = {
    "train": "splits/flood_handlabeled/flood_train_data.csv",
    "valid": "splits/flood_handlabeled/flood_valid_data.csv",
    "test": "splits/flood_handlabeled/flood_test_data.csv",
    "bolivia": "splits/flood_handlabeled/flood_bolivia_data.csv",
}
LAYERS = ("S1Hand", "S2Hand", "LabelHand", "JRCWaterHand")
USER_AGENT = "DisasterIntel-dataset-fetcher/1.0 (+research prototype)"


def _request(url: str, timeout: float = 60.0, method: str = "GET") -> urllib.request.Request:
    return urllib.request.Request(url, method=method, headers={"User-Agent": USER_AGENT})


def fetch_bytes(url: str, retries: int = 5, timeout: float = 60.0) -> bytes:
    """GET a URL into memory with retries (used for the small split CSVs)."""
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(_request(url), timeout=timeout) as resp:
                return resp.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:  # pragma: no cover - network
            last_err = exc
            time.sleep(min(30.0, (2**attempt) + random.random()))
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


def download_file(url: str, dest: Path, retries: int = 6, timeout: float = 120.0) -> dict:
    """Download ``url`` to ``dest`` atomically; returns a manifest record."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(_request(url), timeout=timeout) as resp:
                expected = int(resp.headers.get("Content-Length", "-1"))
                if dest.exists() and expected > 0 and dest.stat().st_size == expected:
                    resp.close()
                    return {"url": url, "path": str(dest), "bytes": expected, "sha256": _sha256(dest), "skipped": True}
                part = dest.with_suffix(dest.suffix + ".part")
                digest = hashlib.sha256()
                size = 0
                with open(part, "wb") as fh:
                    while True:
                        chunk = resp.read(1 << 16)
                        if not chunk:
                            break
                        fh.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                if expected > 0 and size != expected:
                    raise OSError(f"size mismatch for {url}: got {size}, expected {expected}")
                part.replace(dest)
                return {"url": url, "path": str(dest), "bytes": size, "sha256": digest.hexdigest(), "skipped": False}
        except (OSError, urllib.error.URLError, TimeoutError, ConnectionError) as exc:  # pragma: no cover - network
            last_err = exc
            time.sleep(min(60.0, (2**attempt) + random.random()))
    raise RuntimeError(f"failed to download {url}: {last_err}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def chip_ids_for_split(rel_path: str) -> list[str]:
    raw = fetch_bytes(f"{BASE_URL}/{rel_path}").decode("utf-8")
    ids = []
    for row in csv.reader(io.StringIO(raw)):
        if not row:
            continue
        # rows look like "Ghana_103272_S1Hand.tif,Ghana_103272_LabelHand.tif"
        name = row[0].strip()
        if not name.endswith("_S1Hand.tif"):
            continue
        ids.append(name[: -len("_S1Hand.tif")])
    return ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True, help="output directory")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--limit", type=int, default=0, help="max chips per split (0 = all); for smoke tests")
    args = parser.parse_args(argv)

    out: Path = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    splits: dict[str, list[str]] = {}
    for split, rel in SPLITS.items():
        ids = chip_ids_for_split(rel)
        if args.limit:
            ids = ids[: args.limit]
        splits[split] = ids
        print(f"[split] {split}: {len(ids)} chips", flush=True)
    (out / "splits.json").write_text(json.dumps(splits, indent=2))

    jobs = []
    for ids in splits.values():
        for chip in ids:
            for layer in LAYERS:
                url = f"{BASE_URL}/data/flood_events/HandLabeled/{layer}/{chip}_{layer}.tif"
                jobs.append((url, out / layer / f"{chip}_{layer}.tif"))

    records, failures = [], []
    started = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(download_file, url, dest): url for url, dest in jobs}
        for i, fut in enumerate(cf.as_completed(futures), 1):
            try:
                records.append(fut.result())
            except Exception as exc:  # pragma: no cover - network
                failures.append({"url": futures[fut], "error": str(exc)})
            if i % 100 == 0 or i == len(jobs):
                mb = sum(r["bytes"] for r in records) / 1e6
                print(f"[progress] {i}/{len(jobs)} files, {mb:.0f} MB, {time.time() - started:.0f}s", flush=True)

    manifest = {
        "dataset": "Sen1Floods11 v1.1 (hand-labelled subset)",
        "citation": (
            "Bonafilia, D., Tellman, B., Anderson, T., Issenberg, E. 2020. Sen1Floods11: a georeferenced "
            "dataset to train and test deep learning flood algorithms for Sentinel-1. CVPR Workshops, pp. 210-211."
        ),
        "source": BASE_URL,
        "downloaded_at": datetime.now(UTC).isoformat(),
        "files": sorted(records, key=lambda r: r["path"]),
        "failures": failures,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"[done] {len(records)} files ok, {len(failures)} failed", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
