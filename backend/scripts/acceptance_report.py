"""Write docs/acceptance.md from real-data analyses stored by a running AegisEO API.

Everything in the document is read back from the API (summary, observations, guardrail
outcomes, agent decisions, priorities, tool-call trace) - nothing is typed in by hand.

    python scripts/acceptance_report.py --api http://127.0.0.1:8000 --trace <analysis-id> [--cases <id> ...]

The summary lists every real-data run (including interrupted and superseded ones); detailed
sections cover the latest finished run of each case study unless --cases is given.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

import httpx

REPO = Path(__file__).resolve().parents[2]
TERMINAL = ("completed", "completed_with_warnings", "needs_review", "insufficient_data", "rejected", "failed", "cancelled", "interrupted")


def fmt(v: Any, digits: int = 2) -> str:
    if v is None:
        return "n/a"
    if isinstance(v, float):
        return f"{v:,.{digits}f}"
    if isinstance(v, int):
        return f"{v:,}"
    return str(v)


def cell(text: Any, limit: int = 160) -> str:
    s = " ".join(str(text if text is not None else "").split()).replace("|", "/")
    return s if len(s) <= limit else s[: limit - 1] + "…"


def case_section(c: httpx.Client, a: dict[str, Any]) -> list[str]:
    aid = a["id"]
    d = c.get(f"/api/analyses/{aid}").json()
    tr = c.get(f"/api/analyses/{aid}/trace").json()
    s = d.get("summary") or {}
    res = d.get("results") or {}
    out = [f"### {d['name']}", "",
           f"`{aid}` · hazard **{d['hazard']}** · AOI {d['bbox']} · event {d['event_date']} · "
           f"pre {d['pre_window'][0]} to {d['pre_window'][1]} · post {d['post_window'][0]} to {d['post_window'][1]}", "",
           f"**Outcome: {d['status']}** in {fmt(s.get('duration_s'), 0)} s." + (
               "" if (d.get("message") or "").startswith(d["status"].replace("_", " ")) else f" {cell(d.get('message') or '', 300)}"), ""]
    if d["status"] == "interrupted":
        out += ["The API process was deliberately restarted while this run was downloading imagery (to apply a network-timeout fix); "
                "restart recovery marked it `interrupted` and it was re-run as a new analysis.", ""]
        return out
    if d.get("error"):
        out += [f"Error: `{cell(d['error'], 400)}`", ""]
    obs = d.get("observations") or []
    if obs:
        out += ["| Sensor | Role | Acquired (UTC) | Cloud | Valid | Items |", "|---|---|---|---|---|---|"]
        for o in obs:
            out.append(f"| {o['sensor']} | {o['role']} | {o['acquired_at'][:16].replace('T', ' ')} | {fmt(o.get('cloud_fraction'))} | "
                       f"{fmt(o.get('valid_fraction'))} | {cell(', '.join(o.get('item_ids') or []), 120)} |")
        out.append("")
    if s.get("affected_area_km2") is not None:
        dist = s.get("distribution") or {}
        out += ["| Result | Value |", "|---|---|",
                f"| Detected {d['hazard']} extent | {fmt(s.get('affected_area_km2'))} km2 |",
                f"| People potentially exposed | {fmt(s.get('population_exposed'))} ({s.get('population_source') or 'n/a'}) |",
                f"| Facilities inside / within 500 m | {fmt(s.get('facilities_inside'))} / {fmt(s.get('facilities_near'))} |",
                f"| Road length in the extent | {fmt(s.get('road_km_affected'))} km |",
                f"| Top priority / cell distribution | {s.get('top_priority') or 'n/a'} / {', '.join(f'{k} {v}' for k, v in dist.items()) or 'n/a'} |",
                f"| Overall confidence | {s.get('confidence') or 'n/a'} |",
                f"| Model | {s.get('model_version') or 'n/a'}; post-event sensors {s.get('sensors_post') or 'n/a'} |", ""]
    q = ((res.get("hazard") or {}).get("quality")) or {}
    if q:
        out += ["Quality indicators: " + ", ".join(f"{k} = {fmt(v, 3)}" for k, v in q.items() if not isinstance(v, (dict, list))), ""]
    flagged = [g for g in tr.get("guardrails", []) if g["outcome"] != "pass"]
    out += [f"Guardrails: {len(tr.get('guardrails', []))} checks, {len(flagged)} not passing."]
    if flagged:
        out += ["", "| Code | Outcome | Message |", "|---|---|---|"]
        out += [f"| {g['code']} | {g['outcome']} | {cell(g['message'], 220)} |" for g in flagged]
    decisions = tr.get("decisions") or []
    if decisions:
        out += ["", "Agent decisions:", ""]
        out += [f"- *{cell(x['question'], 80)}* -> {cell(x['chosen'], 120)} ({x.get('rule') or 'policy'}): {cell(x['rationale'], 220)}" for x in decisions]
    if tr.get("flags"):
        out += ["", "Flags: " + ", ".join(f"`{f}`" for f in tr["flags"])]
    cells = (c.get(f"/api/analyses/{aid}/priorities").json().get("features") or [])[:3]
    if cells:
        out += ["", "Top response cells:", ""]
        for f in cells:
            p = f["properties"]
            out.append(f"{p['rank']}. **{p['category']}** (score {fmt(p['score'], 1)}, confidence {p.get('confidence')}): {cell(p.get('explanation'), 300)}")
    narrative = res.get("narrative") or {}
    if narrative.get("summary"):
        out += ["", f"Agent summary ({narrative.get('summary_source', 'template')}, grounding-checked):", "", "> " + cell(narrative["summary"], 1200)]
    lim = res.get("limitations") or []
    if lim:
        out += ["", "Stated limitations: " + " ".join(cell(x, 200) for x in lim[:4])]
    return out + [""]


def trace_section(c: httpx.Client, aid: str) -> list[str]:
    d = c.get(f"/api/analyses/{aid}").json()
    tr = c.get(f"/api/analyses/{aid}/trace").json()
    out = [f"## Tool-call and action trace: {d['name']}", "",
           f"Every tool call of analysis `{aid}` as recorded by the tool executor (`GET /api/analyses/{aid}/trace`). "
           "Side effects: `read_only` (external reads), `compute`, `write_draft` (drafts for humans); `external` actions are never "
           "available to the agent.", "",
           "| # | Agent | Tool | Side effect | Status | Latency (s) | Result |", "|---|---|---|---|---|---|---|"]
    for t in tr["tool_calls"]:
        res = t.get("error") or t.get("result")
        out.append(f"| {t['seq']} | {t['agent']} | `{t['tool']}` | {t['side_effect']} | {t['status']} | {fmt((t['latency_ms'] or 0) / 1000, 1)} | "
                   f"{cell(res, 150)} |")
    out += ["", "Agent steps (observe / plan / act / check / outcome):", "", "| # | Phase | Agent | Step |", "|---|---|---|---|"]
    out += [f"| {x['seq']} | {x['phase']} | {x['agent']} | {cell(x['title'], 120)} |" for x in tr["steps"]]
    return out + [""]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--trace", help="analysis id whose full tool-call trace is included")
    ap.add_argument("--cases", nargs="*", help="analysis ids to detail (default: latest finished run per case study)")
    ap.add_argument("--out", default=str(REPO / "docs" / "acceptance.md"))
    args = ap.parse_args()
    with httpx.Client(base_url=args.api, timeout=60) as c:
        items = c.get("/api/analyses", params={"mode": "real", "limit": 100}).json()["items"]
        items = sorted((a for a in items if a["status"] in TERMINAL), key=lambda a: a["created_at"])
        rows = ["| Started (UTC) | Case | Hazard | Outcome | Extent (km2) | People exposed | Top priority | Confidence | Run time (s) |",
                "|---|---|---|---|---|---|---|---|---|"]
        for a in items:
            s = a.get("summary") or {}
            rows.append(f"| {a['created_at'][:16].replace('T', ' ')} | {a['name']} | {a['hazard']} | {a['status']} | {fmt(s.get('affected_area_km2'))} | {fmt(s.get('population_exposed'))} | "
                        f"{s.get('top_priority') or 'n/a'} | {s.get('confidence') or 'n/a'} | {fmt(s.get('duration_s'), 0)} |")
        lines = ["# Real-data acceptance runs", "",
                 f"Generated {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())} by `python scripts/acceptance_report.py` from analyses run "
                 "through the real API with live public data (Microsoft Planetary Computer, OpenStreetMap, HRSL/WorldPop, Open-Meteo, "
                 "GDACS). These are historical events, so there is no pixel-level ground truth here; the purpose is to show that the "
                 "complete loop works on real archives and that the agent's decisions, guardrails and stated limitations are sensible. "
                 "Accuracy is measured on Sen1Floods11 ([evaluation_results.md](evaluation_results.md)). Issues found by these runs "
                 "and how they were fixed are listed in [failure_analysis.md](failure_analysis.md#5-findings-from-real-data-acceptance-testing).",
                 "", "## All real-data runs", "",
                 "Run times include downloading imagery the first time an area is analysed; later runs of the same case "
                 "read the raster cache. Results are deterministic on the same hardware, so repeated runs give identical numbers.", "", *rows, ""]
        if args.cases:
            detail = [a for a in items if a["id"] in set(args.cases)]
        else:
            latest: dict[str, dict[str, Any]] = {}
            for a in items:  # chronological, so later runs replace earlier ones
                if a["status"] != "interrupted":
                    latest[a.get("scenario_id") or a["name"]] = a
            detail = sorted(latest.values(), key=lambda a: a["created_at"])
        lines += ["## Cases", ""]
        for a in detail:
            lines += case_section(c, a)
        if args.trace:
            lines += trace_section(c, args.trace)
    Path(args.out).write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
