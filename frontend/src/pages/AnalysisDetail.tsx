import {
  AlertTriangle, BrainCircuit, CheckCircle2, CircleSlash, ClipboardList, Cpu, Database, Download, Eye, FileText, Gauge, GitBranch,
  Lightbulb, ListTree, Microscope, RefreshCcw, ShieldCheck, Square, Target, Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiUrl, errorMessage } from "@/api/client";
import {
  useAlertDecision, useAlerts, useAnalysis, useAnalysisAction, useDetections, useFacilities, useLayers, useOverride, usePriorities,
  useReviewDecision, useReviews, useTrace,
} from "@/api/hooks";
import type { AnalysisDetail as AD, CellProps, Category, Trace } from "@/api/types";
import { BarList, ColumnChart, ContributionBars, Meter, PriorityDistribution } from "@/components/charts";
import { AnalysisMap } from "@/components/map/AnalysisMap";
import {
  Card, ConfidenceChip, Empty, ErrorState, HazardChip, InfoTip, KV, Loading, Modal, PriorityChip, StatusChip, SyntheticChip, Tabs, useToast,
} from "@/components/ui";
import { fmtArea, fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtNum, fmtPct, sentence } from "@/lib/format";
import { CATEGORIES, FACILITY_LABEL, FACTOR_COLOR, FACTOR_LABEL, HAZARDS } from "@/lib/meta";

type TabId = "summary" | "priorities" | "impact" | "trace" | "review";
const ACTIVE = new Set(["queued", "running"]);
const PHASES: [string, string, typeof Eye][] = [
  ["observe", "Observe", Eye], ["perceive", "Perceive", Microscope], ["semantic_state", "Semantic state", Database], ["memory", "Memory / RAG", BrainCircuit],
  ["plan", "Reason / plan", GitBranch], ["act", "Act (tools)", Wrench], ["guardrail", "Guardrails / HITL", ShieldCheck], ["outcome", "Outcome", Target],
  ["feedback", "Feedback", Gauge],
];

