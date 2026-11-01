# Model evaluation (auto-generated)

Generated 2026-11-01T03:52:49Z by `python -m aegis.ml.evaluate`. Dataset: Sen1Floods11 v1.1 hand-labelled; test = 90 chips, bolivia = 15 chips (held-out event).

## Deployed configuration (selected on the validation split)

Selected: **hybrid_gated_fusion_unet_v2+s1_unet** - criterion: mean IoU over ['as_is', 'cloud_50', 'no_s2', 'no_s1'] on the 'valid' split. Test and Bolivia results below were not used for selection.

| Candidate | Validation score |
|---|---|
| hybrid_gated_fusion_unet_v2+s1_unet | 0.7566 |
| hybrid_gated_fusion_unet+s1_unet | 0.7488 |
| gated_fusion_unet_v2 | 0.7374 |
| early_fusion_unet | 0.7194 |
| gated_fusion_unet | 0.7190 |

## Split: `valid`

| Method | Condition | IoU | F1 | Precision | Recall | Flood IoU (excl. permanent) | ECE (calibrated) |
|---|---|---|---|---|---|---|---|
| s1_unet | as_is | 0.630 | 0.773 | 0.838 | 0.718 | 0.522 | 0.009 |
| s1_unet | cloud_50 | 0.630 | 0.773 | 0.838 | 0.718 | 0.522 | 0.009 |
| s1_unet | no_s2 | 0.630 | 0.773 | 0.838 | 0.718 | 0.522 | 0.009 |
| s1_unet | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| s2_unet | as_is | 0.822 | 0.902 | 0.917 | 0.887 | 0.772 | 0.004 |
| s2_unet | cloud_50 | 0.424 | 0.596 | 0.913 | 0.442 | 0.406 | 0.055 |
| s2_unet | no_s2 | n/a | n/a | n/a | n/a | n/a | n/a |
| s2_unet | no_s1 | 0.822 | 0.902 | 0.917 | 0.887 | 0.772 | 0.004 |
| early_fusion_unet | as_is | 0.830 | 0.907 | 0.906 | 0.908 | 0.781 | 0.005 |
| early_fusion_unet | cloud_50 | 0.689 | 0.816 | 0.868 | 0.770 | 0.600 | 0.008 |
| early_fusion_unet | no_s2 | 0.536 | 0.698 | 0.825 | 0.605 | 0.408 | 0.023 |
| early_fusion_unet | no_s1 | 0.823 | 0.903 | 0.885 | 0.922 | 0.775 | 0.008 |
| gated_fusion_unet | as_is | 0.833 | 0.909 | 0.935 | 0.885 | 0.783 | 0.004 |
| gated_fusion_unet | cloud_50 | 0.701 | 0.824 | 0.922 | 0.745 | 0.627 | 0.014 |
| gated_fusion_unet | no_s2 | 0.537 | 0.699 | 0.913 | 0.566 | 0.445 | 0.030 |
| gated_fusion_unet | no_s1 | 0.806 | 0.892 | 0.922 | 0.864 | 0.752 | 0.006 |
| gated_fusion_unet_v2 | as_is | 0.839 | 0.913 | 0.928 | 0.898 | 0.793 | 0.003 |
| gated_fusion_unet_v2 | cloud_50 | 0.712 | 0.832 | 0.906 | 0.768 | 0.634 | 0.008 |
| gated_fusion_unet_v2 | no_s2 | 0.571 | 0.727 | 0.890 | 0.614 | 0.468 | 0.017 |
| gated_fusion_unet_v2 | no_s1 | 0.828 | 0.906 | 0.913 | 0.899 | 0.781 | 0.006 |
| hybrid_gated_fusion_unet+s1_unet | as_is | 0.833 | 0.909 | 0.935 | 0.885 | 0.783 | 0.004 |
| hybrid_gated_fusion_unet+s1_unet | cloud_50 | 0.727 | 0.842 | 0.883 | 0.804 | 0.645 | 0.005 |
| hybrid_gated_fusion_unet+s1_unet | no_s2 | 0.630 | 0.773 | 0.838 | 0.718 | 0.522 | 0.009 |
| hybrid_gated_fusion_unet+s1_unet | no_s1 | 0.806 | 0.892 | 0.922 | 0.864 | 0.752 | 0.006 |
| hybrid_gated_fusion_unet_v2+s1_unet | as_is | 0.839 | 0.913 | 0.928 | 0.898 | 0.793 | 0.003 |
| hybrid_gated_fusion_unet_v2+s1_unet | cloud_50 | 0.729 | 0.843 | 0.880 | 0.810 | 0.649 | 0.005 |
| hybrid_gated_fusion_unet_v2+s1_unet | no_s2 | 0.630 | 0.773 | 0.838 | 0.718 | 0.522 | 0.009 |
| hybrid_gated_fusion_unet_v2+s1_unet | no_s1 | 0.828 | 0.906 | 0.913 | 0.899 | 0.781 | 0.006 |
| otsu_vv | as_is | 0.429 | 0.601 | 0.601 | 0.601 | 0.328 | n/a |
| otsu_vv | cloud_50 | 0.429 | 0.601 | 0.601 | 0.601 | 0.328 | n/a |
| otsu_vv | no_s2 | 0.429 | 0.601 | 0.601 | 0.601 | 0.328 | n/a |
| otsu_vv | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| otsu_vh | as_is | 0.381 | 0.551 | 0.446 | 0.722 | 0.285 | n/a |
| otsu_vh | cloud_50 | 0.381 | 0.551 | 0.446 | 0.722 | 0.285 | n/a |
| otsu_vh | no_s2 | 0.381 | 0.551 | 0.446 | 0.722 | 0.285 | n/a |
| otsu_vh | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| mndwi | as_is | 0.600 | 0.750 | 0.611 | 0.969 | 0.522 | n/a |
| mndwi | cloud_50 | 0.368 | 0.538 | 0.605 | 0.484 | 0.339 | n/a |
| mndwi | no_s2 | n/a | n/a | n/a | n/a | n/a | n/a |
| mndwi | no_s1 | 0.600 | 0.750 | 0.611 | 0.969 | 0.522 | n/a |
| rule_fusion | as_is | 0.599 | 0.749 | 0.611 | 0.969 | 0.522 | n/a |
| rule_fusion | cloud_50 | 0.476 | 0.645 | 0.521 | 0.846 | 0.387 | n/a |
| rule_fusion | no_s2 | 0.381 | 0.551 | 0.446 | 0.722 | 0.285 | n/a |
| rule_fusion | no_s1 | 0.600 | 0.750 | 0.611 | 0.969 | 0.522 | n/a |

