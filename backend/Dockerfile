# AegisEO API - build from the repository root:  docker build -f backend/Dockerfile -t aegis-api .
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1

# libexpat1: required at runtime by the GDAL bundled in the rasterio wheels (absent from -slim)
RUN apt-get update && apt-get install -y --no-install-recommends curl libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# The image mirrors the repository layout (/app/backend, /app/models, /app/docs) because
# paths such as the model directory are resolved relative to the repository root.
WORKDIR /app/backend
# CPU-only PyTorch keeps the image small; inference on CPU takes seconds per scene.
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/pyproject.toml ./pyproject.toml
COPY backend/aegis ./aegis
COPY backend/scripts ./scripts
# trained checkpoints, metrics and the validation-based model selection
COPY models /app/models
COPY docs/figures /app/docs/figures

RUN useradd --create-home --uid 10001 aegis && mkdir -p /data && chown -R aegis:aegis /data /app
USER aegis

ENV AEGIS_DATA_DIR=/data AEGIS_TORCH_DEVICE=cpu AEGIS_ENVIRONMENT=production
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1
# One process: analysis jobs run on an in-process worker pool (see README "Scaling").
CMD ["uvicorn", "aegis.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
