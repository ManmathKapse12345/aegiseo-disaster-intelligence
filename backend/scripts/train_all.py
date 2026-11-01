"""Reproduce all models and the evaluation report in one command.

    python scripts/train_all.py --data ../data/datasets/sen1floods11_prepared --models ../models

Each variant trains in its own subprocess (clean GPU memory between runs) with the same
budget (epochs, crops, optimiser) so that comparisons are fair. Output is appended to
``<models>/training_log.txt``.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

VARIANTS = ["gated_fusion_unet", "early_fusion_unet", "s1_unet", "s2_unet"]


def run(cmd: list[str], log_path: Path) -> int:
    with open(log_path, "a", encoding="utf-8") as log:
        log.write(f"\n$ {' '.join(cmd)}\n")
        log.flush()
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            sys.stdout.write(line)
            log.write(line)
            log.flush()
        return proc.wait()


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--models", type=Path, required=True)
    p.add_argument("--variants", nargs="*", default=VARIANTS)
    p.add_argument("--epochs", type=int, default=None)
    p.add_argument("--skip-eval", action="store_true")
    a = p.parse_args()
    a.models.mkdir(parents=True, exist_ok=True)
    log = a.models / "training_log.txt"
    t0 = time.time()
    for v in a.variants:
        cmd = [sys.executable, "-m", "aegis.ml.train", "--variant", v, "--data", str(a.data), "--out", str(a.models)]
        if a.epochs:
            cmd += ["--epochs", str(a.epochs)]
        if run(cmd, log) != 0:
            print(f"training failed for {v}", file=sys.stderr)
            return 1
    if not a.skip_eval:
        if run([sys.executable, "-m", "aegis.ml.evaluate", "--data", str(a.data), "--models", str(a.models)], log) != 0:
            return 1
    print(f"all done in {(time.time() - t0) / 60:.1f} min")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