## Split: `test`

| Method | Condition | IoU | F1 | Precision | Recall | Flood IoU (excl. permanent) | ECE (calibrated) |
|---|---|---|---|---|---|---|---|
| s1_unet | as_is | 0.653 | 0.790 | 0.840 | 0.745 | 0.510 | 0.007 |
| s1_unet | cloud_50 | 0.653 | 0.790 | 0.840 | 0.745 | 0.510 | 0.007 |
| s1_unet | no_s2 | 0.653 | 0.790 | 0.840 | 0.745 | 0.510 | 0.007 |
| s1_unet | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| s2_unet | as_is | 0.833 | 0.909 | 0.924 | 0.894 | 0.767 | 0.006 |
| s2_unet | cloud_50 | 0.419 | 0.590 | 0.924 | 0.434 | 0.370 | 0.065 |
| s2_unet | no_s2 | n/a | n/a | n/a | n/a | n/a | n/a |
| s2_unet | no_s1 | 0.833 | 0.909 | 0.924 | 0.894 | 0.767 | 0.006 |
| early_fusion_unet | as_is | 0.828 | 0.906 | 0.909 | 0.902 | 0.757 | 0.008 |
| early_fusion_unet | cloud_50 | 0.691 | 0.817 | 0.875 | 0.767 | 0.584 | 0.012 |
| early_fusion_unet | no_s2 | 0.555 | 0.714 | 0.832 | 0.625 | 0.424 | 0.026 |
| early_fusion_unet | no_s1 | 0.824 | 0.903 | 0.896 | 0.911 | 0.754 | 0.010 |
| gated_fusion_unet | as_is | 0.841 | 0.914 | 0.939 | 0.890 | 0.774 | 0.005 |
| gated_fusion_unet | cloud_50 | 0.699 | 0.823 | 0.918 | 0.746 | 0.607 | 0.018 |
| gated_fusion_unet | no_s2 | 0.562 | 0.720 | 0.899 | 0.600 | 0.458 | 0.032 |
| gated_fusion_unet | no_s1 | 0.835 | 0.910 | 0.923 | 0.897 | 0.771 | 0.006 |
| gated_fusion_unet_v2 | as_is | 0.844 | 0.915 | 0.932 | 0.899 | 0.779 | 0.005 |
| gated_fusion_unet_v2 | cloud_50 | 0.722 | 0.839 | 0.906 | 0.780 | 0.614 | 0.009 |
| gated_fusion_unet_v2 | no_s2 | 0.612 | 0.760 | 0.883 | 0.666 | 0.470 | 0.016 |
| gated_fusion_unet_v2 | no_s1 | 0.836 | 0.911 | 0.919 | 0.903 | 0.772 | 0.008 |
| hybrid_gated_fusion_unet+s1_unet | as_is | 0.841 | 0.914 | 0.939 | 0.890 | 0.774 | 0.005 |
| hybrid_gated_fusion_unet+s1_unet | cloud_50 | 0.737 | 0.848 | 0.886 | 0.813 | 0.625 | 0.006 |
| hybrid_gated_fusion_unet+s1_unet | no_s2 | 0.653 | 0.790 | 0.840 | 0.745 | 0.510 | 0.007 |
| hybrid_gated_fusion_unet+s1_unet | no_s1 | 0.835 | 0.910 | 0.924 | 0.897 | 0.771 | 0.005 |
| hybrid_gated_fusion_unet_v2+s1_unet | as_is | 0.844 | 0.915 | 0.932 | 0.899 | 0.779 | 0.006 |
| hybrid_gated_fusion_unet_v2+s1_unet | cloud_50 | 0.739 | 0.850 | 0.883 | 0.819 | 0.629 | 0.006 |
| hybrid_gated_fusion_unet_v2+s1_unet | no_s2 | 0.653 | 0.790 | 0.840 | 0.745 | 0.510 | 0.007 |
| hybrid_gated_fusion_unet_v2+s1_unet | no_s1 | 0.836 | 0.911 | 0.919 | 0.903 | 0.772 | 0.007 |
| otsu_vv | as_is | 0.431 | 0.603 | 0.621 | 0.585 | 0.342 | n/a |
| otsu_vv | cloud_50 | 0.431 | 0.603 | 0.621 | 0.585 | 0.342 | n/a |
| otsu_vv | no_s2 | 0.431 | 0.603 | 0.621 | 0.585 | 0.342 | n/a |
| otsu_vv | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| otsu_vh | as_is | 0.392 | 0.563 | 0.479 | 0.684 | 0.301 | n/a |
| otsu_vh | cloud_50 | 0.392 | 0.563 | 0.479 | 0.684 | 0.301 | n/a |
| otsu_vh | no_s2 | 0.392 | 0.563 | 0.479 | 0.684 | 0.301 | n/a |
| otsu_vh | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| mndwi | as_is | 0.653 | 0.790 | 0.679 | 0.945 | 0.549 | n/a |
| mndwi | cloud_50 | 0.378 | 0.548 | 0.680 | 0.459 | 0.320 | n/a |
| mndwi | no_s2 | n/a | n/a | n/a | n/a | n/a | n/a |
| mndwi | no_s1 | 0.653 | 0.790 | 0.679 | 0.945 | 0.549 | n/a |
| rule_fusion | as_is | 0.653 | 0.790 | 0.679 | 0.946 | 0.549 | n/a |
| rule_fusion | cloud_50 | 0.512 | 0.677 | 0.579 | 0.815 | 0.411 | n/a |
| rule_fusion | no_s2 | 0.392 | 0.563 | 0.479 | 0.684 | 0.301 | n/a |
| rule_fusion | no_s1 | 0.653 | 0.790 | 0.679 | 0.945 | 0.549 | n/a |

