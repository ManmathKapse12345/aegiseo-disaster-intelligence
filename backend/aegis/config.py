"""Application configuration (environment-driven, validated with pydantic-settings).

Every setting can be overridden with an environment variable prefixed ``AEGIS_``
(for example ``AEGIS_DATABASE_URL``) or through a ``.env`` file in the repository root.
Secrets are typed as ``SecretStr`` so they never appear in logs or reprs.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AEGIS_",
        env_file=(str(REPO_ROOT / ".env"),),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    environment: Literal["development", "test", "production"] = "development"
    app_name: str = "AegisEO"

    # --- storage -----------------------------------------------------------------
    data_dir: Path = REPO_ROOT / "data"
    models_dir: Path = REPO_ROOT / "models"
    database_url: str | None = Field(default=None, description="SQLAlchemy URL; defaults to SQLite in data_dir")

    # --- API / security ----------------------------------------------------------
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"
    # Origins allowed to embed the UI in a frame (e.g. "https://huggingface.co"); empty = no framing
    frame_ancestors: str = ""
    auth_enabled: bool = False
    # "token=name:role" pairs separated by ';'  (roles: viewer, analyst, admin)
    api_tokens: SecretStr = SecretStr("")
    rate_limit_per_minute: int = 240

    # --- processing --------------------------------------------------------------
    worker_threads: int = 2
    max_aoi_km2: float = 1500.0
    min_aoi_km2: float = 0.25
    default_resolution_m: float = 20.0
    max_grid_pixels: int = 2_600_000
    run_timeout_s: float = 1800.0
    mc_dropout_samples: int = 6
    torch_device: Literal["auto", "cpu", "cuda"] = "auto"
    # Deployed water model. "auto" = the configuration selected on the validation split by
    # `python -m aegis.ml.evaluate` (models/selection.json); set explicitly to override.
    model_variant: str = "auto"
    sar_specialist: str = "auto"  # variant name, "auto", or "" to disable the hybrid SAR specialist

    def deployed_model(self) -> tuple[str, str | None]:
        import json

        variant, specialist = self.model_variant, self.sar_specialist
        sel_path = self.models_dir / "selection.json"
        sel: dict = {}
        if "auto" in (variant, specialist) and sel_path.exists():
            try:
                sel = json.loads(sel_path.read_text())
            except ValueError:
                sel = {}
        if variant == "auto":
            variant = sel.get("model_variant", "gated_fusion_unet")
        if specialist == "auto":
            specialist = sel.get("sar_specialist", "s1_unet") if sel else "s1_unet"
        return variant, (specialist or None)

    # --- external data sources -----------------------------------------------------
    offline: bool = Field(default=False, description="Disable network access; serve only cached data")
    http_timeout_s: float = 30.0
    http_retries: int = 3
    user_agent: str = "AegisEO/1.0 (disaster-intelligence research prototype)"
    stac_url: str = "https://planetarycomputer.microsoft.com/api/stac/v1"
    pc_sas_url: str = "https://planetarycomputer.microsoft.com/api/sas/v1/token"
    overpass_urls: str = (
        "https://overpass-api.de/api/interpreter,"
        "https://overpass.kumi.systems/api/interpreter,"
        "https://overpass.private.coffee/api/interpreter"
    )
    worldpop_stats_url: str = "https://api.worldpop.org/v1/services/stats"
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    # place-name search (OpenStreetMap Nominatim; usage policy: <= 1 request/s, identifying User-Agent)
    nominatim_url: str = "https://nominatim.openstreetmap.org/search"
    gdacs_url: str = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
    usgs_feed_url: str = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
    firms_public_url: str = "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv"
    firms_api_url: str = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
    firms_map_key: SecretStr = SecretStr("")

    # --- optional LLM narrative ----------------------------------------------------
    anthropic_api_key: SecretStr = SecretStr("")
    llm_model: str = "claude-opus-5-5"
    llm_enabled: bool = True

    # --- outbound notification (only fires for human-approved alerts) --------------
    alert_webhook_url: SecretStr = SecretStr("")

    @field_validator("data_dir", "models_dir", mode="before")
    @classmethod
    def _expand(cls, v: str | Path) -> Path:
        return Path(v).expanduser().resolve()

    # --- derived -----------------------------------------------------------------
    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'aegis.db').as_posix()}"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def artifacts_dir(self) -> Path:
        return self.data_dir / "artifacts"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def overpass_url_list(self) -> list[str]:
        return [u.strip() for u in self.overpass_urls.split(",") if u.strip()]

    @property
    def token_table(self) -> dict[str, tuple[str, str]]:
        """Parse ``AEGIS_API_TOKENS`` into ``{token: (user, role)}``."""
        table: dict[str, tuple[str, str]] = {}
        raw = self.api_tokens.get_secret_value()
        for pair in raw.split(";"):
            pair = pair.strip()
            if not pair or "=" not in pair:
                continue
            token, ident = pair.split("=", 1)
            user, _, role = ident.partition(":")
            table[token.strip()] = (user.strip() or "user", (role.strip() or "viewer").lower())
        return table

    @property
    def llm_available(self) -> bool:
        return self.llm_enabled and bool(self.anthropic_api_key.get_secret_value()) and not self.offline

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.cache_dir, self.artifacts_dir, self.models_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings


def reset_settings_cache() -> None:
    """Used by tests that change environment variables."""
    get_settings.cache_clear()
