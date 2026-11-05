import {
  AlertTriangle, Building2, CheckCircle2, ChevronDown, CircleHelp, Gauge, Info, ListChecks, MapPin, Route, ShieldCheck, Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useOverride } from "@/api/hooks";
import type { AnalysisDetail, CellProps, Category, Trace } from "@/api/types";
import { BarList, ColumnChart, ContributionBars, Meter } from "@/components/charts";
import { Callout, ConfidenceMeter, Disclosure, Empty, InfoTip, Loading, Modal, PriorityChip, useToast } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtNum, fmtPct, sentence } from "@/lib/format";
import { CATEGORIES, CHECKS, FACILITY_LABEL, FACTOR_COLOR, FACTOR_LABEL, HAZARDS, PRIORITY } from "@/lib/meta";
import { friendlyError, squareReasons, type Reason } from "@/lib/plain";

const REASON_ICON: Record<Reason["icon"], ReactNode> = {
  area: <MapPin size={16} aria-hidden />, people: <Users size={16} aria-hidden />, place: <Building2 size={16} aria-hidden />,
  road: <Route size={16} aria-hidden />, rule: <ShieldCheck size={16} aria-hidden />, sure: <Gauge size={16} aria-hidden />,
  missing: <CircleHelp size={16} aria-hidden />,
};

