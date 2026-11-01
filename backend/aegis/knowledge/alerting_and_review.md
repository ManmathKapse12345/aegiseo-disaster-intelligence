---
id: alerting-review
title: Evidence-grounded alerting and human review
tags: alerts, communication, hitl, escalation, guardrails
---

## Grounded statements
Every quantitative statement in an alert must be traceable to a recorded measurement or model output (scene identifiers, model version, computed areas, counts and their data sources). Statements without evidence must not be published.

## Hedged, accurate language
Alerts describe what was detected, where, when it was observed, how confident the system is and what is not known. They avoid certainty the evidence does not support (for example "confirmed casualties" or "everyone must evacuate") and do not issue operational orders. Recommended actions are framed as considerations for authorised responders.

## When to escalate to a human analyst
Escalate when: optical data are mostly cloud-covered and SAR evidence is weak or absent; model uncertainty is high or independent methods disagree; inputs differ strongly from the training distribution; the detected extent is implausibly large; a life-safety facility appears affected; or the deep model was unavailable and classical rules were used.

## Review outcomes
An analyst may approve an alert for publication, reject it as a false positive, override a priority category with a written justification, or request re-analysis with different dates. All decisions are logged with the reviewer identity and are used to measure override and escalation rates and to inform later analyses of the same area.

## Synthetic data
Results derived from simulated scenes are for testing and training only and must never be published as real alerts.
