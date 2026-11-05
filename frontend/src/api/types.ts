export type Hazard = "flood" | "wildfire" | "landslide";
export type Category = "Critical" | "High" | "Moderate" | "Low";
export type AnalysisStatus =
  | "queued" | "running" | "completed" | "completed_with_warnings" | "needs_review"
  | "failed" | "cancelled" | "insufficient_data" | "rejected" | "interrupted";

export interface AnalysisSummary {
  status: AnalysisStatus;
  mode: "real" | "synthetic";
  hazard: Hazard;
  affected_area_km2: number | null;
  population_exposed: number | null;
  population_source: string | null;
  facilities_inside: number | null;
  facilities_near: number | null;
  road_km_affected: number | null;
  top_priority: Category | null;
  distribution: Record<Category, number> | null;
  confidence: "High" | "Medium" | "Low" | null;
  post_observation_date: string | null;
  sensors_post: string | null;
  model_version: string | null;
  escalations: number;
  warnings: number;
  duration_s: number;
}

export interface AnalysisBrief {
  id: string;
  name: string;
  hazard: Hazard;
  mode: "real" | "synthetic";
  status: AnalysisStatus;
  stage: string | null;
  progress: number;
  message: string | null;
  bbox: [number, number, number, number];
  area_km2: number;
  event_date: string;
  pre_window: [string, string];
  post_window: [string, string];
  summary: AnalysisSummary | null;
  top_priority: Category | null;
  confidence: string | null;
  scenario_id: string | null;
  created_by: string;
  created_at: string | null;
  completed_at: string | null;
  error: string | null;
}

export interface Observation {
  sensor: "S1" | "S2";
  role: "pre" | "post";
  acquired_at: string;
  collection: string;
  item_ids: string[];
  cloud_fraction: number | null;
  valid_fraction: number;
  meta: Record<string, unknown> | null;
  synthetic: boolean;
}

export interface LayerInfo {
  id: string;
  title: string;
  group: "imagery" | "analysis" | "diagnostics";
  url: string;
  corners: [number, number][];
  legend: { type: string; min?: string; max?: string; colors?: string[]; items?: { label: string; color: string }[] };
  description: string;
  date: string | null;
  default: boolean;
  opacity: number;
  synthetic: boolean;
}

export interface Passage { ref: string; doc_id: string; doc_title: string; section: string; text: string; score?: number; tags: string[] }

export interface AnalysisResults {
  hazard: {
    method: string;
    methodology: string[];
    quality: Record<string, unknown> & {
      sensors_post?: string[];
      sensors_pre?: string[];
      s2_post_cloud_fraction?: number | null;
      cross_method_agreement?: number | null;
      mean_uncertainty_detected?: number | null;
      mean_probability_detected?: number | null;
      affected_fraction_of_aoi?: number;
      model_method?: string;
      distribution_shift?: { max_z: number; worst_channel: string | null };
      mean_sar_reliance_detected?: number | null;
      terrain_suppressed_fraction?: number;
    };
    stats: Record<string, number | null | Record<string, number>>;
    model_info: Record<string, unknown>;
    limitations: string[];
  } | null;
  impact: {
    affected_area_km2: number;
    population: { available: boolean; potentially_exposed?: number; aoi_total?: number; source?: string; method?: string; note?: string; year?: number | null };
    facility_counts: Record<string, { inside: number; near: number; total: number }>;
    roads: { available: boolean; affected_km?: number; affected_km_by_class?: Record<string, number>; total_km_in_aoi_by_class?: Record<string, number> };
    settlements_affected: { name: string; status: string; distance_m: number | null; tags: Record<string, string> }[];
    landcover_affected_ha: Record<string, number> | null;
    built_up_affected_km2: number | null;
    limitations: string[];
  } | null;
  context: { rainfall?: { series?: { date: string; mm: number }[]; total_mm?: number; peak_day?: { date: string; mm: number }; note?: string; unavailable?: string }; gdacs_nearby?: unknown };
  priorities: { cell_km: number; distribution: Record<Category, number>; weights: Record<string, number>; thresholds: Record<string, number>; sensitivity: Record<string, number>; exposure_basis: string } | null;
  narrative: { summary: string; summary_source: string; llm?: Record<string, unknown>; alerts?: string[] } | null;
  guidance: Passage[];
  layers: LayerInfo[];
  limitations: string[];
  agent: { goal: Record<string, unknown>; flags: string[]; warnings: string[]; escalations: Escalation[] } | null;
  agent_metrics: { tool_stats: ToolStats; guardrail_outcomes: Record<string, number>; phase_ms: Record<string, number>; duration_s: number } | null;
}

export interface Escalation { code: string; name: string; message: string; stage: string }
export interface ToolStats { calls: number; ok: number; errors: number; blocked: number; success_rate: number | null; total_latency_ms: number }

export interface AnalysisDetail extends AnalysisBrief {
  aoi: GeoJSON.Geometry;
  params: Record<string, unknown>;
  results: AnalysisResults | null;
  observations: Observation[];
  reports: { kind: string; filename: string; sha256: string; size_bytes: number; created_at: string; url: string }[];
  counts: { alerts_pending: number; reviews_open: number };
}

export interface Facility { id: string | null; category: string; name: string | null; status: "inside" | "near" | "outside"; distance_m: number | null; lon: number; lat: number }

