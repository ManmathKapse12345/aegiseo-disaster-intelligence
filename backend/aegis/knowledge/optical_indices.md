---
id: optical-indices
title: Sentinel-2 optical data and spectral indices
tags: sentinel-2, optical, clouds, ndwi, mndwi, ndvi, nbr
---

## Sentinel-2 Level-2A
Sentinel-2 MSI provides 13 spectral bands at 10, 20 and 60 m. Level-2A products are atmospherically corrected surface reflectance with a Scene Classification Layer (SCL) that flags clouds (medium and high probability), cloud shadows, thin cirrus and snow. Since processing baseline 04.00 (January 2022) reflectance values carry an offset of -1000 that must be applied before computing indices.

## Water indices
NDWI = (Green - NIR) / (Green + NIR) (McFeeters, 1996) and MNDWI = (Green - SWIR1) / (Green + SWIR1) (Xu, 2006) are positive over open water. MNDWI suppresses built-up surfaces better than NDWI. Turbid floodwater has higher visible reflectance than clear water but remains dark in the shortwave infrared.

## Vegetation and burn indices
NDVI = (NIR - Red) / (NIR + Red) measures green vegetation. NBR = (NIR - SWIR2) / (NIR + SWIR2) drops sharply after fire because burning removes chlorophyll (lower NIR) and exposes dry, charred surfaces (higher SWIR).

## Clouds and shadows
Optical sensors cannot see through cloud. Cloud shadows are dark and can be confused with water; they must be masked. Residual undetected thin cloud raises reflectance in all bands. When more than about 60 % of an area is cloud-covered, optical evidence should be considered insufficient and SAR should lead the analysis.

## Seasonal effects
Comparing images from different seasons can produce apparent change from crop cycles, irrigation, snow or phenology. Pre-event references should be as close in time to the event as cloud cover allows, ideally within one to two months.
