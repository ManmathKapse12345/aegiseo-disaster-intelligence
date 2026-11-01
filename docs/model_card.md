# Model card - AegisEO surface-water segmenter

| | |
|---|---|
| Deployed configuration | `gated_fusion_unet_v2` + `s1_unet` specialist (hybrid), selected automatically on the validation split (`models/selection.json`) |
| Task | Per-pixel probability of open surface water from Sentinel-1 (VV/VH) and/or Sentinel-2 (6 bands); used before and after an event to map new flooding |
| Architecture | Dual encoders (SAR 4 ch, optical 9 ch; widths 16-32-64-128), validity-aware gated fusion at every scale, shared U-Net decoder, dropout before the 1x1 head; 1.19 M parameters (S1 U-Net 0.45 M) |
| Training data | Sen1Floods11 v1.1 hand-labelled: 252 train / 89 validation chips from 10 flood events (Bolivia held out entirely) |
| Training | 40 epochs, AdamW (lr 2e-3, one-cycle), batch 4 x 192 px crops, BCE + Dice with no-data masking, best validation IoU checkpoint; ~20 min on a 4 GB laptop GPU |
| Robustness training | Radiometric domain randomisation; simulated clouds (10-100 %); whole-sensor dropout (v2: optical 30 %, SAR 10 %) |
| Calibration | Temperature scaling on validation (T = 1.664 for v2, 1.659 for v1) |
| Uncertainty | MC dropout over the final feature layer (6 samples at run time), deterministic per-tile seeds |
| Hybrid rule | Where only SAR observed a pixel, the S1 specialist's calibrated probability replaces the fusion output, blended across cloud edges (Gaussian, sigma 4 px) |

## Performance (water IoU; test = 90 chips, Bolivia = 15 chips from an unseen event)

| Condition | Test | Bolivia |
|---|---|---|
| As provided | 0.844 (F1 0.915, P 0.932, R 0.899) | 0.828 |
| 50 % simulated cloud on Sentinel-2 | 0.739 | 0.659 |
| No Sentinel-2 | 0.653 | 0.520 |
| No Sentinel-1 | 0.836 | 0.821 |

Non-permanent ("flood") water IoU, test, as provided: 0.779. Calibration (fusion model, test):
ECE 0.014 -> 0.005, NLL 0.097 -> 0.072, Brier 0.017. Uncertainty error-detection AUROC 0.885.

## Intended use

Rapid mapping of new open water to support flood situational awareness and prioritisation by
trained analysts, with human verification of consequential findings.

## Out-of-scope / known failure modes

* Flood depth, flood duration, damage.
* Water under dense vegetation or among buildings (C-band double bounce); very narrow water bodies (< 2-3 pixels).
* Arid, snow/ice and dense urban scenes are under-represented in training (G11 flags distribution shift).
* Input harmonisation is approximate: L2A vs L1C optical and gamma0 vs sigma0 radar (mitigated by augmentation).
* Learned SAR-only performance drops on unfamiliar backscatter regimes (Bolivia: 0.520 vs 0.645 for per-scene Otsu).

## Ethical considerations

Outputs describe potential exposure, not impact; they must not be used to deny assistance to
areas without detections (absence of detection is not evidence of absence). Every run reports
its limitations, and uncertain high-priority findings are routed to humans.