export function AnalysisDetail() {
  const { id = "" } = useParams();
  const q = useAnalysis(id);
  const a = q.data;
  const active = !!a && ACTIVE.has(a.status);
  const trace = useTrace(id, active);
  const layers = useLayers(id, a?.status);
  const det = useDetections(id, a?.status);
  const cells = usePriorities(id, a?.status);
  const fac = useFacilities(id, a?.status);
  const action = useAnalysisAction();
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<TabId>("summary");
  const [selected, setSelected] = useState<string | null>(null);

  if (q.isLoading) return <Loading label="Loading analysis" />;
  if (q.isError || !a) return <ErrorState error={q.error ?? new Error("Analysis not found")} onRetry={() => q.refetch()} />;
  const done = ["completed", "completed_with_warnings", "needs_review"].includes(a.status);
  const synthetic = a.mode === "synthetic";

  const doAction = async (act: "cancel" | "rerun") => {
    try {
      const r = await action.mutateAsync({ id: a.id, action: act });
      if (act === "rerun") nav(`/analyses/${r.id}`);
      toast("ok", act === "cancel" ? "Cancellation requested." : "Re-run started.");
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };
  const selectCell = (cid: string | null) => {
    setSelected(cid);
    if (cid) setTab("priorities");
  };

  return (
    <div className="stack fade-in" style={{ gap: 14 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div className="grow">
          <div className="row-wrap" style={{ marginBottom: 6 }}>
            <HazardChip hazard={a.hazard} /><StatusChip status={a.status} />
            {synthetic && <SyntheticChip />}
            {a.top_priority && <PriorityChip category={a.top_priority} />}
            <ConfidenceChip level={a.confidence} />
          </div>
          <h1 style={{ fontSize: "var(--fs-xl)" }}>{a.name}</h1>
          <p className="small">Event {fmtDate(a.event_date)} · pre {fmtDate(a.pre_window[0])}-{fmtDate(a.pre_window[1])} · post {fmtDate(a.post_window[0])}-{fmtDate(a.post_window[1])} · {fmtArea(a.area_km2)} area</p>
        </div>
        <div className="row-wrap">
          {active && <button className="btn btn-danger" onClick={() => doAction("cancel")}><Square size={14} aria-hidden /> Cancel</button>}
          {!active && <button className="btn" onClick={() => doAction("rerun")}><RefreshCcw size={14} aria-hidden /> Re-run</button>}
          {done && (
            <>
              <a className="btn" href={apiUrl(`/api/analyses/${a.id}/reports/pdf`)}><FileText size={14} aria-hidden /> PDF report</a>
              <a className="btn" href={apiUrl(`/api/analyses/${a.id}/reports/csv`)}><Download size={14} aria-hidden /> CSV</a>
              <a className="btn" href={apiUrl(`/api/analyses/${a.id}/reports/geojson`)}><Download size={14} aria-hidden /> GeoJSON</a>
              <a className="btn" href={apiUrl(`/api/analyses/${a.id}/exports/products.tif`)} title="Probability, extent and uncertainty rasters"><Download size={14} aria-hidden /> GeoTIFF</a>
            </>
          )}
        </div>
      </div>

      {synthetic && (
        <div className="banner synthetic"><span><strong>Simulated data.</strong> This analysis uses a synthetic test scene placed at Null Island (0°N 0°E, open ocean in reality). It does not describe any real place or event; its alerts can never be published.</span></div>
      )}

      {active && <RunProgress a={a} trace={trace.data} />}
      {!active && !done && <FailurePanel a={a} />}

      {done && (
        <div className="workspace">
          <div className="card map-card">
            {layers.isError && <div style={{ padding: 16 }}><ErrorState error={layers.error} onRetry={() => layers.refetch()} /></div>}
            <AnalysisMap aoi={a.aoi} bbox={a.bbox} hazard={a.hazard} layers={layers.data ?? []} detections={det.data} cells={cells.data}
              facilities={fac.data} selectedCell={selected} onSelectCell={selectCell} />
          </div>
          <div className="card panel-card">
            <Tabs<TabId> label="Analysis sections" value={tab} onChange={setTab} tabs={[
              { id: "summary", label: "Summary" }, { id: "priorities", label: "Priorities", badge: cells.data?.features.length },
              { id: "impact", label: "Impact" }, { id: "trace", label: "Evidence" },
              { id: "review", label: "Review", badge: (a.counts.alerts_pending ?? 0) + (a.counts.reviews_open ?? 0) || undefined },
            ]} />
            <div className="panel-scroll card-body">
              {tab === "summary" && <SummaryTab a={a} onCategory={() => setTab("priorities")} />}
              {tab === "priorities" && <PrioritiesTab a={a} cells={cells.data?.features.map((f) => f.properties) ?? []} loading={cells.isLoading}
                selected={selected} onSelect={setSelected} />}
              {tab === "impact" && <ImpactTab a={a} facilities={fac.data} />}
              {tab === "trace" && <TraceTab trace={trace.data} loading={trace.isLoading} />}
              {tab === "review" && <ReviewTab a={a} />}
            </div>
          </div>
        </div>
      )}
      {!done && !active && trace.data && <Card title="Agent trace"><TraceTab trace={trace.data} loading={false} /></Card>}
    </div>
  );
}

// ============================================================================ progress
function RunProgress({ a, trace }: { a: AD; trace?: Trace }) {
  const seen = new Set(trace?.steps.map((s) => s.phase));
  const last = trace?.steps[trace.steps.length - 1];
  return (
    <Card title="The agent is working" sub={a.message ?? "Preparing"} actions={<span className="chip info">{fmtPct(a.progress)}</span>}>
      <div className="progress" aria-label="Progress"><div style={{ width: `${Math.max(4, a.progress * 100)}%` }} /></div>
      <div className="phase-track" style={{ marginTop: 16 }}>
        {PHASES.map(([pid, label, Icon]) => (
          <div key={pid} className={`phase ${last?.phase === pid ? "active" : seen.has(pid) ? "done" : ""}`}>
            <Icon size={16} aria-hidden />{label}
          </div>
        ))}
      </div>
      <div className="stack" style={{ marginTop: 16, gap: 6 }}>
        {trace?.steps.slice(-6).reverse().map((s) => (
          <div key={s.seq} className="row small fade-in">
            <span className="chip outline" style={{ minWidth: 110, justifyContent: "center" }}>{sentence(s.phase)}</span>
            <span className="grow"><strong>{s.title}</strong>{s.detail ? <span className="muted"> - {s.detail.slice(0, 140)}</span> : null}</span>
          </div>
        ))}
        {!trace?.steps.length && <span className="muted small">Waiting for the first agent step...</span>}
      </div>
    </Card>
  );
}

function FailurePanel({ a }: { a: AD }) {
  const tips: Record<string, string[]> = {
    insufficient_data: ["Widen the post-event window (radar revisits every 6-12 days).", "Check the catalogue preview on the New analysis page.", "Optical-only hazards (wildfire) need cloud-free images before and after."],
    rejected: ["Correct the inputs shown above and run again."],
    failed: ["Re-run the analysis; transient service outages are retried automatically.", "If it fails again, check Data sources for unavailable services."],
    cancelled: ["Use Re-run to start the analysis again."],
    interrupted: ["The server restarted during the run - use Re-run."],
  };
  return (
    <div className={`banner ${a.status === "insufficient_data" || a.status === "interrupted" ? "warn" : "danger"}`} role="alert">
      <CircleSlash size={18} aria-hidden />
      <div>
        <strong>{a.status === "insufficient_data" ? "Not enough usable satellite data" : a.status === "rejected" ? "The request was rejected by input guardrails" : `Analysis ${a.status}`}</strong>
        <div style={{ marginTop: 4 }}>{a.error ?? a.message}</div>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{(tips[a.status] ?? []).map((t) => <li key={t}>{t}</li>)}</ul>
      </div>
    </div>
  );
}

// ============================================================================ summary
function SummaryTab({ a, onCategory }: { a: AD; onCategory: () => void }) {
  const r = a.results;
  const s = a.summary;
  if (!r || !s) return <Empty title="No results" />;
  const q = r.hazard?.quality ?? {};
  const rain = r.context?.rainfall;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div>
        <div className="row between"><h4>Executive summary</h4><span className="xs muted">{r.narrative?.summary_source === "template" ? "deterministic template" : r.narrative?.summary_source}</span></div>
        <p className="small" style={{ marginTop: 6, lineHeight: 1.6 }}>{r.narrative?.summary}</p>
      </div>
      <div className="grid g-2" style={{ gap: 10 }}>
        <Mini label="Detected extent" value={fmtArea(s.affected_area_km2)} sub={`${fmtPct(q.affected_fraction_of_aoi as number)} of the area`} />
        <Mini label="People potentially exposed" value={s.population_exposed == null ? "n/a" : fmtInt(s.population_exposed)} sub={r.impact?.population.available ? "estimate" : "population data unavailable"} />
        <Mini label="Facilities inside / near" value={s.facilities_inside == null ? "n/a" : `${s.facilities_inside} / ${s.facilities_near ?? 0}`} sub="within extent / 500 m" />
        <Mini label="Roads crossing extent" value={s.road_km_affected == null ? "n/a" : `${fmtNum(s.road_km_affected, 1)} km`} sub={s.mode === "synthetic" ? "simulated roads" : "mapped roads (OSM)"} />
      </div>
      {s.distribution && (
        <div>
          <div className="row between" style={{ marginBottom: 8 }}><h4>Response priorities</h4><button className="btn btn-ghost btn-sm" onClick={onCategory}>Open list</button></div>
          <PriorityDistribution counts={s.distribution} onSelect={onCategory} />
        </div>
      )}
      <div>
        <h4 style={{ marginBottom: 8 }}>Evidence quality</h4>
        <div className="stack" style={{ gap: 10 }}>
          <QualityRow label="Independent-method agreement" value={q.cross_method_agreement as number | null} good tip="Share of detected pixels also flagged by a classical method (SAR log-ratio or optical water index)." />
          <QualityRow label="Mean model confidence" value={q.mean_probability_detected as number | null} good tip="Mean calibrated probability inside the detected extent." />
          <QualityRow label="Mean uncertainty" value={q.mean_uncertainty_detected as number | null} max={0.3} tip="Monte-Carlo dropout spread inside the extent; above 0.15 triggers analyst review." />
          {q.s2_post_cloud_fraction != null && <QualityRow label="Optical cloud cover (post-event)" value={q.s2_post_cloud_fraction as number} tip="Share of the area hidden by cloud or shadow in the post-event Sentinel-2 image." />}
          {q.mean_sar_reliance_detected != null && <QualityRow label="Decision driven by radar" value={q.mean_sar_reliance_detected as number} neutral tip="Average weight the fusion model gave to Sentinel-1 inside the extent (the rest came from Sentinel-2)." />}
        </div>
      </div>
      <div>
        <h4 style={{ marginBottom: 8 }}>Observations used</h4>
        <div className="stack" style={{ gap: 6 }}>
          {a.observations.sort((x, y) => (x.role + x.sensor).localeCompare(y.role + y.sensor)).map((o) => (
            <div key={o.sensor + o.role} className="row small between">
              <span><strong>{o.sensor === "S1" ? "Sentinel-1 radar" : "Sentinel-2 optical"}</strong> <span className="muted">{o.role}-event</span></span>
              <span className="muted">{fmtDateTime(o.acquired_at)}{o.cloud_fraction != null ? ` · ${fmtPct(o.cloud_fraction)} cloud` : ""}</span>
            </div>
          ))}
        </div>
      </div>
      {rain?.series && rain.series.length > 0 && (
        <div>
          <div className="row between"><h4>Rainfall context</h4><span className="xs muted">{fmtNum(rain.total_mm, 0)} mm total</span></div>
          <p className="xs muted" style={{ margin: "2px 0 8px" }}>Daily precipitation at the area centre - {rain.note}</p>
          <ColumnChart data={rain.series.map((d) => ({ x: d.date, y: d.mm }))} unit="mm" ariaLabel="Daily precipitation" />
        </div>
      )}
      <div>
        <h4 style={{ marginBottom: 8 }}>Method</h4>
        <p className="small" style={{ fontWeight: 600 }}>{r.hazard?.method}</p>
        <ul className="small" style={{ paddingLeft: 18, margin: "6px 0 0", color: "var(--ink-2)" }}>{r.hazard?.methodology.map((m) => <li key={m}>{m}</li>)}</ul>
        <p className="xs muted" style={{ marginTop: 6 }}>Model: {String(r.hazard?.model_info?.version ?? "-")}</p>
      </div>
      <div>
        <h4 style={{ marginBottom: 8 }}>Limitations</h4>
        <ul className="small" style={{ paddingLeft: 18, margin: 0, color: "var(--ink-2)" }}>{r.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
      </div>
      {r.agent && r.agent.warnings.length > 0 && (
        <div className="banner warn"><AlertTriangle size={16} aria-hidden /><div><strong>Warnings</strong><ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{r.agent.warnings.map((w) => <li key={w}>{w}</li>)}</ul></div></div>
      )}
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ padding: 12, borderRadius: "var(--r-md)", border: "1px solid var(--line)", background: "var(--surface-2)" }}>
      <div className="xs muted">{label}</div>
      <div style={{ fontSize: "1.2rem", fontWeight: 650, marginTop: 2 }}>{value}</div>
      {sub && <div className="xs muted">{sub}</div>}
    </div>
  );
}

function QualityRow({ label, value, max = 1, good, neutral, tip }: { label: string; value: number | null | undefined; max?: number; good?: boolean; neutral?: boolean; tip: string }) {
  const v = value ?? null;
  const tone = v == null || neutral ? "brand" : good ? (v >= 0.75 ? "ok" : v >= 0.55 ? "brand" : "warn") : (v / max > 0.5 ? "warn" : "brand");
  return (
    <div>
      <div className="row between xs" style={{ marginBottom: 4 }}><span>{label} <InfoTip text={tip} /></span><strong className="tabular">{v == null ? "n/a" : max === 1 ? fmtPct(v) : fmtNum(v, 2)}</strong></div>
      <Meter value={v ?? 0} max={max} tone={tone as "ok"} label={label} />
    </div>
  );
}

// ============================================================================ priorities
function PrioritiesTab({ a, cells, loading, selected, onSelect }: { a: AD; cells: CellProps[]; loading: boolean; selected: string | null; onSelect: (id: string | null) => void }) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const [override, setOverride] = useState<CellProps | null>(null);
  const shown = useMemo(() => cells.filter((c) => filter === "all" || c.category === filter), [cells, filter]);
  const pri = a.results?.priorities;
  if (loading) return <Loading />;
  if (!cells.length) return <Empty title="No response cells">No part of the area met the minimum affected-area threshold.</Empty>;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="xs muted">
        {pri?.cell_km} km cells ranked by priority = 100 x Hazard^{pri?.weights.hazard_exponent} x Exposure^{(1 - (pri?.weights.hazard_exponent ?? 0.5)).toFixed(2)}.
        Confidence is shown separately and never lowers priority. Ranking stability across weight perturbations: Spearman rho {fmtNum(pri?.sensitivity.mean_spearman_rho, 2)}.
      </p>
      <div className="row-wrap" role="group" aria-label="Filter by priority">
        {(["all", ...CATEGORIES] as const).map((c) => (
          <button key={c} className={`btn btn-sm ${filter === c ? "btn-primary" : ""}`} onClick={() => setFilter(c)}>
            {c === "all" ? `All (${cells.length})` : `${c} (${cells.filter((x) => x.category === c).length})`}
          </button>
        ))}
      </div>
      {shown.slice(0, 60).map((c) => (
        <article key={c.cell_id} className={`cell-card ${selected === c.cell_id ? "selected" : ""}`} onClick={() => onSelect(c.cell_id)} tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && onSelect(c.cell_id)} aria-label={`Cell ${c.cell_id}, ${c.category} priority, rank ${c.rank}`}>
          <div className="row between">
            <span className="row"><strong className="tabular">#{c.rank}</strong><PriorityChip category={c.category} override={!!c.override_reason} /><span className="xs muted">{c.cell_id}</span></span>
            <span className="row"><strong className="tabular">{fmtNum(c.score, 0)}</strong><span className="xs muted">/100</span><ConfidenceChip level={c.confidence} /></span>
          </div>
          {c.needs_verification && <div className="banner warn" style={{ marginTop: 8, padding: "6px 10px" }}><AlertTriangle size={14} aria-hidden /> Verify before acting - low confidence.</div>}
          <p className="small" style={{ marginTop: 8, color: "var(--ink-2)" }}>{c.explanation}</p>
          {selected === c.cell_id && (
            <div className="stack fade-in" style={{ marginTop: 10, gap: 12 }}>
              <ContributionBars labels={FACTOR_LABEL} colors={FACTOR_COLOR} groups={[
                { name: "Hazard sub-score", subscore: c.hazard_subscore, parts: Object.entries(c.contributions.hazard).map(([k, v]) => ({ key: k, value: v, raw: c.factors[k] })) },
                { name: "Exposure sub-score", subscore: c.exposure_subscore, parts: Object.entries(c.contributions.exposure).map(([k, v]) => ({ key: k, value: v, raw: c.factors[k] })) },
              ]} />
              <KV items={[
                ["Affected", `${fmtArea(c.affected_km2)} (${fmtPct(c.affected_fraction)} of cell)`],
                ["People potentially exposed", c.population_exposed == null ? (c.built_up_affected_km2 != null ? `built-up ${fmtArea(c.built_up_affected_km2)} (proxy)` : "n/a") : fmtInt(c.population_exposed)],
                ["Roads affected", c.road_km_affected == null ? "n/a" : `${fmtNum(c.road_km_affected, 2)} km`],
                ["Model uncertainty", fmtNum(c.mean_uncertainty, 2)],
                ["Independent agreement", c.cross_method_agreement == null ? "n/a" : fmtPct(c.cross_method_agreement)],
                ["Data completeness", fmtPct(c.data_completeness)],
                ["Rank range (weights perturbed)", c.sensitivity ? `${c.sensitivity.rank_p10}-${c.sensitivity.rank_p90}` : "n/a"],
              ]} />
              {c.missing_factors.length > 0 && <div className="xs muted">Missing information: {c.missing_factors.map((m) => FACTOR_LABEL[m] ?? m).join(", ")}</div>}
              <div>
                <div className="row xs" style={{ fontWeight: 650, marginBottom: 4 }}><Lightbulb size={13} aria-hidden /> Suggested considerations (decision support)</div>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{c.recommended_actions.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
              {c.override_reason && <div className="banner info" style={{ padding: "6px 10px" }}>Analyst override by {c.overridden_by}: {c.override_reason} (model: {c.model_category})</div>}
              <div className="row"><button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); setOverride(c); }}><ClipboardList size={14} aria-hidden /> Override priority</button></div>
            </div>
          )}
        </article>
      ))}
      {shown.length > 60 && <p className="xs muted">Showing the top 60 of {shown.length}. Download the CSV for the full list.</p>}
      {override && <OverrideModal analysisId={a.id} cell={override} onClose={() => setOverride(null)} />}
    </div>
  );
}

