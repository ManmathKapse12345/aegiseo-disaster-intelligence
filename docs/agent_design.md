# Agent design

The original analytics (multi-sensor change detection) is the **perception layer** of a
closed-loop agent. The agent owns an explicit goal, plan and state, acts only through
registered tools, is gated by guardrails, routes uncertainty to humans and records
everything it does.

```
Observe/Input -> Perception -> Semantic state -> Memory/RAG -> Reason/Plan -> Tool/API action
              -> Guardrails/HITL -> Outcome -> Feedback/Benchmarking
```

| Loop stage | Implementation |
|---|---|
| Observe / input | Request validation (G01-G03), scene search, AOI-level cloud measurement, imagery and context loading (`DataAcquisitionAgent`). |
| Perception | `PerceptionAgent` -> `detect_change` tool: gated-fusion water model (+ S1 specialist), dNBR, landslide indicators; calibrated probability, uncertainty, cross-method corroboration. |
| Semantic state | `AgentState.facts`: typed facts with units and evidence ids (affected area, agreement, exposure, priorities, confidence). Only facts may be cited in generated text. |
| Memory / RAG | Episodic: earlier analyses of overlapping areas and their review decisions (`recall_similar_cases`). Semantic: TF-IDF retrieval over the knowledge base, cited as `[KB:doc#section]`. |
| Reason / plan | Explicit 10-step plan; rule-based decisions P0-P9 recorded with rationale and alternatives. |
| Tool / API action | 20 registered tools with side-effect classes (`read_only`, `compute`, `write_draft`, `external`). |
| Guardrails / HITL | G01-G18; escalations create review tasks; every alert is a draft until a named human approves it. |
| Outcome | Honest terminal status, persisted results, map layers, reports. |
| Feedback / benchmarking | Per-run tool stats, guardrail outcomes and phase latencies; human decisions update alerts, priorities and memory; the benchmark suite measures behaviour. |

## State

`aegis/agents/state.py`

* **Goal**: objective, hazard, AOI, event date, windows, mode, success criteria, autonomy level (`advisory`).
* **Plan**: ordered `PlanStep`s (`validate`, `recall`, `acquire`, `data_qc`, `perceive`, `perception_qc`, `impact`, `prioritize`, `report`, `deliver`) with status.
* **Facts** (semantic state), **evidence registry** (scene items with STAC links, model version, data sources, knowledge passages, cells).
* **Decisions** (agent, question, choice, rationale, alternatives, rule), **flags**, **warnings**, **escalations**, **memory**.

## Specialist agents

| Agent | Responsibility | Tools |
|---|---|---|
| Orchestrator | Goal, plan, guardrails, adaptive replanning, escalation, persistence, outcome | `recall_similar_cases`, `escalate_to_analyst`, `render_map_layers`, `generate_reports` |
| Data acquisition | Find, select and load the best pre/post observations and context layers | `search_imagery`, `assess_cloud_cover`, `load_s1`, `load_s2`, `load_context_layers`, `load_synthetic_scene` |
| Perception (sensor fusion + change detection) | Hazard-specific detection with uncertainty | `detect_change`, `query_active_fires` |
| Impact assessment | Exposure of people, facilities, roads, land | `query_infrastructure`, `query_population`, `query_rainfall`, `query_hazard_alerts`, `compute_impact` |
| Prioritisation | Explainable ranking with sensitivity analysis | `prioritize_cells` |
| Reporting | Grounded summary and alerts, guidance citations | `retrieve_guidance`, `draft_alert` |

Human reviewers act through the API; publication runs the `publish_alert` tool (`external`)
with the reviewer's identity as approval token.

## Planning rules

| Rule | Situation | Action |
|---|---|---|
| P0 | Requested resolution exceeds the pixel budget | Coarsen resolution in 10 m steps |
| P1 | Several post-event SAR passes | Earliest pass (closest to the event, cloud-independent) |
| P2 | Several optical candidates | Measure AOI cloud from the SCL band for the top 3; pick most cloud-free with a small per-day penalty; discard if < 5 % usable |
| P3 | No post-event scene in the window | Extend the window by 7 days (max twice, never past today) |
| P4 | Pre-event SAR reference | Same relative orbit and direction as the post pass; extend 24 days back if needed; otherwise flag orbit mismatch |
| P5 | Cloudy optical (> 40 %) and low cross-method agreement | Re-run perception SAR-led and keep the result with higher agreement |
| P8 | Infrastructure (or imagery) source fails | Continue, mark the factor missing, reduce confidence |
| P9 | Population source fails | Use ESA WorldCover built-up area as a labelled proxy |

## Tools and safety policy

`aegis/agents/tools.py` - the executor enforces an allow-list, the side-effect policy
(`external` needs a human approval token), a per-run call budget (120) and cooperative
cancellation, and records arguments, status, latency and a compact result for every call
(`tool_calls` table, visible in the UI trace).

## Guardrails

| Code | Check | Outcome |
|---|---|---|
| G01 | Supported hazard | block |
| G02 | AOI size within limits | block |
| G03 | Window/date logic (pre before event, no future dates, <= 120-day windows) | block |
| G04 | At least one usable post-event observation | block -> `insufficient_data` |
| G05 | Pre-event reference available | warn |
| G06 | Pre/post baseline <= 60 days | warn |
| G07 | Sentinel-1 orbit consistency | warn |
| G08 | Optical cloud cover > 60 % | warn (SAR present) / escalate (no SAR) |
| G09 | Evidence freshness for recent events (> 10 days) | warn |
| G10 | Deep model unavailable (classical fallback) | escalate |
| G11 | Input distribution shift (max channel z > 1.5 / > 2.5) | warn / escalate |
| G12 | Implausible extent (> 60 % of AOI) | escalate |
| G13 | Mean uncertainty > 0.15 or independent agreement < 55 % | escalate |
| G14 | > 30 % of candidates removed by terrain | warn |
| G15 | Hazard type requires verification (landslide) | escalate |
| G16 | Every number/date in generated text matches recorded evidence; citations exist | block (text withheld) |
| G17 | Hedged, non-directive language | block |
| G18 | Publication: named approver, valid status, never synthetic | block |

## Human in the loop

* **Review tasks** are created for every escalation and for low-confidence Critical/High cells.
  Decisions: confirm, false positive (rejects linked alerts, sets the cell to Low), acknowledge,
  request re-run (clones the analysis).
* **Alerts** are drafts (`pending_review`) until approved; rejection is recorded with a note.
  Approval of real-data alerts runs the external `publish_alert` tool (webhook if configured).
* **Priority overrides** require a reason, keep the model category, and appear in reports.
* All decisions are written to the audit log and counted in the dashboard (override rate,
  alert rejection rate, review false-positive rate) and recalled by later runs of the same area.

## Narrative generation and grounding

Summaries and alerts are built from facts by deterministic templates. If an Anthropic API key
is configured, Claude (`claude-opus-5-5`, server-side refusal fallbacks enabled) may draft the
executive summary from the fact sheet and retrieved guidance; the draft is used only if G16
(numbers, dates, citations) and G17 pass. The model never sees imagery and never produces
measurements.
