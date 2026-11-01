---
id: sar-flood-mapping
title: SAR-based flood mapping with Sentinel-1
tags: flood, sar, sentinel-1, limitations
---

## Principle
Calm open water acts as a specular reflector for C-band radar: the signal is reflected away from the sensor and water appears dark (typically below about -18 dB in VV and -24 dB in VH sigma0). Flooded land is detected as a strong decrease in backscatter relative to a dry reference image. Because radar penetrates cloud and works day and night, Sentinel-1 is the primary sensor for monsoon and storm floods when optical images are cloud-covered.

## Standard methods
Histogram thresholding (Otsu, 1979) of VV or VH backscatter is the operational baseline used by many rapid-mapping services. Change detection with a pre-event reference (log-ratio of post to pre backscatter, Lee-filtered to reduce speckle) separates new flooding from permanent water and from naturally dark surfaces such as tarmac or dry sand. A decrease of 3 dB or more is a common change criterion. Reference: Twele et al. (2016), Martinis et al. (2015), UN-SPIDER Recommended Practice on flood mapping with Sentinel-1.

## Orbit consistency
Pre- and post-event images should come from the same relative orbit so that the viewing geometry is identical. Comparing different orbits introduces incidence-angle and look-direction differences that can mimic change; results from mixed orbits should be treated with lower confidence.

## Urban areas
Flooded built-up areas often appear brighter, not darker, because of double-bounce scattering between water surfaces and building walls. C-band SAR therefore under-detects urban flooding; absence of a detection in a town is not evidence that the town is dry. Analysts should check optical imagery or local reports for settlements.

## Vegetation and wind
Water beneath dense vegetation (flooded forest, tall crops) can increase backscatter through double-bounce and is frequently missed. Strong wind roughens the water surface and raises backscatter, which can hide open floodwater. Very dry sand and smooth surfaces can be confused with water in single-date thresholding.

## Mountainous terrain
Radar shadow and layover on steep slopes produce dark or distorted areas that are not water. Detections on slopes steeper than a few degrees or far above the local drainage (height above nearest drainage, Nobre et al., 2011) are physically implausible and should be removed or flagged.
