# AegisEO as a single container for Hugging Face Spaces (Docker SDK): the FastAPI service
# serves both the API and the built web UI on port 7860. Storage is SQLite inside the
# container, so analyses are lost when the Space restarts (use docker-compose for persistence).
FROM node:22-alpine AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx vite build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
# libexpat1: required at runtime by the GDAL bundled in the rasterio wheels (absent from -slim)
RUN apt-get update && apt-get install -y --no-install-recommends curl libexpat1 \
    && rm -rf /var/lib/apt/lists/*
# Spaces run containers as uid 1000
RUN useradd --create-home --uid 1000 user

WORKDIR /app/backend
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu
COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt
COPY backend/pyproject.toml ./pyproject.toml
COPY backend/aegis ./aegis
COPY backend/scripts ./scripts
COPY models /app/models
COPY docs/figures /app/docs/figures
COPY --from=web /app/dist /app/frontend/dist
RUN mkdir -p /home/user/data && chown -R user:user /home/user /app

USER user
# The Space page embeds the app in a frame on huggingface.co.
ENV AEGIS_DATA_DIR=/home/user/data AEGIS_TORCH_DEVICE=cpu AEGIS_ENVIRONMENT=production \
    AEGIS_FRAME_ANCESTORS=https://huggingface.co AEGIS_WORKER_THREADS=2
EXPOSE 7860
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD curl -fsS http://127.0.0.1:7860/api/health || exit 1
CMD ["uvicorn", "aegis.main:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers", "--forwarded-allow-ips", "*"]
