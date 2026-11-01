import { ArrowRight, BellRing, ClipboardCheck, Gauge, Globe2, MapPinned, Radar, ShieldAlert, Timer, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useDashboard, useLiveEvents, useSources } from "@/api/hooks";
import type { AnalysisBrief, LiveEvent } from "@/api/types";
import { PriorityDistribution } from "@/components/charts";
import { EventsMap, HAZARD_COLOR } from "@/components/map/EventsMap";
import { Card, Empty, ErrorState, HazardChip, Loading, PriorityChip, Stat, StatusChip, SyntheticChip } from "@/components/ui";
import { fmtArea, fmtCompact, fmtDate, fmtDuration, fmtPct, timeAgo } from "@/lib/format";

const SUPPORTED: Record<string, string> = { flood: "flood", tropical_cyclone: "flood", wildfire: "wildfire" };

export function Overview() {
  const dash = useDashboard();
  const events = useLiveEvents();
  const sources = useSources();
  const nav = useNavigate();
  const [selected, setSelected] = useState<LiveEvent | null>(null);
  const evList = useMemo(() => (events.data?.events ?? []).slice().sort((a, b) =>
    ({ Red: 0, Orange: 1, Green: 2 }[a.alert_level ?? ""] ?? 3) - ({ Red: 0, Orange: 1, Green: 2 }[b.alert_level ?? ""] ?? 3)), [events.data]);

  const analyseEvent = (e: LiveEvent) => {
    const hz = SUPPORTED[e.hazard];
    const params = new URLSearchParams({ lat: String(e.lat), lon: String(e.lon), name: e.name.slice(0, 100), date: (e.from || e.time || "").slice(0, 10) });
    if (hz) params.set("hazard", hz);
    nav(`/analyze?${params.toString()}`);
  };

  const d = dash.data;
  return (
    <div className="stack fade-in" style={{ gap: 20 }}>
      <section className="hero" style={{ backgroundImage: "url(/images/hero-sindh-2022.jpg)" }}>
        <span className="chip" style={{ background: "rgba(255,255,255,.16)", color: "#fff", width: "fit-content", marginBottom: 14 }}>
          <Radar size={13} aria-hidden /> Agentic multi-sensor disaster intelligence
        </span>
        <h1>See what changed on the ground - and where help is needed first.</h1>
        <p>Radar and optical satellite observations, fused by an AI agent into evidence-backed response priorities that people review and approve.</p>
        <div className="row-wrap" style={{ marginTop: 20 }}>
          <Link to="/analyze" className="btn btn-primary btn-lg">Start an analysis <ArrowRight size={16} aria-hidden /></Link>
          <Link to="/analyze?scenario=synthetic-flood" className="btn btn-lg">Try the offline demo</Link>
        </div>
        <span className="credit">Sentinel-2, 10 Sep 2022, Sindh, Pakistan - contains modified Copernicus Sentinel data 2022</span>
      </section>

      {dash.isError && <ErrorState error={dash.error} onRetry={() => dash.refetch()} />}
      <div className="grid g-5">
        <Stat label="Analyses run" value={fmtCompact(d?.analyses.total)} icon={<Radar size={16} />}
          sub={d ? `${d.analyses.by_mode.real ?? 0} real · ${d.analyses.by_mode.synthetic ?? 0} simulated` : " "} />
        <Stat label="Area mapped (real data)" value={d ? fmtArea(d.impact_real.affected_area_km2) : "-"} icon={<MapPinned size={16} />}
          sub="detected hazard extent" tip="Sum of detected extents across completed real-data analyses. Simulated runs are excluded." />
        <Stat label="People potentially exposed" value={fmtCompact(d?.impact_real.population_exposed)} icon={<Users size={16} />}
          sub="real data, estimate" tip="Residents inside detected extents (gridded population estimates). Exposure is not impact." />
        <Stat label="Open review items" value={fmtCompact(d?.review.open_tasks)} icon={<ClipboardCheck size={16} />}
          sub={<Link to="/review">Go to the review queue</Link>} />
        <Stat label="Alerts awaiting approval" value={fmtCompact(d?.review.alerts_pending)} icon={<BellRing size={16} />}
          sub={<Link to="/alerts">Review alerts</Link>} />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)", gap: 16 }}>
        <Card title="Current hazard alerts" sub={events.data ? `GDACS and USGS (M5.5+), fetched ${timeAgo(events.data.fetched_at)}` : "GDACS and USGS live feeds"}
          actions={<span className="chip info"><Globe2 size={13} aria-hidden /> near-real-time</span>}>
          {events.isError && <ErrorState error={events.error} onRetry={() => events.refetch()} />}
          <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 14 }}>
            <EventsMap events={evList} onSelect={setSelected} />
            <div style={{ maxHeight: 340, overflowY: "auto" }} className="stack">
              {events.isLoading && <Loading label="Loading live alerts" />}
              {!events.isLoading && evList.length === 0 && <Empty title="No current alerts">Feeds returned no events, or are unreachable.</Empty>}
              {evList.slice(0, 30).map((e) => (
                <button key={e.id} className={`cell-card ${selected?.id === e.id ? "selected" : ""}`} style={{ textAlign: "left" }} onClick={() => setSelected(e)}>
                  <div className="row between">
                    <span className="row xs" style={{ gap: 6 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: HAZARD_COLOR[e.hazard] ?? "#64748b" }} aria-hidden />
                      <strong style={{ textTransform: "capitalize" }}>{e.hazard.replace(/_/g, " ")}</strong>
                    </span>
                    {e.alert_level && <span className={`chip ${e.alert_level === "Red" ? "danger" : e.alert_level === "Orange" ? "warn" : "ok"}`}>{e.alert_level}</span>}
                  </div>
                  <div className="small" style={{ marginTop: 4, fontWeight: 600 }}>{e.name}</div>
                  <div className="xs muted">{e.source} · {fmtDate(e.from || e.time)}{e.magnitude ? ` · M${e.magnitude}` : ""}</div>
                  {selected?.id === e.id && (
                    <div className="row" style={{ marginTop: 8 }}>
                      {SUPPORTED[e.hazard] ? (
                        <span className="btn btn-primary btn-sm" role="link" tabIndex={0} onClick={(ev) => { ev.stopPropagation(); analyseEvent(e); }}
                          onKeyDown={(ev) => ev.key === "Enter" && analyseEvent(e)}>Analyse this area</span>
                      ) : (
                        <span className="xs muted">{e.hazard.replace(/_/g, " ")} mapping is not supported by AegisEO (context only).</span>
                      )}
                      {e.url && <a className="xs" href={e.url} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}>Source report</a>}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </Card>
        <div className="stack" style={{ gap: 16 }}>
          <Card title="Response priorities" sub="All prioritised cells, after analyst overrides">
            {d ? <PriorityDistribution counts={d.priority_distribution} /> : <Loading />}
          </Card>
          <Card title="Agent performance" sub="Measured over all runs and human reviews">
            {d ? (
              <div className="grid g-2" style={{ gap: 12 }}>
                <Metric icon={<Gauge size={15} />} label="Tool success rate" value={fmtPct(d.agent_metrics.tool_success_rate, 1)} tip="Share of executed agent tool calls that succeeded (external outages count as failures)." />
                <Metric icon={<ShieldAlert size={15} />} label="Escalation rate" value={fmtPct(d.agent_metrics.escalation_rate)} tip="Share of completed analyses the agent routed to human review." />
                <Metric icon={<ClipboardCheck size={15} />} label="Human override rate" value={fmtPct(d.agent_metrics.priority_override_rate, 1)} tip="Share of prioritised cells whose category an analyst changed." />
                <Metric icon={<Timer size={15} />} label="Median run time" value={fmtDuration(d.agent_metrics.median_latency_s)} tip="Median end-to-end duration of completed analyses." />
              </div>
            ) : <Loading />}
          </Card>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1.65fr) minmax(0, 1fr)", gap: 16 }}>
        <Card title="Recent analyses" actions={<Link to="/analyses" className="btn btn-sm">View all</Link>} pad={false}>
          {d && d.recent.length === 0 && <Empty title="No analyses yet"><Link to="/analyze">Start your first analysis</Link> or try the offline demo.</Empty>}
          <div className="table-wrap">
            {d && d.recent.length > 0 && (
              <table className="table">
                <thead><tr><th>Analysis</th><th>Hazard</th><th>Status</th><th>Top priority</th><th className="num">Affected</th><th>When</th></tr></thead>
                <tbody>{d.recent.map((a) => <RecentRow key={a.id} a={a} />)}</tbody>
              </table>
            )}
          </div>
        </Card>
        <Card title="Data sources" sub="Live health of integrated services" actions={<Link to="/sources" className="btn btn-sm">Details</Link>}>
          {sources.isLoading && <Loading label="Checking sources" />}
          <div className="stack" style={{ gap: 6 }}>
            {sources.data?.filter((s) => s.category !== "training").slice(0, 9).map((s) => (
              <div key={s.id} className="row between small">
                <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                <SourceStatus status={s.status} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, tip }: { icon: React.ReactNode; label: string; value: string; tip: string }) {
  return (
    <div title={tip} style={{ padding: 12, borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
      <div className="row xs muted" style={{ gap: 6 }}>{icon}{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 650, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function SourceStatus({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    operational: ["ok", "Operational"], degraded: ["warn", "Degraded"], unavailable: ["danger", "Unavailable"], offline: ["warn", "Offline mode"],
    not_configured: ["", "Not configured"], static: ["brand", "Static dataset"], unknown: ["", "Unknown"],
  };
  const [tone, label] = map[status] ?? ["", status];
  return <span className={`chip ${tone}`}><span className="chip-dot" aria-hidden />{label}</span>;
}

function RecentRow({ a }: { a: AnalysisBrief }) {
  const nav = useNavigate();
  return (
    <tr className="clickable" onClick={() => nav(`/analyses/${a.id}`)}>
      <td><Link to={`/analyses/${a.id}`} onClick={(e) => e.stopPropagation()}><strong>{a.name}</strong></Link> {a.mode === "synthetic" && <SyntheticChip />}</td>
      <td><HazardChip hazard={a.hazard} /></td>
      <td><StatusChip status={a.status} /></td>
      <td>{a.top_priority ? <PriorityChip category={a.top_priority} /> : <span className="muted">-</span>}</td>
      <td className="num">{fmtArea(a.summary?.affected_area_km2)}</td>
      <td className="muted xs">{timeAgo(a.created_at)}</td>
    </tr>
  );
}
