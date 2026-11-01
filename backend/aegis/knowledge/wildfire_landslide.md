---
id: wildfire-landslide
title: Burn severity and landslide indicators
tags: wildfire, burn, dnbr, firms, landslide
---

## dNBR burn severity
The differenced Normalized Burn Ratio, dNBR = NBR(pre) - NBR(post), is the standard remote-sensing measure of burn severity (Key and Benson, 2006, FIREMON). Commonly used classes are: unburned below 0.10, low 0.10-0.27, moderate-low 0.27-0.44, moderate-high 0.44-0.66 and high above 0.66. These generic thresholds are not field-calibrated (composite burn index) for a specific ecosystem, so severity classes are indicative.

## Active fire detections
NASA FIRMS distributes MODIS (1 km) and VIIRS (375 m) active fire detections, typically within three hours of the satellite overpass. A detection marks a pixel containing at least one actively burning fire at overpass time; it is not a burned-area map. Detections near a mapped burn scar corroborate it. Historical FIRMS queries require a free MAP_KEY.

## SAR evidence for burns
Burned forest loses canopy volume scattering, which typically lowers cross-polarised (VH) backscatter. Soil moisture and vegetation phenology also change VH, so SAR-only burn mapping is a weak proxy.

## Landslide indicators
Landslides strip vegetation and expose bare soil or rock, producing a drop in NDVI, and they change surface roughness, which alters SAR backscatter. Candidate zones are restricted to slopes steep enough to fail (typically above 10 degrees). Narrow or small failures below the 10-20 m resolution of Sentinel data are often missed, and agricultural clearing, logging or construction can mimic the signal. Landslide candidates always require analyst verification with very-high-resolution imagery or field reports.
