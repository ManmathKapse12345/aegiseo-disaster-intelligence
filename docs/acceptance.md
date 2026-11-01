# Real-data acceptance runs

Generated 2026-11-01 04:52 UTC by `python scripts/acceptance_report.py` from analyses run through the real API with live public data (Microsoft Planetary Computer, OpenStreetMap, HRSL/WorldPop, Open-Meteo, GDACS). These are historical events, so there is no pixel-level ground truth here; the purpose is to show that the complete loop works on real archives and that the agent's decisions, guardrails and stated limitations are sensible. Accuracy is measured on Sen1Floods11 ([evaluation_results.md](evaluation_results.md)). Issues found by these runs and how they were fixed are listed in [failure_analysis.md](failure_analysis.md#5-findings-from-real-data-acceptance-testing).

## All real-data runs

Run times include downloading imagery the first time an area is analysed; later runs of the same case read the raster cache. Results are deterministic on the same hardware, so repeated runs give identical numbers.

| Started (UTC) | Case | Hazard | Outcome | Extent (km2) | People exposed | Top priority | Confidence | Run time (s) |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01 04:03 | Sindh floods, Pakistan (2022) | flood | interrupted | n/a | n/a | n/a | n/a | n/a |
| 2026-11-01 04:03 | Palisades Fire, Los Angeles (Jan 2025) | wildfire | interrupted | n/a | n/a | n/a | n/a | n/a |
| 2026-11-01 04:03 | Emilia-Romagna floods, Italy (May 2023) | flood | completed | 0.08 | 0 | Low | High | 540 |
| 2026-11-01 04:03 | Derna flash flood, Libya (Sept 2023) | flood | needs_review | 0.03 | 18 | Moderate | Medium | 431 |
| 2026-11-01 04:03 | Wayanad landslides, Kerala (July 2024) | landslide | needs_review | 4.72 | 60 | Moderate | Low | 318 |
| 2026-11-01 04:20 | Sindh floods, Pakistan (2022) (re-run) | flood | needs_review | 78.21 | 7,274 | High | Medium | 624 |
| 2026-11-01 04:20 | Palisades Fire, Los Angeles (Jan 2025) (re-run) | wildfire | needs_review | 53.85 | 14,407 | Critical | Medium | 574 |
| 2026-11-01 04:40 | Emilia-Romagna floods, Italy (May 2023) - Conselice | flood | completed_with_warnings | 31.63 | 118 | High | High | 392 |
| 2026-11-01 04:47 | Sindh floods, Pakistan (2022) | flood | needs_review | 78.21 | 7,274 | High | Medium | 23 |
| 2026-11-01 04:47 | Emilia-Romagna floods, Italy (May 2023) | flood | completed_with_warnings | 31.63 | 118 | High | High | 25 |
| 2026-11-01 04:47 | Derna flash flood, Libya (Sept 2023) | flood | needs_review | 0.03 | 18 | Moderate | Medium | 12 |
| 2026-11-01 04:47 | Palisades Fire, Los Angeles (Jan 2025) | wildfire | needs_review | 53.85 | 14,407 | Critical | Medium | 7 |
| 2026-11-01 04:47 | Wayanad landslides, Kerala (July 2024) | landslide | needs_review | 4.72 | 60 | Moderate | Low | 2 |

## Cases

### Sindh floods, Pakistan (2022)

`9bdb78a95b244cfbbf0de3c579c0da9a` · hazard **flood** · AOI [67.72, 26.62, 67.86, 26.76] · event 2022-08-26 · pre 2022-06-01 to 2022-07-05 · post 2022-08-26 to 2022-09-10

**Outcome: needs_review** in 23 s.

| Sensor | Role | Acquired (UTC) | Cloud | Valid | Items |
|---|---|---|---|---|---|
| S1 | post | 2022-08-27 13:36 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20220827T133609_20220827T133634_044739_055782_rtc |
| S1 | pre | 2022-06-28 13:36 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20220628T133606_20220628T133631_043864_053C86_rtc |
| S2 | post | 2022-08-31 05:56 | 0.00 | 1.00 | S2A_MSIL2A_20220831T055651_R091_T42RUQ_20240720T003836 |
| S2 | pre | 2022-06-27 05:56 | 0.01 | 0.99 | S2B_MSIL2A_20220627T055639_R091_T42RUQ_20220627T180404 |

