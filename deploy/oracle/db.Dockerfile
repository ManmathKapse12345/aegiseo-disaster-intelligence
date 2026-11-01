# PostGIS for ARM64 hosts (the postgis/postgis images are amd64-only): official Postgres
# image plus the PostGIS package from the PGDG repository it already configures.
FROM postgres:16-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-16-postgis-3 \
    && rm -rf /var/lib/apt/lists/*