function OverrideModal({ analysisId, cell, onClose }: { analysisId: string; cell: CellProps; onClose: () => void }) {
  const [cat, setCat] = useState<Category | "">(cell.category);
  const [reason, setReason] = useState("");
  const m = useOverride(analysisId);
  const toast = useToast();
  const save = async (clear = false) => {
    try {
      await m.mutateAsync({ cell: cell.cell_id, category: clear ? null : (cat || null), reason: clear ? "override cleared" : reason });
      toast("ok", clear ? "Override cleared" : "Priority override saved and logged");
      onClose();
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };
  return (
    <Modal title={`Override priority - cell ${cell.cell_id}`} open onClose={onClose} footer={<>
      {cell.override_reason && <button className="btn btn-ghost" onClick={() => save(true)}>Clear override</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={reason.trim().length < 5 || m.isPending} onClick={() => save()}>Save override</button></>}>
      <div className="stack">
        <p className="small muted">Overrides are recorded with your name and reason, shown in reports and counted in the human-override rate. The model's own category ({cell.model_category}) is kept.</p>
        <div className="field">
          <label htmlFor="cat">New category</label>
          <select id="cat" className="select" value={cat} onChange={(e) => setCat(e.target.value as Category)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </div>
        <div className="field">
          <label htmlFor="reason">Reason (required)</label>
          <textarea id="reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Field team reports water receding; hospital accessible via north road." />
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================ impact
function ImpactTab({ a, facilities }: { a: AD; facilities?: GeoJSON.FeatureCollection<GeoJSON.Point> }) {
  const imp = a.results?.impact;
  if (!imp) return <Empty title="No impact assessment" />;
  const fac = (facilities?.features ?? []).map((f) => f.properties as unknown as { name: string | null; category: string; status: string; distance_m: number | null })
    .filter((f) => f.status !== "outside" && f.category !== "settlement");
  const lc = Object.entries(imp.landcover_affected_ha ?? {}).map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value);
  const roads = Object.entries(imp.roads.affected_km_by_class ?? {}).map(([label, value]) => ({ label, value }));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="banner info"><span>Everything here is <strong>potential exposure</strong>: people and assets inside or near the detected extent. It does not establish damage, displacement or casualties.</span></div>
      <div>
        <h4>Population</h4>
        {imp.population.available ? (
          <p className="small" style={{ marginTop: 6 }}>
            <strong style={{ fontSize: "1.3rem" }}>{fmtInt(imp.population.potentially_exposed)}</strong> residents potentially exposed of {fmtInt(imp.population.aoi_total)} in the area.
            <span className="muted"> Source: {imp.population.source}. {imp.population.note}</span>
          </p>
        ) : <p className="small muted" style={{ marginTop: 6 }}>Population data unavailable ({imp.population.note}). Built-up area is used as an exposure proxy.</p>}
      </div>
      <div>
        <h4 style={{ marginBottom: 8 }}>Critical facilities ({fac.length})</h4>
        {fac.length === 0 ? <p className="small muted">No mapped facility inside or within 500 m of the extent{imp.roads.available ? "" : " (infrastructure data unavailable)"}.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Facility</th><th>Type</th><th>Status</th><th className="num">Distance</th></tr></thead>
              <tbody>{fac.sort((x, y) => (x.distance_m ?? 0) - (y.distance_m ?? 0)).map((f, i) => (
                <tr key={i}><td>{f.name ?? "(unnamed)"}</td><td>{FACILITY_LABEL[f.category] ?? f.category}</td>
                  <td><span className={`chip ${f.status === "inside" ? "danger" : "warn"}`}>{f.status === "inside" ? "inside extent" : "within 500 m"}</span></td>
                  <td className="num">{f.status === "inside" ? "-" : `${fmtInt(f.distance_m)} m`}</td></tr>))}</tbody>
            </table>
          </div>
        )}
      </div>
      {roads.length > 0 && <div><h4 style={{ marginBottom: 8 }}>Roads crossing the extent (km)</h4><BarList items={roads} unit=" km" /></div>}
      {lc.length > 0 && <div><h4 style={{ marginBottom: 8 }}>Land cover affected (ha)</h4><BarList items={lc} unit=" ha" /><p className="xs muted" style={{ marginTop: 6 }}>ESA WorldCover 2021.</p></div>}
      {imp.settlements_affected.length > 0 && (
        <div><h4 style={{ marginBottom: 8 }}>Settlements in or near the extent</h4>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{imp.settlements_affected.map((s, i) => <li key={i}>{s.name} <span className="muted">({s.status === "inside" ? "inside" : `${fmtInt(s.distance_m)} m away`})</span></li>)}</ul>
        </div>
      )}
      <div><h4 style={{ marginBottom: 8 }}>Limitations</h4><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{imp.limitations.map((l) => <li key={l}>{l}</li>)}{imp.limitations.length === 0 && <li>None recorded.</li>}</ul></div>
    </div>
  );
}

// ============================================================================ trace
export function TraceTab({ trace, loading }: { trace?: Trace; loading: boolean }) {
  const [view, setView] = useState<"timeline" | "decisions" | "tools" | "guardrails" | "evidence">("timeline");
  if (loading || !trace) return <Loading label="Loading trace" />;
  const m = trace.metrics;
  return (
    <div className="stack" style={{ gap: 12 }}>
      {m && (
        <div className="grid g-3" style={{ gap: 8 }}>
          <Mini label="Tool calls" value={`${m.tool_stats.calls}`} sub={`${fmtPct(m.tool_stats.success_rate, 0)} succeeded`} />
          <Mini label="Guardrail checks" value={`${Object.values(m.guardrail_outcomes).reduce((x, y) => x + y, 0)}`} sub={Object.entries(m.guardrail_outcomes).map(([k, v]) => `${v} ${k}`).join(" · ")} />
          <Mini label="Run time" value={fmtDuration(m.duration_s)} sub="end to end" />
        </div>
      )}
      <div className="row-wrap" role="group" aria-label="Trace view">
        {(["timeline", "decisions", "tools", "guardrails", "evidence"] as const).map((v) => (
          <button key={v} className={`btn btn-sm ${view === v ? "btn-primary" : ""}`} onClick={() => setView(v)}>{sentence(v)}</button>
        ))}
      </div>
      {view === "timeline" && (
        <div className="timeline">
          {trace.steps.map((s) => (
            <div key={s.seq} className="tl-item">
              <span className={`tl-dot ${s.status === "ok" ? "ok" : "warn"}`}><ListTree size={11} aria-hidden /></span>
              <div className="row xs muted" style={{ gap: 6 }}><span className="chip outline" style={{ height: 20 }}>{sentence(s.phase)}</span>{s.agent.replace(/_/g, " ")}{s.duration_ms ? ` · ${fmtNum(s.duration_ms / 1000, 1)} s` : ""}</div>
              <div className="small" style={{ fontWeight: 600, marginTop: 2 }}>{s.title}</div>
              {s.detail && <div className="xs" style={{ color: "var(--ink-2)", marginTop: 2 }}>{s.detail.slice(0, 600)}</div>}
              {s.rationale && <div className="xs muted" style={{ marginTop: 2 }}>Why: {s.rationale}</div>}
            </div>
          ))}
        </div>
      )}
      {view === "decisions" && (
        <div className="stack" style={{ gap: 8 }}>
          {trace.decisions.length === 0 && <p className="small muted">No branching decisions were needed for this run.</p>}
          {trace.decisions.map((d, i) => (
            <div key={i} className="cell-card" style={{ cursor: "default" }}>
              <div className="row between xs muted"><span>{d.agent.replace(/_/g, " ")}</span>{d.rule && <span className="chip outline">rule {d.rule}</span>}</div>
              <div className="small" style={{ marginTop: 4 }}><strong>{d.question}:</strong> {d.chosen}</div>
              <div className="xs" style={{ color: "var(--ink-2)", marginTop: 4 }}>{d.rationale}</div>
              {d.alternatives.length > 0 && <div className="xs muted" style={{ marginTop: 4 }}>Alternatives considered: {d.alternatives.join("; ")}</div>}
            </div>
          ))}
        </div>
      )}
      {view === "tools" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Tool</th><th>Agent</th><th>Effect</th><th>Status</th><th className="num">ms</th></tr></thead>
            <tbody>{trace.tool_calls.map((t) => (
              <tr key={t.seq} title={t.error ?? JSON.stringify(t.result ?? {}).slice(0, 400)}>
                <td className="tabular">{t.seq}</td><td><code>{t.tool}</code></td><td className="xs">{t.agent.replace(/_/g, " ")}</td>
                <td><span className={`chip ${t.side_effect === "read_only" ? "" : t.side_effect === "external" ? "danger" : "brand"}`}>{t.side_effect.replace("_", " ")}</span></td>
                <td><span className={`chip ${t.status === "ok" ? "ok" : t.status === "blocked" ? "danger" : "warn"}`}>{t.status}</span>{t.error && <div className="xs muted" style={{ maxWidth: 240 }}>{t.error.slice(0, 140)}</div>}</td>
                <td className="num">{fmtInt(t.latency_ms)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {view === "guardrails" && (
        <div className="stack" style={{ gap: 6 }}>
          {trace.guardrails.map((g, i) => (
            <div key={i} className="row small" style={{ alignItems: "flex-start" }}>
              <span className={`chip ${g.outcome === "pass" ? "ok" : g.outcome === "warn" ? "warn" : "danger"}`} style={{ minWidth: 76, justifyContent: "center" }}>
                {g.outcome === "pass" ? <CheckCircle2 size={12} aria-hidden /> : <AlertTriangle size={12} aria-hidden />}{g.outcome}
              </span>
              <span className="grow"><strong>{g.code} {g.name}</strong> <span className="muted">({g.stage})</span><div className="xs" style={{ color: "var(--ink-2)" }}>{g.message}</div></span>
            </div>
          ))}
        </div>
      )}
      {view === "evidence" && (
        <div className="stack" style={{ gap: 6 }}>
          {Object.values(trace.evidence).map((e) => (
            <div key={e.id} className="small">
              <code>{e.id}</code> <span className="chip outline" style={{ height: 20 }}>{e.kind}</span>
              <div className="xs" style={{ color: "var(--ink-2)" }}>{e.description}</div>
              {e.stac_items?.map((u) => <div key={u} className="xs"><a href={u} target="_blank" rel="noopener noreferrer">{u.split("/items/")[1]}</a></div>)}
            </div>
          ))}
          <h4 style={{ marginTop: 10 }}>Semantic state (facts)</h4>
          <div className="table-wrap"><table className="table"><thead><tr><th>Fact</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>{Object.values(trace.facts).map((f) => <tr key={f.key}><td><code>{f.key}</code><div className="xs muted">{f.description}</div></td>
              <td className="tabular">{String(f.value)}{f.unit ? ` ${f.unit}` : ""}</td><td className="xs"><code>{f.source}</code></td></tr>)}</tbody></table></div>
        </div>
      )}
    </div>
  );
}

// ============================================================================ alerts & review
function ReviewTab({ a }: { a: AD }) {
  const alerts = useAlerts(undefined, a.id);
  const reviews = useReviews("open");
  const open = (reviews.data?.items ?? []).filter((t) => t.analysis_id === a.id);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div>
        <h4 style={{ marginBottom: 8 }}>Open review items ({open.length})</h4>
        {open.length === 0 && <p className="small muted">Nothing awaiting review for this analysis.</p>}
        <div className="stack">{open.map((t) => <ReviewItem key={t.id} task={t} />)}</div>
      </div>
      <div>
        <h4 style={{ marginBottom: 8 }}>Alerts ({alerts.data?.items.length ?? 0})</h4>
        {alerts.isLoading && <Loading />}
        <div className="stack">{alerts.data?.items.map((al) => <AlertItem key={al.id} alert={al} compact />)}</div>
      </div>
      <p className="xs muted">See <Link to="/review">Review queue</Link> and <Link to="/alerts">Alerts</Link> for all analyses.</p>
    </div>
  );
}

export function ReviewItem({ task }: { task: import("@/api/types").ReviewTask }) {
  const decide = useReviewDecision();
  const toast = useToast();
  const [comment, setComment] = useState("");
  const nav = useNavigate();
  const act = async (decision: string) => {
    try {
      const r = await decide.mutateAsync({ id: task.id, decision, comment: comment || undefined });
      toast("ok", r.rerun_analysis_id ? "Re-run started" : `Recorded: ${decision.replace("_", " ")}${r.effect ? ` (${r.effect})` : ""}`);
      if (r.rerun_analysis_id) nav(`/analyses/${r.rerun_analysis_id}`);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };
  return (
    <div className="cell-card" style={{ cursor: "default" }}>
      <div className="row between">
        <span className="row"><span className={`chip ${task.severity === "High" || task.severity === "Critical" ? "danger" : "warn"}`}>{task.severity}</span><strong className="small">{task.title}</strong></span>
        <span className="xs muted">{task.kind.replace(/_/g, " ")}</span>
      </div>
      <p className="small" style={{ marginTop: 6, color: "var(--ink-2)" }}>{task.reason}</p>
      {task.analysis_name && <div className="xs muted" style={{ marginTop: 4 }}>Analysis: <Link to={`/analyses/${task.analysis_id}`}>{task.analysis_name}</Link></div>}
      <input className="input" style={{ marginTop: 8, height: 34 }} placeholder="Comment (optional, recorded in the audit log)" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Review comment" />
      <div className="row-wrap" style={{ marginTop: 8 }}>
        <button className="btn btn-sm btn-ok" onClick={() => act("confirm")} disabled={decide.isPending}><CheckCircle2 size={14} aria-hidden /> Confirm finding</button>
        <button className="btn btn-sm btn-danger" onClick={() => act("false_positive")} disabled={decide.isPending}>False positive</button>
        <button className="btn btn-sm" onClick={() => act("acknowledge")} disabled={decide.isPending}>Acknowledge</button>
        <button className="btn btn-sm" onClick={() => act("request_rerun")} disabled={decide.isPending}><RefreshCcw size={13} aria-hidden /> Re-run</button>
      </div>
    </div>
  );
}

export function AlertItem({ alert, compact }: { alert: import("@/api/types").Alert; compact?: boolean }) {
  const decide = useAlertDecision();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [showEv, setShowEv] = useState(false);
  const act = async (decision: "approve" | "reject") => {
    try {
      const r = await decide.mutateAsync({ id: alert.id, decision, note: note || undefined });
      const delivered = (r.delivery as { delivered?: boolean; reason?: string } | null);
      toast("ok", decision === "reject" ? "Alert rejected" : delivered?.delivered ? "Alert approved and published" : `Alert approved${delivered?.reason ? ` - ${delivered.reason}` : " (internal only)"}`);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };
  const statusTone = { pending_review: "warn", approved: "ok", published: "ok", rejected: "" }[alert.status];
  return (
    <div className="cell-card" style={{ cursor: "default" }}>
      <div className="row between">
        <span className="row"><PriorityChip category={alert.severity} /><span className={`chip ${statusTone}`}>{alert.status.replace("_", " ")}</span>
          {alert.grounding?.verified ? <span className="chip ok" title="Every number in the text matched recorded evidence"><ShieldCheck size={12} aria-hidden /> grounded</span>
            : <span className="chip danger" title="Generated text failed verification and was withheld">text withheld</span>}
        </span>
        <span className="xs muted">{fmtDateTime(alert.created_at)}</span>
      </div>
      <div className="small" style={{ fontWeight: 650, marginTop: 6 }}>{alert.title}</div>
      <p className="small" style={{ marginTop: 4, color: "var(--ink-2)" }}>{compact && alert.body.length > 420 ? alert.body.slice(0, 420) + "…" : alert.body}</p>
      {!compact && alert.analysis_name && <div className="xs muted">Analysis: <Link to={`/analyses/${alert.analysis_id}`}>{alert.analysis_name}</Link></div>}
      <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => setShowEv((s) => !s)}><Cpu size={13} aria-hidden /> {showEv ? "Hide" : "Show"} evidence ({alert.evidence.length})</button>
      {showEv && <div className="xs" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{alert.evidence.map((e) => <code key={e} className="chip outline" style={{ height: 22 }}>{e}</code>)}</div>}
      {alert.status === "pending_review" ? (
        <>
          <input className="input" style={{ marginTop: 8, height: 34 }} placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Decision note" />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn-sm btn-ok" onClick={() => act("approve")} disabled={decide.isPending}><CheckCircle2 size={14} aria-hidden /> Approve</button>
            <button className="btn btn-sm btn-danger" onClick={() => act("reject")} disabled={decide.isPending}>Reject</button>
            {alert.synthetic && <span className="xs muted">Simulated - approval stays internal (cannot be published).</span>}
          </div>
        </>
      ) : (
        <div className="xs muted" style={{ marginTop: 6 }}>
          {alert.decided_by ? `Decided by ${alert.decided_by} ${fmtDateTime(alert.decided_at)}` : ""}{alert.decision_note ? ` - "${alert.decision_note}"` : ""}
          {alert.delivery ? ` · delivery: ${String((alert.delivery as { channel?: string }).channel ?? "-")}${(alert.delivery as { reason?: string }).reason ? ` (${(alert.delivery as { reason?: string }).reason})` : ""}` : ""}
        </div>
      )}
    </div>
  );
}

export { HAZARDS };
