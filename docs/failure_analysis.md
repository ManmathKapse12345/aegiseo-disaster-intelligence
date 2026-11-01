# Failure analysis

This document records where AegisEO fails or is weak, how each failure was found, what was
done about it, and what remains. Numbers come from `models/evaluation.json`, the agent
benchmark and the real-data acceptance runs ([acceptance.md](acceptance.md)).

## 1. Perception model

### 1.1 Fusion model collapsed without optical input (found by evaluation, fixed)

*Observation.* The first gated-fusion model (v1) was best with both sensors (test IoU 0.841),
but with Sentinel-2 removed it fell to 0.562 on test and **0.280 on the unseen Bolivia event** -
worse than a SAR-only U-Net (0.653 / 0.520). Persistent cloud is the main reason to fuse radar,
so this was the most important defect found.

*Cause.* With optical data present in ~85 % of training samples the learned gate leaned on
optical features; the SAR pathway was not independently competent when the gate switched to it.

*Fix.* (a) v2 retrained with stronger modality dropout (30 % optical removal, clouds up to
100 %): no-optical IoU 0.562 -> 0.612 (test), 0.280 -> 0.329 (Bolivia). (b) A sensor-aware
hybrid at inference uses the S1 specialist wherever only SAR observed the ground: 0.653 (test)
and 0.520 (Bolivia), while keeping the best clean-data score (0.844). The configuration was
chosen by a robustness-weighted criterion on the **validation** split, so test and Bolivia
remain unbiased.

### 1.2 Learned SAR models generalise poorly to an unseen backscatter regime (open)

On Bolivia without optical data, per-scene Otsu thresholding of VH (0.645) beats every learned
SAR model (S1 U-Net 0.520, early fusion 0.597). An adaptive per-scene threshold adjusts to local
backscatter statistics; networks trained on 10 events do not. *Mitigation in place*: classical
SAR log-ratio corroboration and the G13 agreement guardrail flag disagreement. *Next step*:
evaluate (on validation only) a SAR-pixel ensemble of the S1 specialist and calibrated Otsu
probabilities, and add more SAR-only training events (e.g. Kuro Siwo, S1GFloods).

### 1.3 Domain shift between training and operational inputs (mitigated)

Training uses Sentinel-2 L1C TOA and GRD sigma0; operations use L2A surface reflectance and RTC
gamma0. Mitigations: gamma0 -> sigma0 harmonisation at 39 degrees incidence, radiometric
domain randomisation during training, and guardrail G11 (input distribution shift). In the
Sindh acceptance run G11 correctly escalated: arid soils are brighter in SWIR (z = 3.29 on
B12) than anything common in Sen1Floods11.

### 1.4 Physical blind spots (inherent, communicated)

* Flooded buildings brighten C-band backscatter (double bounce); the synthetic scene reproduces
  this and its flooded town fringe is under-detected. Every flood report states the limitation.
* Water under dense canopy, very narrow channels (< 2-3 pixels), and flooding that recedes
  before the next pass (e.g. flash floods) are missed.
* Calibration is good globally (ECE 0.005) but the reliability diagram shows slight
  over-prediction in the 0.2-0.4 band.

## 2. Agent and pipeline

| Failure found | How | Root cause | Fix |
|---|---|---|---|
| Grounding guardrail blocked a correct alert ("unsupported number 8") | Synthetic end-to-end run | ISO dates (2024-08-22) were parsed as numbers | Dates are now validated as dates against recorded observation dates |
| Grounding blocked "within 500 m" and "School No. 4" | Synthetic runs | Method constants and facility names were not registered as evidence | Distance threshold registered as a fact; numbers in facility names allowed from infrastructure evidence |
| Different results for identical runs (4.40-4.58 km2) | Repeated runs | MC-dropout used the global RNG | Per-tile seeded generators: identical inputs -> identical outputs on the same hardware |
| All 508 Sindh cells ranked Low | Real-data run | Exposure references were absolute per cell, so 0.5 km cells could never saturate; population had failed (see next rows) | Density-based references (people/km2, built-up fraction, road km/km2); 1 km default cells |
| Population unavailable in real runs | Real-data run | GDAL refused to open the HRSL `.vrt` (extension not allowed over HTTP); WorldPop JSON had trailing PHP output | `.vrt` allowed; JSON extracted with `raw_decode` |
| HTTP cache silently failed for Overpass | Logs | `:` in source ids is illegal in Windows paths | Source ids sanitised for cache paths |
| SCL "no data" could be rewritten to "defective" | GDAL warning | Warper replaced real zeros when an integer source declared no no-data | Alpha band marks out-of-footprint pixels instead of a nodata value |
| Classical fallback reported ~0.5 for clear water | Unit test | Otsu argmax picked the edge of a flat between-class-variance plateau | Threshold at the plateau centre |
| Completed analyses briefly listed without reports | API smoke test | Status flipped before report rows were written | Results -> reports -> terminal status |
| Second app instance had a dead job pool | API tests | Shutdown stopped the global manager without resetting it | Manager reset on shutdown |
| Map rendered blank | Browser screenshot | `maplibre-gl.css` sets `position: relative` on the map container, collapsing it | Inline absolute positioning |
| Basemap watermarked "API KEY REQUIRED" | Browser screenshot | CARTO raster endpoint now needs a key | OpenFreeMap vector basemap with offline fallback |
| API container exited on start (`libexpat.so.1` missing) | `docker compose up` | The GDAL bundled in the rasterio wheels needs a system library absent from `python:3.12-slim` | `libexpat1` installed in the image; imports verified inside the container |
| A font blocked in the container build | Browser console against nginx | Vite inlines tiny font subsets as `data:` URIs; the CSP allowed fonts only from `'self'` | `font-src` allows `data:` |
| Simulated analyses labelled roads "OSM" | Screenshot review | Fixed sub-label | Label follows the analysis mode ("simulated roads") |