## Split: `bolivia`

| Method | Condition | IoU | F1 | Precision | Recall | Flood IoU (excl. permanent) | ECE (calibrated) |
|---|---|---|---|---|---|---|---|
| s1_unet | as_is | 0.520 | 0.684 | 0.890 | 0.555 | 0.501 | 0.056 |
| s1_unet | cloud_50 | 0.520 | 0.684 | 0.890 | 0.555 | 0.501 | 0.056 |
| s1_unet | no_s2 | 0.520 | 0.684 | 0.890 | 0.555 | 0.501 | 0.056 |
| s1_unet | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| s2_unet | as_is | 0.818 | 0.900 | 0.901 | 0.899 | 0.811 | 0.014 |
| s2_unet | cloud_50 | 0.402 | 0.574 | 0.887 | 0.424 | 0.403 | 0.090 |
| s2_unet | no_s2 | n/a | n/a | n/a | n/a | n/a | n/a |
| s2_unet | no_s1 | 0.818 | 0.900 | 0.901 | 0.899 | 0.811 | 0.014 |
| early_fusion_unet | as_is | 0.818 | 0.900 | 0.890 | 0.910 | 0.811 | 0.010 |
| early_fusion_unet | cloud_50 | 0.708 | 0.829 | 0.898 | 0.770 | 0.697 | 0.023 |
| early_fusion_unet | no_s2 | 0.597 | 0.747 | 0.914 | 0.632 | 0.582 | 0.054 |
| early_fusion_unet | no_s1 | 0.813 | 0.897 | 0.888 | 0.906 | 0.806 | 0.010 |
| gated_fusion_unet | as_is | 0.829 | 0.906 | 0.927 | 0.887 | 0.823 | 0.005 |
| gated_fusion_unet | cloud_50 | 0.558 | 0.717 | 0.911 | 0.590 | 0.544 | 0.047 |
| gated_fusion_unet | no_s2 | 0.280 | 0.438 | 0.902 | 0.289 | 0.257 | 0.092 |
| gated_fusion_unet | no_s1 | 0.825 | 0.904 | 0.905 | 0.902 | 0.818 | 0.010 |
| gated_fusion_unet_v2 | as_is | 0.827 | 0.906 | 0.915 | 0.897 | 0.821 | 0.006 |
| gated_fusion_unet_v2 | cloud_50 | 0.573 | 0.729 | 0.899 | 0.612 | 0.566 | 0.041 |
| gated_fusion_unet_v2 | no_s2 | 0.329 | 0.496 | 0.899 | 0.342 | 0.320 | 0.077 |
| gated_fusion_unet_v2 | no_s1 | 0.821 | 0.902 | 0.908 | 0.895 | 0.814 | 0.011 |
| hybrid_gated_fusion_unet+s1_unet | as_is | 0.829 | 0.906 | 0.927 | 0.887 | 0.823 | 0.005 |
| hybrid_gated_fusion_unet+s1_unet | cloud_50 | 0.659 | 0.795 | 0.906 | 0.708 | 0.645 | 0.031 |
| hybrid_gated_fusion_unet+s1_unet | no_s2 | 0.520 | 0.684 | 0.890 | 0.555 | 0.501 | 0.056 |
| hybrid_gated_fusion_unet+s1_unet | no_s1 | 0.823 | 0.903 | 0.906 | 0.899 | 0.816 | 0.009 |
| hybrid_gated_fusion_unet_v2+s1_unet | as_is | 0.828 | 0.906 | 0.915 | 0.897 | 0.822 | 0.006 |
| hybrid_gated_fusion_unet_v2+s1_unet | cloud_50 | 0.659 | 0.794 | 0.897 | 0.712 | 0.645 | 0.029 |
| hybrid_gated_fusion_unet_v2+s1_unet | no_s2 | 0.520 | 0.684 | 0.890 | 0.555 | 0.501 | 0.056 |
| hybrid_gated_fusion_unet_v2+s1_unet | no_s1 | 0.821 | 0.902 | 0.908 | 0.895 | 0.814 | 0.009 |
| otsu_vv | as_is | 0.575 | 0.730 | 0.834 | 0.649 | 0.559 | n/a |
| otsu_vv | cloud_50 | 0.575 | 0.730 | 0.834 | 0.649 | 0.559 | n/a |
| otsu_vv | no_s2 | 0.575 | 0.730 | 0.834 | 0.649 | 0.559 | n/a |
| otsu_vv | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| otsu_vh | as_is | 0.645 | 0.784 | 0.745 | 0.828 | 0.632 | n/a |
| otsu_vh | cloud_50 | 0.645 | 0.784 | 0.745 | 0.828 | 0.632 | n/a |
| otsu_vh | no_s2 | 0.645 | 0.784 | 0.745 | 0.828 | 0.632 | n/a |
| otsu_vh | no_s1 | n/a | n/a | n/a | n/a | n/a | n/a |
| mndwi | as_is | 0.556 | 0.715 | 0.568 | 0.965 | 0.541 | n/a |
| mndwi | cloud_50 | 0.334 | 0.501 | 0.557 | 0.456 | 0.331 | n/a |
| mndwi | no_s2 | n/a | n/a | n/a | n/a | n/a | n/a |
| mndwi | no_s1 | 0.556 | 0.715 | 0.568 | 0.965 | 0.541 | n/a |
| rule_fusion | as_is | 0.559 | 0.717 | 0.569 | 0.970 | 0.545 | n/a |
| rule_fusion | cloud_50 | 0.599 | 0.749 | 0.642 | 0.900 | 0.585 | n/a |
| rule_fusion | no_s2 | 0.645 | 0.784 | 0.745 | 0.828 | 0.632 | n/a |
| rule_fusion | no_s1 | 0.556 | 0.715 | 0.568 | 0.965 | 0.541 | n/a |

## Calibration of the fusion model `gated_fusion_unet_v2` (test, as_is)

| | ECE | MCE | Brier | NLL |
|---|---|---|---|---|
| before temperature scaling | 0.014 | 0.199 | 0.018 | 0.097 |
| after (T = 1.664) | 0.005 | 0.116 | 0.017 | 0.072 |

## Uncertainty quality (MC dropout, test split)

* error-detection AUROC (predictive entropy): 0.885
* error-detection AUROC (MC std): 0.862

| Coverage (most confident pixels kept) | Accuracy | IoU |
|---|---|---|
| 100% | 0.975 | 0.816 |
| 95% | 0.987 | 0.884 |
| 90% | 0.994 | 0.939 |
| 80% | 0.995 | 0.925 |
| 70% | 0.995 | 0.885 |
