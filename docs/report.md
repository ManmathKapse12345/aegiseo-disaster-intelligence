# AegisEO: an agentic multi-sensor disaster change-detection and response-prioritisation platform

*Final project report.* Repository: this one. Companion documents: [architecture](architecture.md),
[agent design](agent_design.md), [data](data.md), [model card](model_card.md),
[evaluation tables](evaluation_results.md), [agent benchmark](benchmark_results.md),
[real-data acceptance runs](acceptance.md), [failure analysis](failure_analysis.md),
[guardrail test cases](guardrail_test_cases.md).

## Abstract

After a flood, wildfire or landslide, responders need to know quickly *where* the land surface
changed, *who and what* may be exposed, and *which places to look at first* - including when
clouds hide the ground from optical satellites. AegisEO is a full-stack platform that answers
these questions from free, public data. A closed-loop agent searches the Sentinel-1 radar and
Sentinel-2 optical archives for suitable pre- and post-event acquisitions, checks their quality,
maps change with a calibrated multi-sensor deep-learning model, intersects the result with
population, infrastructure and land-cover layers, ranks response cells with explanations, and
drafts alerts whose every number is checked against recorded evidence. Uncertain or
consequential findings go to a human review queue; nothing is published without a named
human approver.

The deployed water segmenter (a gated-fusion U-Net combined with a radar specialist) reaches a
water IoU of **0.844** on the Sen1Floods11 test split with both sensors, **0.739** with 50 %
simulated cloud and **0.653** with no optical data at all, compared with 0.431 for classical SAR
thresholding and 0.419 for an optical-only network under cloud; temperature scaling reduces the
expected calibration error from 0.014 to 0.005. In a closed-loop benchmark of 12 simulated
scenarios with ground truth (cloud, missing sensors, orbit mismatch, source outages, corrupted
data, missing model, invalid input) and 8 safety probes, the agent passed all checks, escalated
exactly the three cases that required a human (recall and precision 1.0), and every alert it
drafted passed the grounding check.

## 1. Problem and scope

Optical imagery is easy to interpret but blind under cloud, which is common during floods.
Synthetic-aperture radar (SAR) sees through cloud but is noisy and ambiguous (smooth surfaces,
radar shadow, flooded buildings that appear *brighter*). Combining both, and being honest about
which one a conclusion rests on, is the core technical problem - the same multi-sensor problem
space that companies such as GalaxEye Space work on. Producing a map is not enough: the result
must be turned into prioritised, explainable, verifiable information for people who decide.

**In scope:** floods (primary, fully trained and evaluated), wildfire burn scars (index-based)
and landslide candidates (multi-indicator screening with mandatory human review); areas of
0.25-1500 km2; historical events from 2017 onwards and recent events, via public data.
**Out of scope:** flood depth, damage assessment, casualty estimates, autonomous dissemination.

## 2. System overview

AegisEO is a React + MapLibre single-page application talking to a FastAPI service. Each analysis
runs as a background job inside the service; an agent orchestrator coordinates five specialist
agents (data acquisition, perception, impact, prioritisation, reporting) through a typed tool
executor. Results are persisted in SQLite (default) or PostgreSQL + PostGIS (Docker), artefacts
(map overlays, GeoTIFF, PDF, CSV, GeoJSON) on disk. Diagrams: [architecture.md](architecture.md).

The agent loop is explicit:

| Stage | Implementation |
|---|---|
| Observe | Request validation (G01-G03), live catalogue search, data-quality checks (G04-G09) |
| Perception | Calibrated fusion model, classical corroboration, hazard-specific detectors |
| Semantic state | `AgentState`: goal, plan steps, typed facts with units and evidence ids, decisions, flags |
| Memory / RAG | Episodic memory of earlier analyses of overlapping areas *and analysts' corrections*; TF-IDF retrieval over a curated methods knowledge base, cited as `[KB:doc#section]` |
| Reason / plan | 10-step plan; documented rules P0-P9 (window extension, orbit matching, clearest-optical choice, SAR-led re-run, graceful degradation) |
| Tool actions | 20 tools with declared side effects (read-only, compute, write-draft, external); budget, allow-list, tracing |
| Guardrails / HITL | 18 guardrails with pass/warn/escalate/block; review tasks; alert approval; priority overrides |
| Outcome | Honest terminal states (`completed`, `completed_with_warnings`, `needs_review`, `insufficient_data`, `rejected`, `failed`, `cancelled`, `interrupted`) |
| Feedback | Per-run metrics, dashboard agent metrics, benchmark suite, analyst decisions fed back into memory |