// ============================================================================ where to help first
export function PrioritiesPanel({ a, cells, loading, selected, onSelect }: {
  a: AnalysisDetail; cells: CellProps[]; loading: boolean; selected: string | null; onSelect: (id: string | null) => void;
}) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const [limit, setLimit] = useState(20);
  const [override, setOverride] = useState<CellProps | null>(null);
  const pri = a.results?.priorities;
  const shown = useMemo(() => cells.filter((c) => filter === "all" || c.category === filter), [cells, filter]);

  useEffect(() => {
    if (!selected) return;
    const c = cells.find((x) => x.cell_id === selected);
    if (c && filter !== "all" && c.category !== filter) setFilter("all");
    const idx = shown.findIndex((x) => x.cell_id === selected);
    if (idx >= limit) setLimit(idx + 10);
    requestAnimationFrame(() => {
      if (window.innerWidth > 1100) document.getElementById(`sq-${selected}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Loading label="Loading the priority squares" />;
  if (!cells.length) {
    return <Empty title="No squares to rank">Not enough of the area was hit to rank any square. (A square needs at least 1 hectare - about one and a half football pitches - that looks {HAZARDS[a.hazard].found}.)</Empty>;
  }
  return (
    <div className="stack">
      <p className="small ink-2">
        The area was split into {pri?.cell_km ? `${pri.cell_km} km` : ""} squares. Each one got a score from 0 to 100: higher means more damage
        where more people and important places are.{" "}
        <InfoTip text={`Score = 100 × damage^${pri?.weights.hazard_exponent ?? 0.5} × (people and places)^${(1 - (pri?.weights.hazard_exponent ?? 0.5)).toFixed(2)}. How sure we are is shown separately and never lowers a square's priority - unsure but serious places should be checked, not hidden.`} />
      </p>
      <div className="row-wrap" role="group" aria-label="Show only" style={{ gap: 6 }}>
        {(["all", ...CATEGORIES] as const).map((c) => {
          const n = c === "all" ? cells.length : cells.filter((x) => x.category === c).length;
          if (c !== "all" && n === 0) return null;
          return (
            <button key={c} className="chip" aria-pressed={filter === c} onClick={() => { setFilter(c); setLimit(20); }}
              style={{ cursor: "pointer", border: "1px solid var(--line-strong)", ...(filter === c ? { background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" } : { background: "transparent" }) }}>
              {c === "all" ? "All" : c} · {n}
            </button>
          );
        })}
      </div>
      {shown.slice(0, limit).map((c) => (
        <SquareCard key={c.cell_id} c={c} a={a} open={selected === c.cell_id} onToggle={() => onSelect(selected === c.cell_id ? null : c.cell_id)} onOverride={() => setOverride(c)} />
      ))}
      {shown.length > limit && <button className="btn" onClick={() => setLimit((l) => l + 20)}>Show more squares ({shown.length - limit} left)</button>}
      <p className="caption muted">The full list is in the spreadsheet download.</p>
      {override && <OverrideModal analysisId={a.id} cell={override} onClose={() => setOverride(null)} />}
    </div>
  );
}

function SquareCard({ c, a, open, onToggle, onOverride }: { c: CellProps; a: AnalysisDetail; open: boolean; onToggle: () => void; onOverride: () => void }) {
  const reasons = squareReasons(c, a.hazard, a.results?.priorities?.cell_km);
  return (
    <article id={`sq-${c.cell_id}`} className={`square-card ${open ? "selected" : ""}`} aria-label={`Square ${c.cell_id}, ${c.category} priority, number ${c.rank}`}>
      <button className="row between" onClick={onToggle} aria-expanded={open}
        style={{ all: "unset", display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12, cursor: "pointer", borderRadius: 8 }}>
        <span className="row" style={{ gap: 12 }}>
          <span className="square-rank tabular">#{c.rank}</span>
          <span className="stack" style={{ gap: 4 }}>
            <PriorityChip category={c.category} override={!!c.override_reason} />
            <span className="caption muted">Square {c.cell_id} · score {fmtNum(c.score, 0)} of 100 · how sure: {c.confidence.toLowerCase()}</span>
          </span>
        </span>
        <ChevronDown size={20} className="muted" aria-hidden style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .25s" }} />
      </button>
      {c.needs_verification && <Callout tone="warn">Check before acting: the evidence for this square is weak.</Callout>}
      <ul className="reason-list">
        {(open ? reasons : reasons.slice(0, 2)).map((r) => <li key={r.text}>{REASON_ICON[r.icon]}<span>{r.text}</span></li>)}
      </ul>
      {open && (
        <div className="stack fade-in" style={{ marginTop: 16, gap: 18 }}>
          <div>
            <h5 style={{ marginBottom: 8 }}>Why it scored {fmtNum(c.score, 0)}</h5>
            <ContributionBars labels={FACTOR_LABEL} colors={FACTOR_COLOR} groups={[
              { name: "Damage", subscore: c.hazard_subscore, parts: Object.entries(c.contributions.hazard).map(([k, v]) => ({ key: k, value: v, raw: c.factors[k] })) },
              { name: "People and places", subscore: c.exposure_subscore, parts: Object.entries(c.contributions.exposure).map(([k, v]) => ({ key: k, value: v, raw: c.factors[k] })) },
            ]} />
          </div>
          <div>
            <h5 style={{ marginBottom: 6 }}>Suggested next steps</h5>
            <ul className="small ink-2">{c.recommended_actions.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="caption muted" style={{ marginTop: 6 }}>Suggestions to help people decide - not orders.</p>
          </div>
          <ConfidenceMeter level={c.confidence} />
          {c.sensitivity && (
            <p className="small ink-2"><strong>How stable is this ranking?</strong> If the scoring weights are nudged a little, this square stays between number {c.sensitivity.rank_p10} and {c.sensitivity.rank_p90},
              and keeps its {c.category} label {fmtPct(c.sensitivity.category_stability)} of the time.</p>
          )}
          {c.override_reason && <Callout tone="info" title={`Priority changed by ${c.overridden_by}`}>Reason: {c.override_reason}. AegisEO's own ranking was {c.model_category}.</Callout>}
          <div className="row-wrap">
            <button className="btn btn-sm" onClick={onOverride}>Change this square's priority</button>
          </div>
        </div>
      )}
    </article>
  );
}

function OverrideModal({ analysisId, cell, onClose }: { analysisId: string; cell: CellProps; onClose: () => void }) {
  const [cat, setCat] = useState<Category>(cell.category);
  const [reason, setReason] = useState("");
  const m = useOverride(analysisId);
  const toast = useToast();
  const save = async (clear = false) => {
    try {
      await m.mutateAsync({ cell: cell.cell_id, category: clear ? null : cat, reason: clear ? "override cleared" : reason.trim() });
      toast("ok", clear ? "Back to AegisEO's own ranking." : `Saved. Square ${cell.cell_id} is now ${cat}.`);
      onClose();
    } catch (e) {
      toast("error", friendlyError(e));
    }
  };
  return (
    <Modal title={`Change the priority of square ${cell.cell_id}`} open onClose={onClose} footer={<>
      {cell.override_reason && <button className="btn btn-ghost" onClick={() => save(true)} disabled={m.isPending}>Undo my change</button>}
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={reason.trim().length < 5 || m.isPending} onClick={() => save()}>Save</button></>}>
      <div className="stack-lg">
        <p className="small ink-2">Use this when you know something AegisEO can't see - for example a report from people on the ground. Your name and reason are saved, shown in the report, and AegisEO's own ranking ({cell.model_category}) is kept.</p>
        <fieldset>
          <legend className="label" style={{ marginBottom: 10 }}>New priority</legend>
          <div className="stack" style={{ gap: 8 }}>
            {CATEGORIES.map((c) => (
              <label key={c} className="row" style={{ gap: 12, cursor: "pointer", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 12, background: cat === c ? "var(--surface-3)" : "var(--surface)" }}>
                <input type="radio" name="cat" checked={cat === c} onChange={() => setCat(c)} />
                <PriorityChip category={c} /> <span className="small ink-2">{PRIORITY[c].short}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="field">
          <label className="label" htmlFor="reason">Why? (required)</label>
          <textarea id="reason" className="textarea" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The local team says the water has gone down and the clinic is open." />
          {reason.trim().length > 0 && reason.trim().length < 5 && <span className="error-text">Please write at least 5 characters.</span>}
        </div>
      </div>
    </Modal>
  );
}

// ============================================================================ people & places
const ROAD_NAMES: Record<string, string> = {
  motorway: "Motorways", trunk: "Major roads", primary: "Main roads", secondary: "Secondary roads", tertiary: "Local roads",
  residential: "Streets", unclassified: "Minor roads", track: "Tracks", service: "Service roads", living_street: "Streets",
};

export function PeoplePanel({ a, facilities }: { a: AnalysisDetail; facilities?: GeoJSON.FeatureCollection<GeoJSON.Point> }) {
  const imp = a.results?.impact;
  if (!imp) return <Empty title="Nothing to show">No information about people and places was produced for this check.</Empty>;
  const h = HAZARDS[a.hazard];
  type P = { name: string | null; category: string; status: string; distance_m: number | null };
  const all = (facilities?.features ?? []).map((f) => f.properties as unknown as P);
  const places = all.filter((f) => f.status !== "outside" && f.category !== "settlement").sort((x, y) => (x.status === "inside" ? -1 : 1) - (y.status === "inside" ? -1 : 1) || (x.distance_m ?? 0) - (y.distance_m ?? 0));
  const roads = Object.entries(imp.roads.affected_km_by_class ?? {}).map(([k, v]) => ({ label: ROAD_NAMES[k] ?? sentence(k), value: v })).sort((x, y) => y.value - x.value);
  const land = Object.entries(imp.landcover_affected_ha ?? {}).map(([label, value]) => ({ label, value })).sort((x, y) => y.value - x.value);
  return (
    <div>
      <Callout tone="info">Everything here is about who and what is <strong>in or near the {h.areaName}</strong>. It does not mean anyone was hurt or anything was damaged.</Callout>
      <div className="panel-section" style={{ marginTop: 20 }}>
        <h3>People</h3>
        {imp.population.available ? (
          <>
            <p><span className="fact-value" style={{ fontFamily: "var(--font-display)", fontSize: "2rem", fontWeight: 560 }}>{fmtInt(imp.population.potentially_exposed)}</span> people normally live in the {h.areaName}
              {imp.population.aoi_total != null && <>, out of about {fmtInt(imp.population.aoi_total)} in the whole area that was checked</>}.</p>
            <p className="caption muted" style={{ marginTop: 6 }}>An estimate from {imp.population.source}{imp.population.year ? ` (${imp.population.year})` : ""}. {imp.population.note}</p>
          </>
        ) : <p className="small ink-2">Population numbers weren't available here ({imp.population.note}). The amount of built-up land was used instead when ranking squares.</p>}
      </div>
      <div className="panel-section">
        <h3>Important places ({places.length})</h3>
        {places.length === 0 ? <p className="small ink-2">No hospitals, schools, emergency services, shelters, power or water works are mapped inside the {h.areaName} or within 500 m of it{imp.roads.available ? "" : " (map data was unavailable)"}.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Place</th><th>What it is</th><th>Where</th></tr></thead>
              <tbody>{places.map((f, i) => (
                <tr key={i}><td>{f.name ?? <span className="muted">no name on the map</span>}</td><td>{FACILITY_LABEL[f.category] ?? f.category}</td>
                  <td><span className={`chip ${f.status === "inside" ? "danger" : "warn"}`}>{f.status === "inside" ? "Inside" : `${fmtInt(f.distance_m)} m away`}</span></td></tr>))}</tbody>
            </table>
          </div>
        )}
        <p className="caption muted" style={{ marginTop: 8 }}>From OpenStreetMap. Places missing from the map can't be counted - "none found" doesn't prove there are none.</p>
      </div>
      {imp.settlements_affected.length > 0 && (
        <div className="panel-section">
          <h3>Villages and towns ({imp.settlements_affected.length})</h3>
          <ul className="small" style={{ columns: 2, columnGap: 24 }}>
            {imp.settlements_affected.map((s, i) => <li key={i}>{s.name} <span className="muted">({s.status === "inside" ? "inside" : `${fmtInt(s.distance_m)} m away`})</span></li>)}
          </ul>
        </div>
      )}
      {roads.length > 0 && <div className="panel-section"><h3>Roads crossing the {h.areaName}</h3><BarList items={roads} unit=" km" /></div>}
      {land.length > 0 && <div className="panel-section"><h3>What kind of land was hit</h3><BarList items={land} unit=" ha" /><p className="caption muted" style={{ marginTop: 8 }}>Hectares (1 ha = 100 × 100 m). Land types from ESA WorldCover 2021.</p></div>}
      {imp.limitations.length > 0 && (
        <div className="panel-section"><Disclosure summary="Known limits of these numbers"><ul className="small ink-2">{imp.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Disclosure></div>
      )}
    </div>
  );
}

// ============================================================================ how we know
export function EvidencePanel({ a, trace, traceLoading }: { a: AnalysisDetail; trace?: Trace; traceLoading: boolean }) {
  const r = a.results;
  if (!r) return <Empty title="Nothing to show" />;
  const q = r.hazard?.quality ?? {};
  const rain = r.context?.rainfall;
  const checks = (trace?.guardrails ?? []).filter((g) => g.outcome !== "pass");
  const passed = (trace?.guardrails ?? []).filter((g) => g.outcome === "pass").length;
  const obs = [...a.observations].sort((x, y) => (x.role === y.role ? x.sensor.localeCompare(y.sensor) : x.role === "pre" ? -1 : 1));
  return (
    <div>
      <div className="panel-section" style={{ marginTop: 0 }}>
        <h3>Photos used</h3>
        <ul className="reason-list">
          {obs.map((o) => (
            <li key={o.sensor + o.role}>
              {o.role === "pre" ? <CheckCircle2 size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden style={{ color: "var(--accent)" }} />}
              <span><strong>{o.sensor === "S1" ? "Radar" : "Camera"} photo, {o.role === "pre" ? "before" : "after"}</strong> · {fmtDate(o.acquired_at)}
                {o.cloud_fraction != null && <span className="muted"> · {fmtPct(o.cloud_fraction)} cloud over your area</span>}
                {o.synthetic && <span className="muted"> · made-up</span>}</span>
            </li>
          ))}
          {obs.length === 0 && <li><Info size={16} aria-hidden /><span>No photo details were recorded.</span></li>}
        </ul>
      </div>

      <div className="panel-section">
        <h3>How strong is the evidence?</h3>
        <div className="stack" style={{ gap: 16 }}>
          <Quality label="A second method agrees" value={q.cross_method_agreement as number | null} good
            tip="Share of the found area that a separate, simpler method (radar change or a water index) also flags. Higher is better." />
          <Quality label="Average likelihood in the found area" value={q.mean_probability_detected as number | null} good
            tip="How likely, on average, the computer thinks each marked spot really is affected." />
          <Quality label="How unsure the computer was" value={q.mean_uncertainty_detected as number | null} max={0.3}
            tip="Lower is better. Above 0.15 AegisEO asks a person to check." fmt={(v) => fmtNum(v, 2)} />
          {q.s2_post_cloud_fraction != null && <Quality label="Clouds in the 'after' camera photo" value={q.s2_post_cloud_fraction as number}
            tip="Share of your area hidden by cloud or cloud shadow. Radar is not affected by clouds." />}
          {q.mean_sar_reliance_detected != null && <Quality label="Decided mostly by radar" value={q.mean_sar_reliance_detected as number} neutral
            tip="How much the computer relied on radar (rather than the camera) inside the found area." />}
        </div>
      </div>

      <div className="panel-section">
        <h3>Safety checks</h3>
        {traceLoading && <Loading />}
        {trace && (
          <>
            <p className="small ink-2" style={{ marginBottom: 12 }}><CheckCircle2 size={16} aria-hidden style={{ color: "var(--ok)", verticalAlign: -3 }} /> {passed} check{passed === 1 ? "" : "s"} passed{checks.length ? `, ${checks.length} raised a note:` : "."}</p>
            <div className="stack">
              {checks.map((g, i) => {
                const c = CHECKS[g.code];
                return (
                  <Callout key={i} tone={g.outcome === "warn" ? "neutral" : "warn"} icon={<AlertTriangle size={18} aria-hidden />}
                    title={<>{c?.title ?? g.name} <span className="chip outline" style={{ marginLeft: 6, minHeight: 22 }}>{g.outcome === "escalate" ? "a person should check" : g.outcome === "block" ? "stopped" : "note"}</span></>}>
                    <span>{c?.why ?? g.message}</span>
                    <span className="caption muted" style={{ display: "block", marginTop: 4 }}><code>{g.code}: {g.message}</code></span>
                  </Callout>
                );
              })}
            </div>
          </>
        )}
      </div>

      {rain?.series && rain.series.length > 0 && (
        <div className="panel-section">
          <h3>Rain around that time</h3>
          <p className="small ink-2" style={{ marginBottom: 10 }}>Daily rain at the middle of the area: {fmtNum(rain.total_mm, 0)} mm in total{rain.peak_day ? `, most on ${fmtDate(rain.peak_day.date)} (${fmtNum(rain.peak_day.mm, 0)} mm)` : ""}.</p>
          <ColumnChart data={rain.series.map((d) => ({ x: d.date, y: d.mm }))} unit="mm" ariaLabel="Daily rain in millimetres" />
          {rain.note && <p className="caption muted">{rain.note}</p>}
        </div>
      )}

      {r.narrative?.summary && (
        <div className="panel-section">
          <h3>Written summary</h3>
          <p className="small" style={{ lineHeight: 1.7 }}>{r.narrative.summary}</p>
          <p className="caption muted" style={{ marginTop: 8 }}>{r.narrative.summary_source === "template"
            ? "Written from the measured numbers by a fixed template. The same text is used in the PDF report."
            : "Drafted by an AI language model from the measured numbers, then checked number by number. The same text is used in the PDF report."}</p>
        </div>
      )}

      <div className="panel-section">
        <Disclosure summary="The method, for specialists">
          <p className="small strong">{r.hazard?.method}</p>
          <ul className="small ink-2" style={{ marginTop: 8 }}>{r.hazard?.methodology.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="caption muted" style={{ marginTop: 8 }}>Model version: <code>{String(r.hazard?.model_info?.version ?? "-")}</code></p>
        </Disclosure>
        {r.limitations.length > 0 && (
          <Disclosure summary="Known limits of this result"><ul className="small ink-2">{r.limitations.map((l) => <li key={l}>{l}</li>)}</ul></Disclosure>
        )}
        <Disclosure summary="Full step-by-step record (for specialists)">
          <TraceView trace={trace} loading={traceLoading} />
        </Disclosure>
      </div>
    </div>
  );
}

function Quality({ label, value, max = 1, good, neutral, tip, fmt }: { label: string; value: number | null | undefined; max?: number; good?: boolean; neutral?: boolean; tip: string; fmt?: (v: number) => string }) {
  const v = value ?? null;
  const tone = v == null || neutral ? "brand" : good ? (v >= 0.75 ? "ok" : v >= 0.55 ? "brand" : "warn") : v / max > 0.5 ? "warn" : "brand";
  return (
    <div>
      <div className="row between small" style={{ marginBottom: 6 }}><span>{label} <InfoTip text={tip} /></span><strong className="tabular">{v == null ? "not measured" : fmt ? fmt(v) : fmtPct(v)}</strong></div>
      <Meter value={v ?? 0} max={max} tone={tone as "ok"} label={label} />
    </div>
  );
}

// ============================================================================ full record (specialists)
type TraceViewId = "steps" | "decisions" | "tools" | "checks" | "facts";

export function TraceView({ trace, loading }: { trace?: Trace; loading: boolean }) {
  const [view, setView] = useState<TraceViewId>("steps");
  if (loading || !trace) return <Loading label="Loading the record" />;
  const m = trace.metrics;
  return (
    <div className="stack" style={{ gap: 14 }}>
      {m && <p className="small ink-2">{m.tool_stats.calls} tool calls ({fmtPct(m.tool_stats.success_rate)} worked) · {Object.values(m.guardrail_outcomes).reduce((x, y) => x + y, 0)} safety checks · took {fmtDuration(m.duration_s)}</p>}
      <div className="row-wrap" role="group" aria-label="Part of the record" style={{ gap: 6 }}>
        {([["steps", "Steps"], ["decisions", "Decisions"], ["tools", "Tools used"], ["checks", "Safety checks"], ["facts", "Evidence and facts"]] as const).map(([id, label]) => (
          <button key={id} className="chip" aria-pressed={view === id} onClick={() => setView(id)}
            style={{ cursor: "pointer", border: "1px solid var(--line-strong)", ...(view === id ? { background: "var(--ink)", color: "#fff" } : { background: "transparent" }) }}>{label}</button>
        ))}
      </div>
      {view === "steps" && (
        <div className="timeline">
          {trace.steps.map((s) => (
            <div key={s.seq} className="tl-item">
              <span className={`tl-dot ${s.status === "ok" ? "ok" : "warn"}`}><ListChecks size={11} aria-hidden /></span>
              <div className="caption muted">{sentence(s.phase)} · {s.agent.replace(/_/g, " ")}{s.duration_ms ? ` · ${fmtNum(s.duration_ms / 1000, 1)} s` : ""}</div>
              <div className="small strong">{s.title}</div>
              {s.detail && <div className="caption ink-2">{s.detail.slice(0, 600)}</div>}
              {s.rationale && <div className="caption muted">Why: {s.rationale}</div>}
            </div>
          ))}
        </div>
      )}
      {view === "decisions" && (
        <div className="stack">
          {trace.decisions.length === 0 && <p className="small muted">No choices had to be made in this run.</p>}
          {trace.decisions.map((d, i) => (
            <div key={i} className="card-sunk" style={{ padding: 14 }}>
              <div className="caption muted">{d.agent.replace(/_/g, " ")}{d.rule ? ` · rule ${d.rule}` : ""}</div>
              <div className="small"><strong>{d.question}:</strong> {d.chosen}</div>
              <div className="caption ink-2">{d.rationale}</div>
              {d.alternatives.length > 0 && <div className="caption muted">Other options: {d.alternatives.join("; ")}</div>}
            </div>
          ))}
        </div>
      )}
      {view === "tools" && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Tool</th><th>Effect</th><th>Result</th><th className="num">ms</th></tr></thead>
            <tbody>{trace.tool_calls.map((t) => (
              <tr key={t.seq} title={t.error ?? JSON.stringify(t.result ?? {}).slice(0, 400)}>
                <td className="tabular">{t.seq}</td><td><code>{t.tool}</code><div className="caption muted">{t.agent.replace(/_/g, " ")}</div></td>
                <td className="caption">{t.side_effect.replace("_", " ")}</td>
                <td><span className={`chip ${t.status === "ok" ? "ok" : t.status === "blocked" ? "danger" : "warn"}`}>{t.status}</span>{t.error && <div className="caption muted" style={{ maxWidth: 240 }}>{t.error.slice(0, 140)}</div>}</td>
                <td className="num">{fmtInt(t.latency_ms)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {view === "checks" && (
        <div className="stack" style={{ gap: 8 }}>
          {trace.guardrails.map((g, i) => (
            <div key={i} className="row small" style={{ alignItems: "flex-start", gap: 10 }}>
              <span className={`chip ${g.outcome === "pass" ? "ok" : g.outcome === "warn" ? "warn" : "danger"}`} style={{ minWidth: 80, justifyContent: "center" }}>{g.outcome}</span>
              <span className="grow"><strong>{g.code} {g.name}</strong><div className="caption ink-2">{g.message}</div></span>
            </div>
          ))}
        </div>
      )}
      {view === "facts" && (
        <div className="stack">
          {Object.values(trace.evidence).map((e) => (
            <div key={e.id} className="small">
              <code>{e.id}</code> <span className="chip outline" style={{ minHeight: 22 }}>{e.kind}</span>
              <div className="caption ink-2">{e.description}</div>
              {e.stac_items?.map((u) => <div key={u} className="caption"><a href={u} target="_blank" rel="noopener noreferrer">{u.split("/items/")[1]}</a></div>)}
            </div>
          ))}
          <div className="table-wrap"><table className="table"><thead><tr><th>Fact</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>{Object.values(trace.facts).map((f) => <tr key={f.key}><td><code>{f.key}</code><div className="caption muted">{f.description}</div></td>
              <td className="tabular">{String(f.value)}{f.unit ? ` ${f.unit}` : ""}</td><td className="caption"><code>{f.source}</code></td></tr>)}</tbody></table></div>
          <p className="caption muted">Recorded {fmtDateTime(trace.steps[trace.steps.length - 1]?.at)}.</p>
        </div>
      )}
    </div>
  );
}
