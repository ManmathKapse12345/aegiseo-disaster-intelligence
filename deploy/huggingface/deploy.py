"""Deploy the committed code to a Hugging Face Space (Docker SDK).

Uploads exactly what is in git HEAD (no data/, .env or caches), with this folder's Dockerfile
and README.md (the Space card) placed at the Space root. Authentication uses the token saved
by `hf auth login` (or the HF_TOKEN environment variable); the token is never printed.

    python deploy/huggingface/deploy.py <space-name> [--private]
"""

from __future__ import annotations

import argparse
import io
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("space", help="Space name, e.g. aegiseo (created under your account if missing)")
    ap.add_argument("--private", action="store_true", help="create the Space as private")
    args = ap.parse_args()

    api = HfApi()
    user = api.whoami()["name"]
    repo_id = args.space if "/" in args.space else f"{user}/{args.space}"
    api.create_repo(repo_id, repo_type="space", space_sdk="docker", private=args.private, exist_ok=True)

    archive = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=REPO, check=True, capture_output=True).stdout  # noqa: S607 - git from PATH
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            tar.extractall(root, filter="data")
        shutil.copy(HERE / "Dockerfile", root / "Dockerfile")
        shutil.copy(HERE / "README.md", root / "README.md")
        # keep the Space's own .gitattributes (Hub storage rules for binary files such as checkpoints)
        (root / ".gitattributes").unlink(missing_ok=True)
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO, check=True, capture_output=True, text=True).stdout.strip()  # noqa: S607
        api.upload_folder(repo_id=repo_id, repo_type="space", folder_path=root, commit_message=f"Deploy {commit}",
                          delete_patterns=["backend/**", "frontend/**", "docs/**", "models/**", "deploy/**"])
    print(f"Uploaded to https://huggingface.co/spaces/{repo_id} - the Space builds itself (about 10 minutes).")


if __name__ == "__main__":
    main()