## 3. Data

| Purpose | Dataset | Access |
|---|---|---|
| Radar | Sentinel-1 GRD radiometrically terrain-corrected (RTC), VV + VH | Planetary Computer STAC, signed COG range reads |
| Optical | Sentinel-2 L2A surface reflectance + scene classification (SCL) | same |
| Terrain, water, land cover | Copernicus DEM GLO-30, JRC Global Surface Water occurrence, ESA WorldCover | same |
| Population | Meta/CIESIN High Resolution Settlement Layer; WorldPop totals as cross-check | public COGs, WorldPop stats API |
| Infrastructure | OpenStreetMap (hospitals, schools, emergency services, utilities, settlements, roads) | Overpass API |
| Event context | GDACS, USGS earthquakes, NASA FIRMS fires, Open-Meteo ERA5 rainfall | public APIs |
| Training / evaluation | Sen1Floods11 v1.1 hand-labelled (446 chips, 11 events; Bolivia held out) | public bucket |

Per analysis, only the AOI windows are read, reprojected onto a common UTM grid (20 m default)
and cached. Sentinel-2 is converted to reflectance with the processing-baseline offset,
masked with SCL, and reprocessed duplicates are removed; Sentinel-1 RTC gamma0 is harmonised to
sigma0 (training domain). Pre/post Sentinel-1 pairs are matched by relative orbit when possible.
Synthetic scenes (clearly labelled, never mixed with real results) provide ground truth for
agent testing. Details: [data.md](data.md).

## 4. Methods

### 4.1 Water segmentation - baselines and improved method

All learned models share a U-Net backbone (widths 16-128) and were trained identically
(40 epochs, BCE + Dice with no-data masking, radiometric domain randomisation, simulated clouds,
sensor dropout) on the 252 training chips, with the checkpoint chosen on validation IoU.

* **Classical baselines:** per-scene Otsu threshold on VV and VH; MNDWI > 0; a rule-based fusion.
* **Single-sensor baselines:** S1 U-Net, S2 U-Net.
* **Early fusion:** all 13 channels concatenated at the input.
* **Gated fusion (improved):** separate SAR and optical encoders; at every scale a learned gate
  mixes the two feature maps, multiplied by per-pixel *validity* masks so the network cannot
  rely on optical features under cloud or outside the swath. v2 adds stronger sensor dropout.
* **Deployed hybrid:** where only SAR observed a pixel, the calibrated S1 specialist replaces the
  fusion output (smoothly blended across cloud edges). The configuration is chosen
  automatically by a robustness-weighted criterion on the **validation** split
  (`models/selection.json`), so test and Bolivia stay unbiased.
* **Calibration and uncertainty:** temperature scaling fitted on validation (T = 1.66);
  last-layer Monte-Carlo dropout (6 deterministic samples) gives a per-pixel uncertainty.

### 4.2 Change detection

*Flood:* post-classification comparison P(new water) = P(water, post) x (1 - P(water, pre)),
with JRC permanent water (occurrence >= 80 %) removed. Without a pre-event image the JRC
occurrence is used as prior (flagged). Independent corroboration: SAR log-ratio (Lee-filtered)
and MNDWI change; their agreement with the model is reported and checked (G13). Terrain
plausibility removes steep slopes and pixels far above drainage (HAND proxy).
*Wildfire:* dNBR with USGS FIREMON severity classes, corroborated by the VH backscatter drop and
NASA FIRMS hotspots. *Landslide:* candidates from NDVI loss + slope + SAR change, always routed
to human review (G15).

### 4.3 Exposure and prioritisation

Detections are intersected with dasymetric population (HRSL, refined by built-up land cover),
facilities (inside / within 500 m), road length and land cover - always reported as *potentially
exposed*. The AOI is divided into 0.5 km (AOI < 50 km2) or 1 km cells. Each cell gets

