---
title: AegisEO Disaster Intelligence
emoji: 🛰️
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
short_description: Sentinel-1/2 disaster mapping and response priorities
---

# AegisEO - agentic multi-sensor disaster change detection

AegisEO turns Sentinel-1 radar and Sentinel-2 optical imagery into evidence-backed response
priorities. An AI agent finds and quality-checks the satellite data, maps what changed with a
calibrated multi-sensor model, estimates potential exposure, ranks response cells with
explanations, and routes uncertain or high-impact findings to human reviewers. Nothing is
published without human approval.

**Try it:** *Try the offline demo* runs a clearly labelled simulated scene in seconds. Real case
studies (Sindh 2022, Palisades 2025, ...) download live archive data and take 5-10 minutes on
this free CPU hardware.

**Notes for this demo deployment**

* Storage is temporary: analyses disappear when the Space restarts or sleeps.
* Results describe *potential* exposure from public data; they are not official assessments.
* Built entirely on public data: Copernicus Sentinel (via Microsoft Planetary Computer),
  Copernicus DEM, JRC Global Surface Water, ESA WorldCover, OpenStreetMap, HRSL/WorldPop,
  GDACS, USGS, NASA FIRMS, Open-Meteo, and the Sen1Floods11 training dataset.
