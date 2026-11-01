"""Test configuration.

Tests are hermetic by default: an isolated data directory, offline mode (no network), CPU
inference. Tests that touch real public APIs are marked ``network`` and skipped unless
``--network`` is given.
"""

from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="aegis-tests-"))
os.environ["AEGIS_DATA_DIR"] = str(_TMP)
os.environ["AEGIS_OFFLINE"] = "true"
os.environ["AEGIS_TORCH_DEVICE"] = "cpu"
os.environ["AEGIS_ENVIRONMENT"] = "test"
os.environ.pop("AEGIS_DATABASE_URL", None)
os.environ.pop("AEGIS_AUTH_ENABLED", None)
os.environ["AEGIS_ANTHROPIC_API_KEY"] = ""

import pytest  # noqa: E402

from aegis.config import REPO_ROOT, get_settings  # noqa: E402
from aegis.db import init_db  # noqa: E402

MODELS_PRESENT = (REPO_ROOT / "models" / "gated_fusion_unet.pt").exists()


def pytest_addoption(parser):
    parser.addoption("--network", action="store_true", default=False, help="run tests that call real public APIs")


def pytest_collection_modifyitems(config, items):
    if config.getoption("--network"):
        return
    skip = pytest.mark.skip(reason="needs --network")
    for item in items:
        if "network" in item.keywords:
            item.add_marker(skip)


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(scope="session", autouse=True)
def _db():
    init_db()
    yield


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture(scope="session")
def flood_scene():
    from aegis.synthetic import SyntheticConfig, make_scene

    return make_scene(SyntheticConfig(hazard="flood", seed=7))