export interface CellProps {
  cell_id: string;
  rank: number;
  score: number;
  category: Category;
  model_category: Category;
  override_reason: string | null;
  overridden_by: string | null;
  confidence: "High" | "Medium" | "Low";
  confidence_score: number;
  hazard_subscore: number;
  exposure_subscore: number;
  affected_km2: number;
  affected_fraction: number;
  mean_confidence: number;
  mean_uncertainty: number;
  cross_method_agreement: number | null;
  population_exposed: number | null;
  built_up_affected_km2: number | null;
  road_km_affected: number | null;
  facilities: Facility[];
  exposure_basis: string;
  factors: Record<string, number | null>;
  contributions: { hazard: Record<string, number>; exposure: Record<string, number> };
  missing_factors: string[];
  explanation: string;
  recommended_actions: string[];
  needs_verification: boolean;
  floor_rule_applied: boolean;
  data_completeness: number;
  centroid: [number, number];
  sensitivity?: { p_top_k: number; category_stability: number; rank_p10: number; rank_p90: number };
}

export interface Trace {
  goal: Record<string, unknown> | null;
  plan: { id: string; agent: string; action: string; purpose: string; status: string; note: string | null }[] | null;
  decisions: { agent: string; question: string; chosen: string; rationale: string; alternatives: string[]; rule: string | null }[];
  facts: Record<string, { key: string; value: unknown; unit: string | null; source: string; description: string }>;
  evidence: Record<string, { id: string; kind: string; description: string; stac_items?: string[]; [k: string]: unknown }>;
  flags: string[];
  escalations: Escalation[];
  metrics: AnalysisResults["agent_metrics"];
  steps: { seq: number; phase: string; agent: string; title: string; detail: string | null; rationale: string | null; data: unknown; status: string; duration_ms: number | null; at: string }[];
  tool_calls: { seq: number; agent: string; tool: string; side_effect: string; args: unknown; status: string; error: string | null; latency_ms: number; result: unknown; at: string }[];
  guardrails: { code: string; name: string; stage: string; outcome: "pass" | "warn" | "escalate" | "block"; message: string; value: unknown; threshold: unknown }[];
}

export interface Alert {
  id: string;
  analysis_id: string;
  analysis_name: string | null;
  hazard: Hazard | null;
  cell_id: string | null;
  severity: Category;
  title: string;
  body: string;
  evidence: string[];
  grounding: { verified: boolean; regenerated?: boolean; checks: { code: string; outcome: string; message: string }[] } | null;
  confidence: string | null;
  status: "pending_review" | "approved" | "published" | "rejected";
  requires_approval: boolean;
  synthetic: boolean;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  delivery: Record<string, unknown> | null;
}

export interface ReviewTask {
  id: string;
  analysis_id: string;
  analysis_name: string | null;
  hazard: Hazard | null;
  mode: string | null;
  alert_id: string | null;
  kind: string;
  severity: string;
  title: string;
  reason: string;
  payload: Record<string, unknown> | null;
  status: "open" | "resolved";
  decision: string | null;
  decided_by: string | null;
  decided_at: string | null;
  comment: string | null;
  created_at: string;
}

export interface Scenario {
  id: string;
  title: string;
  hazard: Hazard;
  mode: "real" | "synthetic";
  bbox: [number, number, number, number];
  event_date: string;
  pre_window?: [string, string];
  post_window?: [string, string];
  region: string;
  summary: string;
  why: string;
  synthetic?: Record<string, unknown>;
}

export interface Source {
  id: string;
  name: string;
  provider: string;
  category: string;
  provides: string;
  coverage: string;
  spatial_resolution: string;
  temporal_resolution: string;
  update_frequency: string;
  timeliness: string;
  access: string;
  license: string;
  limitations: string;
  url: string;
  status: string;
  health: { status: string; latency_ms?: number; checked_at?: string; error?: string; detail?: string } | null;
}

export interface LiveEvent {
  id: string;
  source: string;
  hazard: string;
  name: string;
  alert_level: string | null;
  country?: string;
  from?: string;
  to?: string;
  time?: string;
  magnitude?: number;
  lon: number;
  lat: number;
  url?: string;
  severity_text?: string;
  is_current?: boolean;
}

export interface Dashboard {
  analyses: { total: number; by_status: Record<string, number>; by_hazard: Record<string, number>; by_mode: Record<string, number>; running: number };
  impact_real: { analyses: number; affected_area_km2: number; population_exposed: number; facilities_inside: number };
  priority_distribution: Record<Category, number>;
  review: { open_tasks: number; alerts_pending: number; alerts_by_status: Record<string, number> };
  agent_metrics: {
    tool_calls: number; tool_success_rate: number | null; escalation_rate: number | null; priority_override_rate: number | null;
    alert_rejection_rate: number | null; review_false_positive_rate: number | null; median_latency_s: number | null; p90_latency_s: number | null;
  };
  recent: AnalysisBrief[];
  activity: { actor: string; action: string; entity_type: string; entity_id: string | null; at: string }[];
}

export interface Me { user: string; role: "viewer" | "analyst" | "admin"; auth_enabled: boolean }

export interface Place {
  name: string;
  context: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number] | null;
  kind: string;
}

export interface CreateAnalysis {
  name: string;
  hazard: Hazard;
  mode: "real" | "synthetic";
  bbox?: [number, number, number, number];
  aoi?: GeoJSON.Geometry;
  event_date: string;
  pre_window?: [string, string];
  post_window?: [string, string];
  resolution_m?: number;
  weights?: Record<string, number>;
  detection?: Record<string, number>;
  synthetic?: Record<string, unknown>;
  scenario_id?: string;
}
