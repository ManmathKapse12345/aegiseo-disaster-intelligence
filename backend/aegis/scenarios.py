"""Curated case studies (real historical events) and synthetic test scenarios.

Real scenarios define only *where* and *when* to look; every observation is retrieved live
from the archives at run time. Descriptions summarise widely reported facts about each event
and are context for the user, not inputs to the analysis.
"""

from __future__ import annotations

from typing import Any

from aegis.synthetic import SYNTHETIC_BBOX

SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "pakistan-sindh-2022",
        "title": "Sindh floods, Pakistan (2022)",
        "hazard": "flood",
        "mode": "real",
        # verified against Sentinel-2 MNDWI: open water 0.6 % (27 Jun 2022) -> 39 % (10 Sep 2022) of the southern part
        "bbox": [67.72, 26.62, 67.86, 26.76],
        "event_date": "2022-08-26",
        "pre_window": ["2022-06-01", "2022-07-05"],
        "post_window": ["2022-08-26", "2022-09-10"],
        "region": "Dadu district, Sindh",
        "summary": "Record monsoon rainfall in 2022 caused extensive, long-lasting inundation across the lower Indus plains of Sindh.",
        "why": "Large, slow-moving riverine flood on flat terrain: a textbook case for SAR change detection.",
    },
    {
        "id": "emilia-romagna-2023",
        "title": "Emilia-Romagna floods, Italy (May 2023)",
        "hazard": "flood",
        "mode": "real",
        # Placed on the area still flooded at the first post-event passes (22-23 May; MNDWI of the
        # 23 May Sentinel-2 scene). Around Lugo itself the water had already drained by then.
        "bbox": [11.78, 44.48, 12.0, 44.58],
        "event_date": "2023-05-17",
        "pre_window": ["2023-04-01", "2023-05-01"],
        "post_window": ["2023-05-17", "2023-05-30"],
        "region": "Conselice / Lavezzola, Ravenna province",
        "summary": "Two intense rainfall episodes in May 2023 caused rivers to overtop embankments across the Romagna lowlands.",
        "why": "Agricultural floodplain with towns: exercises population and infrastructure exposure.",
    },
    {
        "id": "derna-2023",
        "title": "Derna flash flood, Libya (Sept 2023)",
        "hazard": "flood",
        "mode": "real",
        "bbox": [22.58, 32.71, 22.70, 32.78],
        "event_date": "2023-09-11",
        "pre_window": ["2023-08-01", "2023-09-08"],
        "post_window": ["2023-09-11", "2023-09-25"],
        "region": "Derna, Cyrenaica",
        "summary": "Storm Daniel's rainfall led to the failure of two dams upstream of Derna on 10-11 September 2023.",
        "why": "Short-lived urban flash flood: shows the limits of water mapping when water recedes before the next pass.",
    },
    {
        "id": "palisades-fire-2025",
        "title": "Palisades Fire, Los Angeles (Jan 2025)",
        "hazard": "wildfire",
        "mode": "real",
        "bbox": [-118.62, 34.03, -118.50, 34.10],
        "event_date": "2025-01-07",
        "pre_window": ["2024-12-01", "2025-01-06"],
        "post_window": ["2025-01-14", "2025-02-05"],
        "region": "Pacific Palisades, California",
        "summary": "A wind-driven wildfire that began on 7 January 2025 burned through chaparral and residential neighbourhoods.",
        "why": "Clear-sky winter imagery for dNBR burn-severity mapping in the wildland-urban interface.",
    },
    {
        "id": "wayanad-2024",
        "title": "Wayanad landslides, Kerala (July 2024)",
        "hazard": "landslide",
        "mode": "real",
        "bbox": [76.11, 11.44, 76.19, 11.52],
        "event_date": "2024-07-30",
        "pre_window": ["2024-03-01", "2024-05-31"],
        "post_window": ["2024-07-30", "2024-09-30"],
        "region": "Mundakkai / Chooralmala, Wayanad district",
        "summary": "Extreme monsoon rainfall triggered debris flows near Mundakkai and Chooralmala in the early hours of 30 July 2024.",
        "why": "Monsoon cloud cover and steep terrain: tests escalation when evidence is limited.",
    },
    {
        "id": "synthetic-flood",
        "title": "Synthetic river flood (SIMULATED)",
        "hazard": "flood",
        "mode": "synthetic",
        "bbox": list(SYNTHETIC_BBOX),
        "event_date": "2024-08-20",
        "synthetic": {"seed": 7, "cloud_cover_post": 0.3},
        "region": "Null Island test area (0N 0E)",
        "summary": "Simulated scene with known ground truth: riverine flood reaching the edge of a town and a hospital.",
        "why": "Runs fully offline; used for tests, benchmarks and demonstrations.",
    },
    {
        "id": "synthetic-flood-cloudy",
        "title": "Synthetic flood under heavy cloud (SIMULATED)",
        "hazard": "flood",
        "mode": "synthetic",
        "bbox": list(SYNTHETIC_BBOX),
        "event_date": "2024-08-20",
        "synthetic": {"seed": 11, "cloud_cover_post": 0.9},
        "region": "Null Island test area (0N 0E)",
        "summary": "Same physics with 90 % post-event cloud cover: the agent must rely on SAR.",
        "why": "Demonstrates multi-sensor fusion and cloud guardrails.",
    },
    {
        "id": "synthetic-wildfire",
        "title": "Synthetic wildfire (SIMULATED)",
        "hazard": "wildfire",
        "mode": "synthetic",
        "bbox": list(SYNTHETIC_BBOX),
        "event_date": "2024-08-20",
        "synthetic": {"seed": 3, "cloud_cover_post": 0.1},
        "region": "Null Island test area (0N 0E)",
        "summary": "Simulated burn scar with a severity gradient and synthetic active-fire detections.",
        "why": "Exercises dNBR severity mapping and corroboration.",
    },
    {
        "id": "synthetic-landslide",
        "title": "Synthetic landslides (SIMULATED)",
        "hazard": "landslide",
        "mode": "synthetic",
        "bbox": list(SYNTHETIC_BBOX),
        "event_date": "2024-08-20",
        "synthetic": {"seed": 3, "cloud_cover_post": 0.1},
        "region": "Null Island test area (0N 0E)",
        "summary": "Simulated debris-flow scars on steep forested slopes.",
        "why": "Landslide candidates always require analyst verification (HITL).",
    },
]


def get_scenario(sid: str) -> dict[str, Any] | None:
    return next((s for s in SCENARIOS if s["id"] == sid), None)