| Result | Value |
|---|---|
| Detected flood extent | 78.21 km2 |
| People potentially exposed | 7,274 (Meta/CIESIN High Resolution Settlement Layer (~30 m)) |
| Facilities inside / within 500 m | 0 / 2 |
| Road length in the extent | 1.38 km |
| Top priority / cell distribution | High / Critical 0, High 24, Moderate 49, Low 92 |
| Overall confidence | Medium |
| Model | gated_fusion_unet_v2@66a53b75fa82; post-event sensors S1, S2 |

Quality indicators: s2_post_cloud_fraction = 0.000, s2_post_valid_fraction = 1.000, s1_orbit_consistent = 1, s1_gap_days = 60.000, s2_gap_days = 65.000, terrain_suppressed_fraction = 0.000, mean_uncertainty_detected = 0.013, mean_entropy_detected = 0.118, mean_probability_detected = 0.974, cross_method_agreement = 0.999, cross_method_coverage = 1.000, affected_fraction_of_aoi = 0.362, no_data_fraction_post = 0.000, model_method = deep_fusion_model, mean_sar_reliance_detected = 0.000

Guardrails: 22 checks, 2 not passing.

| Code | Outcome | Message |
|---|---|---|
| G06 | warn | baseline over 60 days ({'S2': 65}); seasonal change may be mistaken for hazard |
| G11 | escalate | max channel z-score 3.29 vs training data (S2_pre_B12) |

Agent decisions:

