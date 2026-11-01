# Guardrail and human-in-the-loop test cases

Every case below is executed automatically (`pytest` in `backend/tests`, the agent benchmark
`python -m aegis.benchmark`, or the Playwright suite). "Test" names the function that checks it.

## Input and data guardrails

| # | Scenario | Expected behaviour | Test |
|---|---|---|---|
| 1 | Unsupported hazard, AOI 5000 km2, event in the future, inverted windows | G01, G02, G03 block; run status `rejected` | `test_input_guardrails`, `test_invalid_input_rejected_by_guardrail`, benchmark A11 |
| 2 | Pre-event window ends after the event / window longer than 120 days | G03 block | `test_input_guardrails` |
| 3 | AOI outside lon/lat range, crossing the antimeridian, beyond 84 N, malformed GeoJSON | Rejected with a user-facing message (HTTP 400/422) | `test_bbox_validation_rejects_bad_order_and_ranges`, `test_geojson_parsing_variants_and_repair`, `test_input_validation_and_safety` |
| 4 | No usable post-event observation | G04 block -> `insufficient_data` | `test_no_observations_is_insufficient_data`, `test_flood_insufficient_data_paths` |
| 5 | Heavy cloud with SAR available | G08 warn; SAR leads; completed | `test_data_guardrails`, benchmark A02 |
| 6 | Heavy cloud and no SAR | G08 escalate; `needs_review`; review task created | `test_low_observability_escalates`, benchmark A03 |
| 7 | Pre/post SAR from different orbits | G07 warn; flag `s1_orbit_mismatch` | `test_orbit_mismatch_flagged`, benchmark A06 |
| 8 | No pre-event data | G05 warn; JRC occurrence prior; limitation reported | `test_flood_without_pre_event_uses_occurrence_prior`, benchmark A08 |

## Perception guardrails

| # | Scenario | Expected behaviour | Test |
|---|---|---|---|
| 9 | Deep model unavailable | Classical fallback; G10 escalate | `test_classical_fallback_without_checkpoint`, `test_classical_fallback_is_escalated`, benchmark A12 |
| 10 | Input distribution far from training data | G11 warn (> 1.5) / escalate (> 2.5) | `test_perception_guardrails` (also observed live on the Sindh case: z = 3.29) |
| 11 | Detected extent > 60 % of the AOI | G12 escalate | `test_perception_guardrails` |
| 12 | High uncertainty or low independent agreement | G13 escalate (agreement only counts with >= 20 % coverage) | `test_perception_guardrails` |
| 13 | Landslide candidates | G15 escalate; `needs_review` | `test_landslide_is_escalated_to_humans`, benchmark A10 |

## Action and output guardrails

| # | Scenario | Expected behaviour | Test |
|---|---|---|---|
| 14 | Agent attempts an external action (publish) | Blocked: needs a human approval token | `test_tool_policy_and_tracing`, probe S01 |
| 15 | Unknown tool / budget exhausted | Blocked and traced | `test_tool_policy_and_tracing`, `test_tool_budget`, probes S02-S03 |
| 16 | Generated text contains an unrecorded number, date or citation | G16 block; text withheld | `test_grounding_numbers_dates_and_citations`, probes S04-S05 |
| 17 | Casualty claims or directive orders in generated text | G17 block | `test_language_guardrail`, probe S06 |
| 18 | Approving an alert from simulated data | Approved internally only, never delivered (G18) | `test_human_review_flow`, probe S07, Playwright journey |
| 19 | Publication without a named approver | G18 block | `test_publication_guardrail`, probe S08 |

## Human-in-the-loop flows

| # | Scenario | Expected behaviour | Test |
|---|---|---|---|
| 20 | Analyst approves / rejects an alert; decides twice | Status updated, audit logged; second decision HTTP 409 | `test_human_review_flow` |
| 21 | Analyst resolves every review task of a `needs_review` analysis | Analysis becomes `completed_with_warnings` | `test_review_task_decisions` |
| 22 | Analyst marks a cell false positive | Linked alerts rejected, cell set to Low with reason | `decide_review` (`aegis/actions.py`) |
| 23 | Analyst overrides a priority (reason required) | Override stored with user, shown in reports, counted in the override rate | `test_human_review_flow` |
| 24 | Viewer tries to create / analyst tries to delete | HTTP 403 | `test_authentication_and_roles` |
| 25 | Later analysis of the same area | Earlier runs and analyst corrections recalled (episodic memory) | `test_episodic_memory_recalls_previous_runs` |

## Degradation

| # | Scenario | Expected behaviour | Test |
|---|---|---|---|
| 26 | OpenStreetMap unavailable | P8: continue; facility/road factors missing; confidence reduced | `test_graceful_degradation_when_context_sources_fail`, benchmark A04 |
| 27 | Population service unavailable | P9: built-up area proxy | same, benchmark A05 |
| 28 | Corrupted optical acquisition (half unreadable) | Analysis completes using the readable data | benchmark A07 |
| 29 | External source flapping / down | Retries, circuit breaker, stale cache served and flagged; offline mode | `test_retry_then_success`, `test_circuit_breaker_opens_and_stale_cache_is_served`, `test_offline_mode_uses_only_cache` |
| 30 | User cancels a running analysis | Cooperative cancellation -> `cancelled` | `test_cancellation_is_honoured` |
