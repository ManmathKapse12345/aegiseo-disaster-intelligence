/** Headline accuracy numbers read from the server's own evaluation file (models/evaluation.json via /api/model). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export interface AccuracyHeadline {
  overlap: number;
  noOptical: number | null;
  calibration: string | null;
  chips: string | null;
  selected: string;
}

export function deployedEntry(ev: Json | null | undefined): Json | null {
  if (!ev?.selection) return null;
  const sel = ev.selection.selected;
  return ev.hybrids?.[sel] ?? ev.models?.[sel] ?? ev.models?.[ev.selection.model_variant] ?? null;
}

export function accuracyHeadline(model: Json | undefined): AccuracyHeadline | null {
  const ev = model?.evaluation as Json | undefined;
  const entry = deployedEntry(ev);
  const test = entry?.splits?.test;
  if (typeof test?.as_is?.iou !== "number") return null;
  const pct = (v: number) => Math.round(v * 100);
  const ece = test.as_is.calibration?.ece ?? ev?.models?.[ev?.selection?.model_variant]?.splits?.test?.as_is?.calibration?.ece;
  return {
    overlap: pct(test.as_is.iou),
    noOptical: typeof test.no_s2?.iou === "number" ? pct(test.no_s2.iou) : null,
    calibration: typeof ece === "number" ? `${(ece * 100).toFixed(1)} pts` : null,
    chips: /test = (\d+) chips/.exec(String(ev?.dataset ?? ""))?.[1] ?? null,
    selected: String(ev?.selection?.selected ?? ""),
  };
}

/** Method names in plain words (ids from backend/aegis/ml/evaluate.py). */
export const METHOD_NAMES: Record<string, string> = {
  otsu_vh: "Simple radar rule (VH)", otsu_vv: "Simple radar rule (VV)", mndwi: "Simple water-colour rule", rule_fusion: "Simple combined rule",
  s1_unet: "Radar-only model", s2_unet: "Camera-only model", early_fusion_unet: "Combined model (basic)", gated_fusion_unet: "Combined model v1",
  gated_fusion_unet_v2: "Combined model v2", "hybrid_gated_fusion_unet+s1_unet": "Combined v1 + radar helper",
  "hybrid_gated_fusion_unet_v2+s1_unet": "Combined v2 + radar helper",
};
export const CONDITIONS: [string, string][] = [["as_is", "Normal photos"], ["cloud_50", "Half hidden by cloud"], ["no_s2", "No camera photos"], ["no_s1", "No radar photos"]];
