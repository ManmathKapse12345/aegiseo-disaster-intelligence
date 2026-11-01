# HTTP API

Interactive OpenAPI documentation is served by the backend at `/docs` (Swagger UI) and
`/openapi.json`. All endpoints are under `/api` except `/metrics`.

**Conventions**: JSON bodies validated strictly (unknown fields rejected); errors use one envelope
`{"error": {"code", "message", "details?", "request_id"}}`; every response carries `X-Request-ID`.
When `AEGIS_AUTH_ENABLED=true`, send `Authorization: Bearer <token>`; roles: `viewer` (read),
`analyst` (create analyses, review decisions, overrides), `admin` (delete, benchmarks). Mutating
requests are rate-limited per client (`AEGIS_RATE_LIMIT_PER_MINUTE`, HTTP 429 + `Retry-After`).

## System

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/health/ready` | Database, model and job-pool readiness (503 if the DB is down) |
| GET | `/metrics` | Prometheus metrics (requests, latency, tool calls, guardrails, jobs, external calls) |
| GET | `/api/me` | Current identity and role |
| GET | `/api/sources?refresh=` | Data-source catalogue with live health (cached 5 min) |
| GET | `/api/events/live` | Current GDACS alerts and USGS M5.5+ earthquakes (cached 10 min) |
| GET | `/api/scenarios` | Curated real and synthetic case studies |
| POST | `/api/catalog/preview` | Sentinel-1/2 acquisitions for a bbox and windows (search only) |
| GET | `/api/dashboard` | Aggregates: analyses, real-data impact, priorities, review backlog, agent metrics, activity |
| GET | `/api/model` | Deployed model, training summaries, full evaluation, figures |
| GET | `/api/knowledge`, `/api/knowledge/search?q=` | Knowledge base documents / RAG retrieval |
| GET, POST | `/api/benchmarks`, `/api/benchmarks/run`, `/api/benchmarks/{id}` | Agent benchmark runs (admin to start) |

## Analyses

| Method | Path | Description |
|---|---|---|
| POST | `/api/analyses` | Create and queue a run (`name`, `hazard`, `mode`, `bbox` or `aoi`, `event_date`, optional windows, `resolution_m`, `weights`, `detection`, `synthetic`, `scenario_id`) |
| GET | `/api/analyses?status=&hazard=&mode=&limit=&offset=` | List |
| GET | `/api/analyses/{id}` | Detail incl. results, observations, reports, open counts |
| GET | `/api/analyses/{id}/status` | Lightweight progress (stage, %, recent agent steps) |
| POST | `/api/analyses/{id}/cancel` | Cooperative cancellation |
| POST | `/api/analyses/{id}/rerun` | Clone and run again |
| DELETE | `/api/analyses/{id}` | Delete a finished analysis and its artefacts (admin) |
| GET | `/api/analyses/{id}/detections?bbox=` | Detected extent polygons (GeoJSON) |
| GET | `/api/analyses/{id}/priorities` | Response cells with scores, factors, explanations (GeoJSON) |
| PATCH | `/api/analyses/{id}/priorities/{cell_id}` | Analyst override (`category` or null, `reason`) |
| GET | `/api/analyses/{id}/facilities?status=` | Facilities and settlements with exposure status (GeoJSON) |
| GET | `/api/analyses/{id}/trace` | Goal, plan, decisions, facts, evidence, steps, tool calls, guardrails, metrics |
| GET | `/api/analyses/{id}/layers`, `/layers/{name}.png` | Map overlays (Web Mercator PNG + corner coordinates) |
| GET | `/api/analyses/{id}/reports/{pdf,csv,geojson}?regenerate=` | Reports built from stored records |
| GET | `/api/analyses/{id}/exports/products.tif` | Probability / extent / uncertainty GeoTIFF |

## Human review

| Method | Path | Description |
|---|---|---|
| GET | `/api/alerts?status=&analysis_id=` | Alerts with grounding results and counts |
| POST | `/api/alerts/{id}/decision` | `approve` / `reject` with optional note (409 if already decided) |
| GET | `/api/reviews?status=open` | Review tasks |
| POST | `/api/reviews/{id}/decision` | `confirm`, `false_positive`, `acknowledge`, `request_rerun` |

## Example

```bash
curl -X POST http://localhost:8000/api/analyses -H "Content-Type: application/json" -d '{
  "name": "Sindh flood - Dadu", "hazard": "flood", "mode": "real",
  "bbox": [67.72, 26.62, 67.86, 26.76], "event_date": "2022-08-26",
  "pre_window": ["2022-06-01", "2022-07-05"], "post_window": ["2022-08-26", "2022-09-10"]}'
```
