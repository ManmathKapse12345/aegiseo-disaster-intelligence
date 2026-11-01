# Data: sources, training dataset and preprocessing

## Operational data sources

All sources are open and need no account, except the optional FIRMS key (historical fire
data) and the optional Anthropic key (narrative). Live status and the same metadata are on
the **Data sources** page (`GET /api/sources`).

| Source | Provides | Coverage / resolution | Timeliness | Access | Main limitations |
|---|---|---|---|---|---|
| Sentinel-1 RTC (Planetary Computer) | C-band VV/VH gamma0, terrain-corrected | Global land, 2014-; 10 m pixels | Repeat 6-12 days per orbit; scenes within days | Anonymous SAS token | Double bounce in towns, flooded vegetation, wind, layover |
| Sentinel-2 L2A (Planetary Computer) | Surface reflectance + scene classification | Global land, 2015-; 10/20 m | 5-day revisit; ~1 day latency | Anonymous SAS token | Cloud; baseline 04.00 offset |
| Copernicus DEM GLO-30 | Elevation (slope, height above drainage) | Global, 30 m | Static | Free | Surface model (buildings, canopy) |
| JRC Global Surface Water v1.4 | Water occurrence 1984-2021 | Global, 30 m | Static | Free | Recent river changes |
| ESA WorldCover 2021 | Land cover | Global, 10 m | 2021 snapshot | CC BY 4.0 | Snapshot |
| Meta/CIESIN HRSL | Gridded population | Most countries, ~30 m | Vintage 2015-2020 | Public COGs (AWS) | Model-based, coverage gaps |
| WorldPop | AOI population totals (zonal API) | Global, 100 m, to 2020 | Static | Public API (GET only) | Unconstrained model |
| OpenStreetMap (Overpass) | Facilities, settlements, roads | Global, vector | Live edits | Public instances (rate limited) | Completeness varies |
| GDACS | Current disaster alerts | Global | Near-real-time | Public API | Approximate geometry |
| USGS | Earthquakes M4.5+ (7 days) | Global | Minutes | Public feed | Context only |
| NASA FIRMS | VIIRS active fires (375 m) | Global | ~3 h | Public 7-day file; MAP_KEY for history | Active fire, not burned area |
| Open-Meteo (ERA5) | Daily precipitation at AOI centre | Global, ~9-25 km | ~5-day latency | Public API | Reanalysis, coarse |

Labels used in the UI distinguish *observations* (Sentinel scenes with acquisition times),
*static references* (DEM, JRC, WorldCover, population), *near-real-time feeds* (GDACS, USGS,
FIRMS), *derived products* (probabilities, extents, priorities) and *simulated data*
(synthetic scenes at Null Island, labelled everywhere).

### Acquisition and preprocessing (per analysis)

1. **AOI** validated (geometry repair, WGS84 range, no antimeridian crossing, 0.25-1500 km2).
2. **Grid**: UTM zone of the AOI centroid, snapped to 20 m (coarsened in 10 m steps above
   2.6 million pixels). Every layer is warped onto this grid (GDAL WarpedVRT over HTTP range
   requests); results are cached as GeoTIFF keyed by item, asset and grid.
3. **Sentinel-1**: VV and VH averaged in linear power when resampling, converted to dB, and
   harmonised from RTC gamma0 to GRD sigma0 with a mid-swath incidence of 39 degrees
   (sigma0 = gamma0 x cos 39 deg, about -1.1 dB) to match the training data; slices of the
   same pass are mosaicked; pre/post pairs are taken from the same relative orbit (rule P4).
4. **Sentinel-2**: B02 B03 B04 B08 B11 B12 converted to reflectance with the BOA offset
   (-1000 DN from processing baseline 04.00); duplicate reprocessed items are removed (newest
   baseline kept); tiles of one datatake are mosaicked; pixels flagged by SCL as cloud,
   cloud shadow, cirrus or no-data are invalid. Cloud cover is measured **over the AOI**, not
   taken from the tile-level metadata.
5. **Context**: Copernicus DEM (bilinear), JRC occurrence (missing = 0 %), WorldCover (mode).
6. **Population**: HRSL counts converted to density with latitude-dependent pixel areas,
   area-averaged onto the grid and converted back to counts (totals conserved); WorldPop AOI
   total reported alongside; dasymetric fallback over WorldCover if HRSL has no coverage.

## Training dataset: Sen1Floods11

Bonafilia, D., Tellman, B., Anderson, T., Issenberg, E. (2020). *Sen1Floods11: a
georeferenced dataset to train and test deep learning flood algorithms for Sentinel-1.*
CVPR Workshops, 210-211. Downloaded from the public bucket `gs://sen1floods11` (v1.1) by
`backend/scripts/download_sen1floods11.py` (resumable, size-verified, SHA-256 manifest).

| Split | Chips | Events | Water share of valid pixels | Label no-data |
|---|---|---|---|---|
| train | 252 | 10 | 9.5 % | 13.3 % |
| valid | 89 | 10 | 11.0 % | 13.0 % |
| test | 90 | 10 | 12.5 % | 13.0 % |
| bolivia (held-out event) | 15 | 1 | 15.9 % | 27.1 % |

Each 512 x 512 chip (10 m, EPSG:4326) has Sentinel-1 VV/VH sigma0 (dB, NaN = no data),
13-band Sentinel-2 L1C TOA reflectance (int16 x 1e4, 0 = no data), hand labels (-1 no data,
0 not water, 1 water) and JRC permanent water. The official splits are used unchanged; the
Bolivia event is never seen in training or model selection.

`python -m aegis.ml.prepare` converts the GeoTIFFs into memory-mapped arrays
(`{split}_s1.npy` float16, `{split}_s2.npy` uint16 with the six bands used, labels, JRC) and
computes per-channel statistics **on the training split only** (`feature_stats.json`).

### Model inputs

* Sentinel-1 branch: VV, VH, VV-VH (dB, clipped to [-30, 5] / [-35, 0]), standardised, plus a validity channel.
* Sentinel-2 branch: six reflectance bands (clipped to [0, 1.5]), standardised, NDWI and MNDWI, plus a validity channel.
* Invalid pixels are zeroed after standardisation; the validity channels drive the fusion gate.

### Training-time augmentation

Random 192 px crops, flips and 90 degree rotations; radiometric domain randomisation
(S2 per-band gain +-10 % and offset +-0.02, S1 offset +-1.5 dB) to bridge L1C-vs-L2A and
sigma0-vs-gamma0 differences; simulated cloud masks (smooth random blobs, 10-100 % cover);
whole-sensor dropout (v2: 30 % optical removed, 10 % SAR removed).

## Synthetic scenes

`aegis/synthetic.py` generates deterministic scenes with ground truth for tests, the agent
benchmark and the offline demo: a valley DEM with river and lake, land cover (towns, cropland,
forest), Sentinel-2-like reflectance with clouds and offset shadows, Sentinel-1-like sigma0
with Gamma speckle (ENL 4.4) and the double-bounce brightening of flooded buildings, and
flood / wildfire / landslide footprints. All synthetic scenes sit at Null Island (0 N 0 E, open
ocean) and every derived product is flagged `synthetic`.