## 3. Data-source failures (by design, not defects)

* **Cloud**: optical scenes are rejected when < 5 % of the AOI is usable (rule P2); with SAR the
  analysis continues (G08 warn), without SAR it is escalated (G08 escalate).
* **Missing passes**: windows are extended up to twice (P3); if nothing exists the run ends as
  `insufficient_data` with advice, never a fabricated result.
* **Source outages**: retries, circuit breakers and stale-cache fallback; if a context source
  is still unavailable, the factor is marked missing (P8/P9) and confidence drops.
* **Slow or shared links**: handled since the acceptance runs (see 5.1) by aborting only stalled
  transfers instead of applying a hard per-request timeout.

## 4. Residual risks

* Priorities depend on OpenStreetMap completeness and 2015-2020 population estimates.
* Weights are defensible but not empirically fitted to response outcomes; the sensitivity
  analysis reports how stable each rank is.
* The knowledge base is small and curated; retrieval is lexical (TF-IDF).
* Synthetic benchmarks test behaviour, not real-world accuracy; real-world accuracy evidence is
  limited to Sen1Floods11 and qualitative checks on the acceptance cases.

## 5. Findings from real-data acceptance testing

Running the five historical case studies through the real API with live data
([acceptance.md](acceptance.md)) exposed three problems that the hermetic tests and the
synthetic benchmark could not.

### 5.1 Range reads retried forever on a saturated link (fixed)

*Observation.* The first Sindh and Palisades runs sat in "acquiring data" for 15 minutes while a
Docker image build shared the network; the log showed the same 2.5-3.4 MB byte ranges of the
Sentinel-1 COGs being retried about ten times each.
*Cause.* `GDAL_HTTP_TIMEOUT=60` limits the *whole* transfer, so on a slow link every multi-MB
range read was aborted and retried, making no progress.
*Fix.* `GDAL_HTTP_LOW_SPEED_TIME=45` / `GDAL_HTTP_LOW_SPEED_LIMIT=2048` abort only stalled
transfers, with a 300 s ceiling. The API was restarted to apply it; restart recovery marked the
two runs `interrupted` (never silently lost) and they were re-run: Derna, the first run on the new
settings, loaded its post-event Sentinel-1 scene in 64 s with no retries.

### 5.2 The grounding guardrail withheld a correct alert (fixed)

*Observation.* In all five case studies, G16 blocked the situation-summary alert:
"unsupported values: [30.0]".
*Cause.* The summary quotes the population source label "Meta/CIESIN High Resolution Settlement
Layer (~30 m)". Numbers inside data-source labels were not registered as evidence. Synthetic runs
use a label without digits, so no test or benchmark case could reveal it.
*Fix.* `evidence_values()` also accepts numbers that are part of `*_source` labels quoted
verbatim (and nothing else from free-text facts). Regression test:
`test_template_alerts_pass_grounding_with_real_source_labels`. The guardrail failed safe: the
alert text was withheld and replaced by a pointer to the evidence, not published unverified.

### 5.3 A case-study AOI that missed the flood (corrected; the detector was right)

*Observation.* The Emilia-Romagna run over Lugo found only 0.08 km2 of new water, with high
confidence and 99 % independent-method agreement.
*Investigation.* The post-event Sentinel-2 image (23 May 2023) shows no open water over Lugo:
the water had drained before the first post-event passes. An MNDWI map of the same scene over a
wider area located the water that remained around Conselice and Lavezzola.
*Action.* The scenario AOI was moved there (`aegis/scenarios.py`); the original run stays in the
record as a correct negative. This illustrates a general limitation, also seen at Derna (flash
flood, 0.03 km2): mapping depends on a satellite pass while water is still present.

### 5.4 Timestamps shown in the wrong time zone (fixed)

The analysis list showed a run created seconds earlier as "6 h ago" (browser in UTC+5:30).
SQLite returns naive timestamps, which browsers read as local time. A `UTCDateTime` column type now
returns timezone-aware UTC values on every back-end, and an API test checks the `+00:00` suffix.

### 5.5 Conservative escalations that were correct to raise

* Palisades: G12 escalated because 63 % of the AOI was mapped as burned. The AOI was drawn over
  the burn scar, so the extent is genuine (the post-fire image confirms it), but a mapped extent
  that large is also what a systematic error looks like - a person should confirm it. Kept as is.
* Sindh: G11 escalated because the arid pre-event soils are spectrally unlike the training data
  (SWIR z = 3.29). The map is plausible against the imagery, but the warning is legitimate.
* Wayanad: G13 escalated (post-event optical 76 % cloudy, mean uncertainty 0.41, low agreement)
  and G15 always routes landslide candidates to a person. Correct: monsoon cloud makes this the
  hardest case, and the system says so instead of reporting a confident map.
