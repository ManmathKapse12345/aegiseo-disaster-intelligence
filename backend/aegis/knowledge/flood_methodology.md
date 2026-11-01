---
id: flood-methodology
title: Multi-sensor flood change detection methodology
tags: flood, fusion, change-detection, permanent-water, uncertainty
---

## Post-classification comparison
The system maps surface water separately in pre- and post-event observations with a dual-branch gated-fusion network trained on the Sen1Floods11 hand-labelled dataset (Bonafilia et al., 2020), then derives the probability of new water as P(water after) x (1 - P(water before)). This treats the two dates as independent observations.

## Permanent water reference
The JRC Global Surface Water occurrence layer (Pekel et al., 2016) records how often each 30 m pixel was water between 1984 and 2021. Pixels that were water at least 80 % of the time are treated as permanent and excluded from flood extent. When no pre-event image is available, occurrence is used as the prior probability of pre-existing water, which may still count seasonal water as flooding.

## Sensor fusion and missing data
The gated-fusion model learns, per pixel, how much to rely on SAR versus optical features. Where clouds or no-data remove one sensor, the gate hard-switches to the other sensor. The sensor-reliance map shows which sensor drove each decision.

## Calibration and uncertainty
Probabilities are temperature-scaled on a validation split so that a predicted 0.8 corresponds to roughly 80 % observed frequency. Monte-Carlo dropout over the final feature layer gives an epistemic uncertainty estimate. High uncertainty, disagreement with independent classical methods (SAR log-ratio, MNDWI) or inputs that differ strongly from the training distribution are reasons to request analyst review.

## What the extent means
The flood extent is the area detected as newly inundated at the acquisition time of the post-event image. It is not a depth map, does not capture flooding that receded before the acquisition or occurred after it, and does not by itself establish damage.