`score = 100 x H^a x E^(1-a)`, a = 0.5,

the multiplicative hazard x exposure form used by INFORM-style risk indices: a cell without
exposure cannot become critical however intense the hazard, and vice versa. *H* is a weighted
mean of the detected fraction of the cell (saturating at 50 %) and the detection intensity
(calibrated probability, or burn-severity class). *E* is a weighted mean of population
(log-scaled against 5000 people/km2; built-up fraction is used as a proxy when population is
unavailable), critical facilities (1 - exp(-weighted count), weights by type, half weight when only within 500 m) and
road access (km of road per km2). Categories: Critical >= 70, High >= 50, Moderate >= 30.
A life-safety floor raises a cell to High when a hospital, clinic, fire or ambulance station or
shelter lies inside the detected extent with confidence >= 0.6. Confidence is reported
separately and deliberately does *not* lower the priority (uncertain but potentially severe
cells must be verified, not silently down-ranked). A 200-draw Monte-Carlo log-normal perturbation
of all weights (sigma 0.25) gives each cell's rank stability and the overall Spearman rho. Each cell carries its factor
contributions, a plain-language explanation and suggested considerations.

### 4.4 Grounded narrative and alerts

Summaries and alert drafts are generated from templates (or optionally by Claude) and then
verified: every number, date and knowledge-base citation must match the recorded facts (G16);
casualty claims and directive orders are blocked (G17). Alerts are drafts until a named analyst
approves them; alerts derived from simulated data can never be delivered (G18).

## 5. Evaluation

### 5.1 Perception (Sen1Floods11)

Water IoU, test split (90 chips) and the unseen Bolivia event (15 chips):

| Method | Test as is | Test 50 % cloud | Test no S2 | Test no S1 | Bolivia as is | Bolivia no S2 |
|---|---|---|---|---|---|---|
| Otsu VV | 0.431 | 0.431 | 0.431 | n/a | 0.575 | 0.575 |
| Otsu VH | 0.392 | 0.392 | 0.392 | n/a | 0.645 | 0.645 |
| MNDWI | 0.653 | 0.378 | n/a | 0.653 | 0.556 | n/a |
| S1 U-Net | 0.653 | 0.653 | 0.653 | n/a | 0.520 | 0.520 |
| S2 U-Net | 0.833 | 0.419 | n/a | 0.833 | 0.818 | n/a |
| Early fusion | 0.828 | 0.691 | 0.555 | 0.824 | 0.818 | 0.597 |
| Gated fusion v1 | 0.841 | 0.699 | 0.562 | 0.835 | 0.829 | 0.280 |
| Gated fusion v2 | 0.844 | 0.722 | 0.612 | 0.836 | 0.827 | 0.329 |
| **Deployed hybrid (v2 + S1)** | **0.844** | **0.739** | **0.653** | **0.836** | **0.828** | **0.520** |

Deployed model, test, as provided: F1 0.915, precision 0.932, recall 0.899, flood-only IoU 0.779.
Calibration: ECE 0.014 -> 0.005, NLL 0.097 -> 0.072 (Brier 0.017). Uncertainty quality:
MC-dropout entropy separates errors from correct pixels with AUROC 0.885; keeping the 90 % most
confident pixels raises IoU from 0.816 to 0.939 (risk-coverage curve in
`docs/figures/risk_coverage.png`).

**Interpretation.** Fusion helps most when it matters: under 50 % cloud the deployed model keeps
88 % of its clear-sky IoU while the optical-only network keeps 50 %. With both sensors, fusion
gives a small but consistent gain over optical alone (+0.011). The weakest regime is SAR-only on
an unseen event, where per-scene Otsu on VH beats all learned SAR models (0.645 vs 0.520) -
evidence of limited SAR training diversity, documented in the failure analysis.

### 5.2 Agent benchmark

`python -m aegis.benchmark` runs the full agent (all tools, guardrails, persistence) on 12
simulated scenes with known ground truth, each designed to exercise one behaviour, plus 8 probes
that try to make the agent act unsafely. A case passes only if the terminal status, escalation,
flags and accuracy all match expectations. Results ([benchmark_results.md](benchmark_results.md)):