- *Sentinel-1 post-event acquisition* -> 2022-08-27 (orbit 42 ascending) (P1): earliest post-event SAR pass: closest to the event and unaffected by cloud
- *Sentinel-1 pre-event acquisition* -> 2022-06-28 (orbit 42) (P4): latest pass on the same relative orbit and direction as the post-event image (identical viewing geometry)
- *Sentinel-2 post-event acquisition* -> 2022-08-31 (AOI cloud-free 100%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event
- *Sentinel-2 pre-event acquisition* -> 2022-06-27 (AOI cloud-free 99%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event

Top response cells:

1. **High** (score 56.5, confidence High): High priority (score 56/100, rank 1 of 165). 89% of this cell (0.89 km2) shows new surface water (mean confidence 0.98). About 443 residents are potentially exposed (estimate). Confidence high: mean model uncertainty 0.01, independent-method agreement 100%, data completeness 100%. Ranking robustnes…
2. **High** (score 54.0, confidence High): High priority (score 54/100, rank 2 of 165). 90% of this cell (0.90 km2) shows new surface water (mean confidence 0.97). About 262 residents are potentially exposed (estimate). Confidence high: mean model uncertainty 0.01, independent-method agreement 100%, data completeness 100%. Ranking robustnes…
3. **High** (score 53.6, confidence High): High priority (score 54/100, rank 3 of 165). 98% of this cell (0.88 km2) shows new surface water (mean confidence 0.98). About 241 residents are potentially exposed (estimate). Confidence high: mean model uncertainty 0.01, independent-method agreement 100%, data completeness 100%. Ranking robustnes…

Agent summary (template, grounding-checked):

> Satellite analysis detected 78.21 km2 of new surface water (flooding) in the 216.0 km2 area of interest, observed on 2022-08-27. An estimated 7,274 residents live inside the detected extent (potentially exposed; source: Meta/CIESIN High Resolution Settlement Layer (~30 m)). 0 mapped critical facilities are inside the extent and 2 more within 500 m; 1.4 km of mapped roads cross it. Response prioritisation ranked 165 cells: 0 critical, 24 high, 49 moderate and 92 low. Overall confidence is medium (independent-method agreement 100%). 1 issue(s) were routed to an analyst for review before any alert is published.

Stated limitations: Flood depth is not estimated; extent only. C-band SAR under-detects water beneath dense vegetation and in built-up areas (double-bounce). Vulnerability and coping capacity are not included in the priority score.

### Emilia-Romagna floods, Italy (May 2023)

`bd362b425bd74eb0bac41d88001d2882` · hazard **flood** · AOI [11.78, 44.48, 12.0, 44.58] · event 2023-05-17 · pre 2023-04-01 to 2023-05-01 · post 2023-05-17 to 2023-05-30

**Outcome: completed_with_warnings** in 25 s.

| Sensor | Role | Acquired (UTC) | Cloud | Valid | Items |
|---|---|---|---|---|---|
| S1 | post | 2023-05-22 05:19 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20230522T051946_20230522T052011_048642_05D9B6_rtc |
| S1 | pre | 2023-04-28 05:19 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20230428T051944_20230428T052009_048292_05CEBB_rtc |
| S2 | post | 2023-05-23 10:06 | 0.00 | 1.00 | S2A_MSIL2A_20230523T100601_R022_T32TQQ_20230523T172938 |
| S2 | pre | 2023-04-23 10:05 | 0.11 | 0.89 | S2A_MSIL2A_20230423T100551_R022_T32TQQ_20230425T012133 |

| Result | Value |
|---|---|
| Detected flood extent | 31.63 km2 |
| People potentially exposed | 118 (Meta/CIESIN High Resolution Settlement Layer (~30 m)) |
| Facilities inside / within 500 m | 4 / 22 |
| Road length in the extent | 4.80 km |
| Top priority / cell distribution | High / Critical 0, High 2, Moderate 13, Low 89 |
| Overall confidence | High |
| Model | gated_fusion_unet_v2@66a53b75fa82+s1_unet@66e84d1ad7f2; post-event sensors S1, S2 |

Quality indicators: s2_post_cloud_fraction = 0.000, s2_post_valid_fraction = 1.000, s1_orbit_consistent = 1, s1_gap_days = 24.000, s2_gap_days = 30.000, terrain_suppressed_fraction = 0.000, mean_uncertainty_detected = 0.026, mean_entropy_detected = 0.291, mean_probability_detected = 0.927, cross_method_agreement = 0.979, cross_method_coverage = 1.000, affected_fraction_of_aoi = 0.163, no_data_fraction_post = 0.000, model_method = deep_fusion_model, mean_sar_reliance_detected = 0.000

Guardrails: 16 checks, 1 not passing.

| Code | Outcome | Message |
|---|---|---|
| G11 | warn | max channel z-score 1.52 vs training data (S2_post_B02) |

Agent decisions:

- *Sentinel-1 post-event acquisition* -> 2023-05-22 (orbit 95 descending) (P1): earliest post-event SAR pass: closest to the event and unaffected by cloud
- *Sentinel-1 pre-event acquisition* -> 2023-04-28 (orbit 95) (P4): latest pass on the same relative orbit and direction as the post-event image (identical viewing geometry)
- *Sentinel-2 post-event acquisition* -> 2023-05-23 (AOI cloud-free 100%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event
- *Sentinel-2 pre-event acquisition* -> 2023-04-23 (AOI cloud-free 89%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event

Top response cells:

1. **High** (score 54.1, confidence High): High priority (score 54/100, rank 1 of 104). 61% of this cell (0.61 km2) shows new surface water (mean confidence 0.90). About 2 residents are potentially exposed (estimate). Inside the detected extent: Unigrà (power infrastructure), Conselice Est (power infrastructure). Confidence high: mean model…
2. **High** (score 53.2, confidence High): High priority (score 53/100, rank 2 of 104). 95% of this cell (0.95 km2) shows new surface water (mean confidence 0.95). About 11 residents are potentially exposed (estimate). Inside the detected extent: Conselice (power infrastructure). Confidence high: mean model uncertainty 0.02, independent-met…
3. **Moderate** (score 47.4, confidence High): Moderate priority (score 47/100, rank 3 of 104). 53% of this cell (0.53 km2) shows new surface water (mean confidence 0.94). About 11 residents are potentially exposed (estimate). 1 further facility within 500 m. 0.09 km of mapped roads cross the affected area. Confidence high: mean model uncertain…

Agent summary (template, grounding-checked):

> Satellite analysis detected 31.63 km2 of new surface water (flooding) in the 194.4 km2 area of interest, observed on 2023-05-22. An estimated 118 residents live inside the detected extent (potentially exposed; source: Meta/CIESIN High Resolution Settlement Layer (~30 m)). 4 mapped critical facilities are inside the extent and 22 more within 500 m; 4.8 km of mapped roads cross it. Response prioritisation ranked 104 cells: 0 critical, 2 high, 13 moderate and 89 low. Overall confidence is high (independent-method agreement 98%).

Stated limitations: Flood depth is not estimated; extent only. C-band SAR under-detects water beneath dense vegetation and in built-up areas (double-bounce). Vulnerability and coping capacity are not included in the priority score.

### Derna flash flood, Libya (Sept 2023)

`531edf7979e94ccf96e16cccf531423b` · hazard **flood** · AOI [22.58, 32.71, 22.7, 32.78] · event 2023-09-11 · pre 2023-08-01 to 2023-09-08 · post 2023-09-11 to 2023-09-25

**Outcome: needs_review** in 12 s.

| Sensor | Role | Acquired (UTC) | Cloud | Valid | Items |
|---|---|---|---|---|---|
| S1 | post | 2023-09-12 16:30 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20230912T163044_20230912T163109_050297_060E1D_rtc |
| S1 | pre | 2023-08-19 16:30 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20230819T163043_20230819T163108_049947_060223_rtc |
| S2 | post | 2023-09-22 09:07 | 0.00 | 1.00 | S2A_MSIL2A_20230922T090701_R050_T34SFB_20241027T090232 |
| S2 | pre | 2023-08-28 09:05 | 0.00 | 1.00 | S2B_MSIL2A_20230828T090559_R050_T34SFB_20241017T160356 |

| Result | Value |
|---|---|
| Detected flood extent | 0.03 km2 |
| People potentially exposed | 18 (Meta/CIESIN High Resolution Settlement Layer (~30 m)) |
| Facilities inside / within 500 m | 0 / 2 |
| Road length in the extent | 0.52 km |
| Top priority / cell distribution | Moderate / Critical 0, High 0, Moderate 1, Low 0 |
| Overall confidence | Medium |
| Model | gated_fusion_unet_v2@66a53b75fa82; post-event sensors S1, S2 |

Quality indicators: s2_post_cloud_fraction = 0.000, s2_post_valid_fraction = 1.000, s1_orbit_consistent = 1, s1_gap_days = 24.000, s2_gap_days = 25.000, terrain_suppressed_fraction = 0.231, mean_uncertainty_detected = 0.023, mean_entropy_detected = 0.153, mean_probability_detected = 0.951, cross_method_agreement = 0.972, cross_method_coverage = 1.000, affected_fraction_of_aoi = 0.000, no_data_fraction_post = 0.000, model_method = deep_fusion_model, mean_sar_reliance_detected = 0.000

Guardrails: 12 checks, 1 not passing.

| Code | Outcome | Message |
|---|---|---|
| G11 | escalate | max channel z-score 3.21 vs training data (S2_pre_B12) |

Agent decisions:

- *Sentinel-1 post-event acquisition* -> 2023-09-12 (orbit 175 ascending) (P1): earliest post-event SAR pass: closest to the event and unaffected by cloud
- *Sentinel-1 pre-event acquisition* -> 2023-08-19 (orbit 175) (P4): latest pass on the same relative orbit and direction as the post-event image (identical viewing geometry)
- *Sentinel-2 post-event acquisition* -> 2023-09-22 (AOI cloud-free 100%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event
- *Sentinel-2 pre-event acquisition* -> 2023-08-28 (AOI cloud-free 100%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event

Top response cells:

1. **Moderate** (score 41.0, confidence High): Moderate priority (score 41/100, rank 1 of 1). 3% of this cell (0.03 km2) shows new surface water (mean confidence 0.95). About 18 residents are potentially exposed (estimate). 2 further facilities within 500 m. 0.53 km of mapped roads cross the affected area. Confidence high: mean model uncertaint…

Agent summary (template, grounding-checked):

> Satellite analysis detected 0.03 km2 of new surface water (flooding) in the 87.3 km2 area of interest, observed on 2023-09-12. An estimated 18 residents live inside the detected extent (potentially exposed; source: Meta/CIESIN High Resolution Settlement Layer (~30 m)). 0 mapped critical facilities are inside the extent and 2 more within 500 m; 0.5 km of mapped roads cross it. Response prioritisation ranked 1 cells: 0 critical, 0 high, 1 moderate and 0 low. Overall confidence is medium (independent-method agreement 97%). 1 issue(s) were routed to an analyst for review before any alert is published.

Stated limitations: Flood depth is not estimated; extent only. C-band SAR under-detects water beneath dense vegetation and in built-up areas (double-bounce). Vulnerability and coping capacity are not included in the priority score.

### Palisades Fire, Los Angeles (Jan 2025)

`321abfb5d5364f80af28cfefd9db61df` · hazard **wildfire** · AOI [-118.62, 34.03, -118.5, 34.1] · event 2025-01-07 · pre 2024-12-01 to 2025-01-06 · post 2025-01-14 to 2025-02-05

**Outcome: needs_review** in 7 s.

| Sensor | Role | Acquired (UTC) | Cloud | Valid | Items |
|---|---|---|---|---|---|
| S1 | post | 2025-01-14 01:59 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20250114T015849_20250114T015914_057434_071221_rtc |
| S1 | pre | 2025-01-02 01:59 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20250102T015850_20250102T015915_057259_070B31_rtc |
| S2 | post | 2025-02-01 18:36 | 0.05 | 0.95 | S2C_MSIL2A_20250201T183631_R027_T11SLT_20250201T210315 |
| S2 | pre | 2025-01-02 18:37 | 0.00 | 1.00 | S2A_MSIL2A_20250102T183751_R027_T11SLT_20250102T221646 |

| Result | Value |
|---|---|
| Detected wildfire extent | 53.85 km2 |
| People potentially exposed | 14,407 (Meta/CIESIN High Resolution Settlement Layer (~30 m)) |
| Facilities inside / within 500 m | 2 / 15 |
| Road length in the extent | 26.00 km |
| Top priority / cell distribution | Critical / Critical 2, High 19, Moderate 17, Low 37 |
| Overall confidence | Medium |
| Model | dnbr-firemon@1; post-event sensors S1, S2 |

Quality indicators: s2_post_cloud_fraction = 0.055, optical_used = 1, cross_method_agreement = 0.638, cross_method_coverage = 1.000, mean_probability_detected = 0.980, mean_uncertainty_detected = 0.020, affected_fraction_of_aoi = 0.626, hotspot_corroboration = n/a, model_method = index_based

Guardrails: 21 checks, 1 not passing.

| Code | Outcome | Message |
|---|---|---|
| G12 | escalate | 63% of the AOI detected as affected - implausibly large, possible systematic error |

Agent decisions:

- *Sentinel-1 post-event acquisition* -> 2025-01-14 (orbit 137 ascending) (P1): earliest post-event SAR pass: closest to the event and unaffected by cloud
- *Sentinel-1 pre-event acquisition* -> 2025-01-02 (orbit 137) (P4): latest pass on the same relative orbit and direction as the post-event image (identical viewing geometry)
- *Sentinel-2 post-event acquisition* -> 2025-02-01 (AOI cloud-free 95%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event
- *Sentinel-2 pre-event acquisition* -> 2025-01-02 (AOI cloud-free 100%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event

Flags: `firms_unavailable`

Top response cells:

1. **Critical** (score 80.3, confidence Medium): Critical priority (score 80/100, rank 1 of 75). 59% of this cell (0.59 km2) shows burn scar (mean confidence 0.46). About 939 residents are potentially exposed (estimate). Inside the detected extent: School (schools). 5 further facilities within 500 m. 1.84 km of mapped roads cross the affected are…
2. **Critical** (score 76.9, confidence Medium): Critical priority (score 77/100, rank 2 of 75). 63% of this cell (0.63 km2) shows burn scar (mean confidence 0.43). About 1,534 residents are potentially exposed (estimate). 5 further facilities within 500 m. 1.56 km of mapped roads cross the affected area. Confidence medium: mean model uncertainty…
3. **High** (score 66.2, confidence Medium): High priority (score 66/100, rank 3 of 75). 51% of this cell (0.51 km2) shows burn scar (mean confidence 0.41). About 1,343 residents are potentially exposed (estimate). 1 further facility within 500 m. 1.00 km of mapped roads cross the affected area. Confidence medium: mean model uncertainty 0.09,…

Agent summary (template, grounding-checked):

> Satellite analysis detected 53.85 km2 of burn scars in the 86.0 km2 area of interest, observed on 2025-01-14. An estimated 14,407 residents live inside the detected extent (potentially exposed; source: Meta/CIESIN High Resolution Settlement Layer (~30 m)). 2 mapped critical facilities are inside the extent and 15 more within 500 m; 26.0 km of mapped roads cross it. Response prioritisation ranked 75 cells: 2 critical, 19 high, 17 moderate and 37 low. Overall confidence is medium (independent-method agreement 64%). 1 issue(s) were routed to an analyst for review before any alert is published.

Stated limitations: dNBR thresholds are generic (Key & Benson, 2006); field calibration (CBI) is not available. Vulnerability and coping capacity are not included in the priority score.

### Wayanad landslides, Kerala (July 2024)

`2890b5bc1af84c15b600e1e53961cfe7` · hazard **landslide** · AOI [76.11, 11.44, 76.19, 11.52] · event 2024-07-30 · pre 2024-03-01 to 2024-05-31 · post 2024-07-30 to 2024-09-30

**Outcome: needs_review** in 2 s.

| Sensor | Role | Acquired (UTC) | Cloud | Valid | Items |
|---|---|---|---|---|---|
| S1 | post | 2024-08-01 00:41 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20240801T004053_20240801T004118_055012_06B3B7_rtc |
| S1 | pre | 2024-05-21 00:41 | n/a | 1.00 | S1A_IW_GRDH_1SDV_20240521T004055_20240521T004120_053962_068F46_rtc |
| S2 | post | 2024-08-13 05:16 | 0.76 | 0.24 | S2B_MSIL2A_20240813T051659_R062_T43PFN_20240813T095611 |
| S2 | pre | 2024-04-10 05:16 | 0.07 | 0.93 | S2A_MSIL2A_20240410T051651_R062_T43PFN_20240410T145500 |

| Result | Value |
|---|---|
| Detected landslide extent | 4.72 km2 |
| People potentially exposed | 60 (Meta/CIESIN High Resolution Settlement Layer (~30 m)) |
| Facilities inside / within 500 m | 0 / 3 |
| Road length in the extent | 0 km |
| Top priority / cell distribution | Moderate / Critical 0, High 0, Moderate 2, Low 41 |
| Overall confidence | Low |
| Model | ndvi-sar-slope@1; post-event sensors S1, S2 |

Quality indicators: s2_post_cloud_fraction = 0.763, cross_method_agreement = 0.135, cross_method_coverage = 1.000, mean_probability_detected = 0.593, mean_uncertainty_detected = 0.407, affected_fraction_of_aoi = 0.061, model_method = indicator_based, requires_verification = 1

Guardrails: 12 checks, 4 not passing.

| Code | Outcome | Message |
|---|---|---|
| G06 | warn | baseline over 60 days ({'S1': 71, 'S2': 125}); seasonal change may be mistaken for hazard |
| G08 | warn | post-event optical cloud cover 76%; SAR leads the analysis |
| G13 | escalate | mean uncertainty 0.41 > 0.15; independent-method agreement 13% < 55% |
| G15 | escalate | landslide candidates are indicative and must be verified by an analyst |

Agent decisions:

- *Sentinel-1 post-event acquisition* -> 2024-08-01 (orbit 165 descending) (P1): earliest post-event SAR pass: closest to the event and unaffected by cloud
- *Sentinel-1 pre-event acquisition* -> 2024-05-21 (orbit 165) (P4): latest pass on the same relative orbit and direction as the post-event image (identical viewing geometry)
- *Sentinel-2 post-event acquisition* -> 2024-08-13 (AOI cloud-free 24%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event
- *Sentinel-2 pre-event acquisition* -> 2024-04-10 (AOI cloud-free 93%) (P2): highest share of cloud-free AOI pixels measured from the scene classification layer (tile-level cloud cover is not representative of a small AOI), with a small penalty per day from the event

Top response cells:

1. **Moderate** (score 31.3, confidence Low): Moderate priority (score 31/100, rank 1 of 43). 25% of this cell (0.25 km2) shows landslide candidate (mean confidence 0.56). About 33 residents are potentially exposed (estimate). Confidence low: mean model uncertainty 0.44, independent-method agreement 4%, data completeness 100%. Ranking robustne…
2. **Moderate** (score 30.2, confidence Low): Moderate priority (score 30/100, rank 2 of 43). 36% of this cell (0.36 km2) shows landslide candidate (mean confidence 0.56). About 14 residents are potentially exposed (estimate). Confidence low: mean model uncertainty 0.44, independent-method agreement 3%, data completeness 100%. Ranking robustne…
3. **Low** (score 28.9, confidence Low): Low priority (score 29/100, rank 3 of 43). 49% of this cell (0.49 km2) shows landslide candidate (mean confidence 0.56). About 6 residents are potentially exposed (estimate). Confidence low: mean model uncertainty 0.44, independent-method agreement 4%, data completeness 100%. Ranking robustness: ca…

Agent summary (template, grounding-checked):

> Satellite analysis detected 4.72 km2 of landslide candidates in the 77.2 km2 area of interest, observed on 2024-08-01. An estimated 60 residents live inside the detected extent (potentially exposed; source: Meta/CIESIN High Resolution Settlement Layer (~30 m)). 0 mapped critical facilities are inside the extent and 3 more within 500 m; 0.0 km of mapped roads cross it. Response prioritisation ranked 43 cells: 0 critical, 0 high, 2 moderate and 41 low. Overall confidence is low (independent-method agreement 14%). 2 issue(s) were routed to an analyst for review before any alert is published.

Stated limitations: Landslide detection from 10-20 m imagery is indicative only; small or narrow failures are missed. Candidates require analyst verification (VHR imagery or field reports) before operational use. Vulnerability and coping capacity are not included in the priority score.

## Tool-call and action trace: Sindh floods, Pakistan (2022)

Every tool call of analysis `9bdb78a95b244cfbbf0de3c579c0da9a` as recorded by the tool executor (`GET /api/analyses/9bdb78a95b244cfbbf0de3c579c0da9a/trace`). Side effects: `read_only` (external reads), `compute`, `write_draft` (drafts for humans); `external` actions are never available to the agent.

| # | Agent | Tool | Side effect | Status | Latency (s) | Result |
|---|---|---|---|---|---|---|
| 1 | orchestrator | `recall_similar_cases` | read_only | ok | 0.0 | {'cases': 1} |
| 2 | data_acquisition | `search_imagery` | read_only | ok | 0.0 | {'acquisitions': 3, 'dates': ['2022-08-27', '2022-08-30', '2022-09-08']} |
| 3 | data_acquisition | `search_imagery` | read_only | ok | 0.0 | {'acquisitions': 6, 'dates': ['2022-06-04', '2022-06-07', '2022-06-16', '2022-06-19', '2022-06-28', '2022-07-01']} |
| 4 | data_acquisition | `load_s1` | read_only | ok | 0.1 | {'sensor': 'S1', 'role': 'post', 'acquired_at': '2022-08-27T13:36:21.995016+00:00', 'collection': 'sentinel-1-rtc', 'item_ids': ['S1A_IW_GRDH_1SDV_20… |
| 5 | data_acquisition | `load_s1` | read_only | ok | 0.1 | {'sensor': 'S1', 'role': 'pre', 'acquired_at': '2022-06-28T13:36:18.628703+00:00', 'collection': 'sentinel-1-rtc', 'item_ids': ['S1A_IW_GRDH_1SDV_202… |
| 6 | data_acquisition | `search_imagery` | read_only | ok | 0.1 | {'acquisitions': 7, 'dates': ['2022-08-26', '2022-08-29', '2022-08-31', '2022-09-03', '2022-09-05', '2022-09-08', '2022-09-10']} |
| 7 | data_acquisition | `assess_cloud_cover` | read_only | ok | 0.3 | {'cloud_fraction': 0.000176, 'valid_fraction': 0.999824} |
| 8 | data_acquisition | `assess_cloud_cover` | read_only | ok | 0.2 | {'cloud_fraction': 0.0, 'valid_fraction': 1.0} |
| 9 | data_acquisition | `assess_cloud_cover` | read_only | ok | 0.1 | {'cloud_fraction': 0.005216, 'valid_fraction': 0.994784} |
| 10 | data_acquisition | `search_imagery` | read_only | ok | 0.1 | {'acquisitions': 12, 'dates': ['2022-06-02', '2022-06-05', '2022-06-07', '2022-06-10', '2022-06-12', '2022-06-17', '2022-06-20', '2022-06-22', '2022-… |
| 11 | data_acquisition | `assess_cloud_cover` | read_only | ok | 0.0 | {'cloud_fraction': 0.005264, 'valid_fraction': 0.994736} |
| 12 | data_acquisition | `assess_cloud_cover` | read_only | ok | 0.1 | {'cloud_fraction': 0.004014, 'valid_fraction': 0.995986} |
| 13 | data_acquisition | `assess_cloud_cover` | read_only | ok | 0.1 | {'cloud_fraction': 0.0, 'valid_fraction': 1.0} |
| 14 | data_acquisition | `load_s2` | read_only | ok | 0.3 | {'sensor': 'S2', 'role': 'post', 'acquired_at': '2022-08-31T05:56:51.024000+00:00', 'collection': 'sentinel-2-l2a', 'item_ids': ['S2A_MSIL2A_20220831… |
| 15 | data_acquisition | `load_s2` | read_only | ok | 0.3 | {'sensor': 'S2', 'role': 'pre', 'acquired_at': '2022-06-27T05:56:39.024000+00:00', 'collection': 'sentinel-2-l2a', 'item_ids': ['S2B_MSIL2A_20220627T… |
| 16 | data_acquisition | `load_context_layers` | read_only | ok | 0.1 | {'cop-dem-glo-30': {'status': 'ok', 'items': ['Copernicus_DSM_COG_10_N26_00_E067_00_DEM']}, 'esa-worldcover': {'status': 'ok', 'items': ['ESA_WorldCo… |
| 17 | perception | `detect_change` | compute | ok | 16.2 | {'method': 'Multi-sensor post-classification comparison (gated-fusion U-Net) with classical corroboration', 'affected_area_km2': 78.21, 'agreement': … |
| 18 | impact_assessment | `query_infrastructure` | read_only | ok | 0.0 | {'features': 159, 'status': 'ok', 'endpoint': 'https://overpass-api.de/api/interpreter', 'osm_base': '2026-11-01T04:38:06Z'} |
| 19 | impact_assessment | `query_population` | read_only | ok | 0.0 | {'available': True, 'source': 'Meta/CIESIN High Resolution Settlement Layer (~30 m)', 'aoi_total': 217942.046875} |
| 20 | impact_assessment | `query_rainfall` | read_only | ok | 0.0 | {'total_mm': 615.5, 'peak_day': {'date': '2022-08-19', 'mm': 127.4}} |
| 21 | impact_assessment | `query_hazard_alerts` | read_only | ok | 0.0 | {'events': 0} |
| 22 | impact_assessment | `compute_impact` | compute | ok | 0.3 | {'population_exposed': 7274, 'facility_counts': {'clinic': {'inside': 0, 'near': 1, 'total': 1}, 'police': {'inside': 0, 'near': 1, 'total': 1}, 'pow… |
| 23 | prioritization | `prioritize_cells` | compute | ok | 0.4 | {'cells': 165, 'distribution': {'Critical': 0, 'High': 24, 'Moderate': 49, 'Low': 92}} |
| 24 | reporting | `retrieve_guidance` | read_only | ok | 0.0 | ['sar-flood-mapping#urban-areas', 'sar-flood-mapping#vegetation-and-wind', 'alerting-review#when-to-escalate-to-a-human-analyst', 'flood-methodology#… |
| 25 | reporting | `draft_alert` | write_draft | ok | 0.0 | {'alert_id': '0fbe5bd9fe8148b8ac3c27cd667b66f9'} |
| 26 | reporting | `draft_alert` | write_draft | ok | 0.0 | {'alert_id': '31e65a7fd6d741fc91eca7cb87a47176'} |
| 27 | reporting | `draft_alert` | write_draft | ok | 0.0 | {'alert_id': 'b72fea668a7f44b992e7a1eb9cbd6f12'} |
| 28 | reporting | `draft_alert` | write_draft | ok | 0.0 | {'alert_id': '3af81b19e2ed458fb5495f63664c0cac'} |
| 29 | reporting | `draft_alert` | write_draft | ok | 0.0 | {'alert_id': 'ba5abf53ddd34e1b900277662f6d6b5a'} |
| 30 | reporting | `draft_alert` | write_draft | ok | 0.0 | {'alert_id': '73267555d4304e019389cc78e2284b37'} |
| 31 | orchestrator | `escalate_to_analyst` | write_draft | ok | 0.0 | {'review_task_id': '8fbc4fe707c54d5f855bcb6cbb764f82'} |
| 32 | orchestrator | `render_map_layers` | write_draft | ok | 3.3 | {'layers': ['s2_pre_rgb', 's1_pre_vv', 's2_post_rgb', 's1_post_vv', 'hazard_probability', 'affected', 'uncertainty', 'sar_reliance', 'sar_change']} |
| 33 | orchestrator | `generate_reports` | write_draft | ok | 1.4 | [{'kind': 'pdf', 'filename': 'report.pdf', 'sha256': '8c0ed90e05e6a286e9f77256ee049ca9faa3e446733b5f45dd2098f004e8aa7f', 'size_bytes': 195934}, {'kin… |

Agent steps (observe / plan / act / check / outcome):

| # | Phase | Agent | Step |
|---|---|---|---|
| 1 | plan | orchestrator | Plan formulated |
| 2 | memory | orchestrator | Recalled 1 earlier analyses of this area |
| 3 | observe | data_acquisition | Analysis grid defined |
| 4 | plan | data_acquisition | Decision: Sentinel-1 post-event acquisition |
| 5 | plan | data_acquisition | Decision: Sentinel-1 pre-event acquisition |
| 6 | observe | data_acquisition | Loaded S1 post-event observation |
| 7 | observe | data_acquisition | Loaded S1 pre-event observation |
| 8 | plan | data_acquisition | Decision: Sentinel-2 post-event acquisition |
| 9 | plan | data_acquisition | Decision: Sentinel-2 pre-event acquisition |
| 10 | observe | data_acquisition | Loaded S2 post-event observation |
| 11 | observe | data_acquisition | Loaded S2 pre-event observation |
| 12 | perceive | perception | Change detection: 78.21 km2 affected |
| 13 | semantic_state | orchestrator | Semantic state updated (perception) |
| 14 | act | impact_assessment | Exposure assessed |
| 15 | act | prioritization | Prioritised 165 response cells |
| 16 | semantic_state | orchestrator | Semantic state updated (impact and priorities) |
| 17 | act | orchestrator | Results persisted |
| 18 | memory | reporting | Retrieved 4 guidance passages (RAG) |
| 19 | act | reporting | Executive summary from deterministic template |
| 20 | act | reporting | Drafted 6 evidence-grounded alerts (pending human review) |
| 21 | guardrail | orchestrator | 1 item(s) routed to human review |
| 22 | outcome | orchestrator | Outcome: needs review |
| 23 | feedback | orchestrator | Run metrics recorded for benchmarking |