| Metric | Value |
|---|---|
| Agent cases passed | 12 / 12 |
| Safety probes passed | 8 / 8 |
| Mean IoU / F1 of detected change (11 scored cases) | 0.781 / 0.848 |
| Tool success rate (all failures were deliberately injected) | 0.987 (unexpected errors 0) |
| Escalation rate / recall / precision | 0.25 / 1.0 / 1.0 |
| Alert groundedness (alerts passing G16) | 1.0 |
| Decision-trace completeness | 1.0 |
| Latency mean / max (synthetic scenes) | 3.0 s / 9.3 s |

Behaviourally important cases: under 90 % cloud the agent lets SAR lead and still reaches IoU
0.874 (A02); with no SAR and 85 % cloud it does *not* pretend - IoU is 0.129, so it escalates
(A03); with OpenStreetMap or the population service down it completes, marks the factor
missing and lowers confidence (A04, A05); without the deep model it falls back to classical
methods and asks for review (A12); an invalid request is rejected before any tool runs (A11).
The probes confirm that external actions without a human approval token, tools outside the
allow-list, budget overruns, fabricated numbers or citations, directive/casualty language and
publication of simulated or unapproved alerts are all blocked.

*Caveat:* the benchmark measures agent behaviour on simplified simulated scenes; it is not
evidence of real-world accuracy (that is section 5.1 and 5.3).

### 5.3 Real-data acceptance

Five historical events were run end to end through the real API with live archive data
(full record, including every guardrail outcome and decision: [acceptance.md](acceptance.md)):

| Case | Outcome | Mapped extent | People potentially exposed | Top priority | Why the agent asked for review |
|---|---|---|---|---|---|
| Sindh floods 2022 (flood) | needs_review | 78.2 km2 (36 % of AOI) | 7,274 | High | G11: arid soils outside the training distribution |
| Emilia-Romagna 2023, Conselice (flood) | completed_with_warnings | 31.6 km2 | 118 | High | - (G11 warning only) |
| Derna 2023 (flash flood) | needs_review | 0.03 km2 | 18 | Moderate | G11; water had drained before the first pass |
| Palisades Fire 2025 (wildfire) | needs_review | 53.9 km2 (63 % of AOI) | 14,407 | Critical | G12: very large extent must be confirmed |
| Wayanad 2024 (landslide) | needs_review | 4.7 km2 of candidates | 60 | Moderate | G13 low agreement under 76 % cloud; G15 landslides always reviewed |

First (cold) runs took 5-10 minutes each, dominated by imagery download; repeated runs read
the raster cache in 2-25 s and reproduce identical numbers (same machine). Visual checks against the
post-event imagery agree with the maps (Sindh flood, Palisades burn scar, Conselice flooding).
There is no pixel-level ground truth for these events in the project, so these runs validate
the workflow and the agent's judgement, not accuracy.

Real data found four defects that tests and the synthetic benchmark had missed (details in
[failure_analysis.md](failure_analysis.md#5-findings-from-real-data-acceptance-testing)):
range reads that retried forever on a saturated link; a grounding false positive caused by the
number in the population source label "(~30 m)" (the guardrail failed safe by withholding the
text); a case-study AOI placed where the water had already drained (the detector was right); and
timestamps displayed in the wrong time zone. All four were fixed and the five cases re-run.

## 6. Engineering

* **API**: 36 endpoints (analyses lifecycle, results as GeoJSON, layers, reports, trace, review,
  alerts, overrides, sources, model, benchmarks, knowledge search, dashboard); strict pydantic
  validation (unknown fields rejected), uniform error envelope with request id, path-traversal
  safe file serving. Docs: [api.md](api.md) and the OpenAPI UI at `/docs`.
* **Security**: optional bearer-token authentication with viewer / analyst / admin roles,
  per-client rate limiting, security headers and CSP (nginx), secrets only from environment
  variables (`SecretStr`, redacted in logs; SAS tokens stripped from logged URLs), no secrets in
  the frontend, non-root containers, test-only failure injection rejected for real runs.
* **Persistence**: 13 tables (analyses, agent steps, tool calls, guardrail checks, observations,
  detections, priority cells with override fields, exposed features, alerts, review tasks,
  reports, audit log, benchmark runs); PostGIS generated geometry columns with GiST indexes.
* **Reliability**: retries with jitter, per-source circuit breakers, stale-if-error cache,
  offline mode, restart recovery of jobs, cooperative cancellation, deterministic inference.
* **Monitoring**: JSON logs with request/analysis ids, Prometheus metrics (requests, tool calls,
  guardrail outcomes, jobs, external calls), readiness endpoint, live data-source health page.
* **UI**: light, accessible design system (validated colour palettes, keyboard navigation,
  ARIA labels, responsive to phone width); guided wizard with live catalogue preview; map
  workspace with overlays, before/after swipe, popups; explanations, evidence and trace views;
  review queue and alert approval.
* **Deployment**: Docker Compose with PostGIS, the API (CPU PyTorch) and nginx serving the UI.
* **Tests** (all run on the final code): backend `pytest` 79 passed (unit, integration, API,
  failure injection, security; hermetic and offline) plus 1 live Planetary Computer integration
  test run with `--network`; frontend 9 Vitest component/unit tests; 5 Playwright end-to-end
  journeys on desktop and mobile; the 20-case agent benchmark; `ruff` and `tsc` clean. The five
  real-data acceptance runs are a further, manual-trigger end-to-end test.

## 7. Discussion and limitations

The system's main strength is not any single model but the combination of measured robustness
(sensor-aware fusion, calibration, uncertainty), explicit and auditable agent decisions, and
humility: it reports what it could not observe, degrades instead of failing, and routes
consequential or uncertain conclusions to people. Its main limitations:

* Flood *extent* only; flooding that recedes before the next satellite pass is missed; C-band
  radar under-detects water among buildings and under vegetation.
* The water model saw 10 training events; arid, snowy and dense urban scenes are under-represented
  (guardrail G11 flags such inputs - it did so on the Sindh case).
* Exposure layers (HRSL, OSM) are of uneven completeness and 2015-2020 vintage; vulnerability
  and coping capacity are not modelled.
* Priority weights are expert-set, not fitted to response outcomes (the sensitivity analysis
  quantifies how much this matters for each run).
* Wildfire and landslide modules are index-based and only qualitatively checked.
* Single-node job execution; scaling out would need a job queue.

## 8. Future work

More SAR-only training data (Kuro Siwo, S1GFloods) and a calibrated Otsu/specialist ensemble for
the SAR-only regime; urban-flood detection with SAR coherence; flood depth from DEM; trained
burn-severity and landslide models; time-series monitoring of an AOI; a job queue for horizontal
scaling; user studies with response analysts to calibrate the priority weights.

## References

* Bonafilia, D., Tellman, B., Anderson, T., Issenberg, E. (2020). Sen1Floods11: a georeferenced dataset to train and test deep learning flood algorithms for Sentinel-1. CVPR Workshops.
* Ronneberger, O., Fischer, P., Brox, T. (2015). U-Net: convolutional networks for biomedical image segmentation. MICCAI.
* Guo, C., Pleiss, G., Sun, Y., Weinberger, K. Q. (2017). On calibration of modern neural networks. ICML.
* Gal, Y., Ghahramani, Z. (2016). Dropout as a Bayesian approximation. ICML.
* Otsu, N. (1979). A threshold selection method from gray-level histograms. IEEE Trans. SMC.
* Xu, H. (2006). Modification of normalised difference water index (NDWI) to enhance open water features. Int. J. Remote Sensing.
* Lee, J.-S. (1980). Digital image enhancement and noise filtering by use of local statistics. IEEE TPAMI.
* Key, C. H., Benson, N. C. (2006). Landscape assessment: ground measure of severity, the Composite Burn Index, and remote sensing of severity, the Normalized Burn Ratio. USDA FIREMON.
* Pekel, J.-F., Cottam, A., Gorelick, N., Belward, A. S. (2016). High-resolution mapping of global surface water and its long-term changes. Nature.
* Nobre, A. D. et al. (2011). Height Above the Nearest Drainage - a hydrologically relevant new terrain model. J. Hydrology.
* Zanaga, D. et al. (2022). ESA WorldCover 10 m 2021 v200. Zenodo.
* Tiecke, T. G. et al. (2017). Mapping the world population one building at a time. arXiv:1712.05839 (HRSL).
