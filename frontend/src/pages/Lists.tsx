import { BellRing, ClipboardCheck, Plus, RefreshCcw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAlerts, useAnalyses, useRecheckSources, useReviews, useSources } from "@/api/hooks";
import { Card, Empty, ErrorState, HazardChip, Loading, PriorityChip, StatusChip, SyntheticChip, Tabs } from "@/components/ui";
import { fmtArea, fmtDate, fmtDuration, fmtInt, timeAgo } from "@/lib/format";
import { AlertItem, ReviewItem } from "./AnalysisDetail";
import { SourceStatus } from "./Overview";

export function Analyses() {
  const [status, setStatus] = useState("");
  const [hazard, setHazard] = useState("");
  const [mode, setMode] = useState("");
  const [query, setQuery] = useState("");
  const q = useAnalyses({ status, hazard, mode });
  const nav = useNavigate();
  const rows = useMemo(() => (q.data?.items ?? []).filter((a) => a.name.toLowerCase().includes(query.toLowerCase())), [q.data, query]);
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>Analyses</h1><p>Every run, its status and headline results. Select a row to open the map, priorities and evidence.</p></div>
        <Link className="btn btn-primary" to="/analyze"><Plus size={15} aria-hidden /> New analysis</Link>
      </div>
      <div className="row-wrap" style={{ marginBottom: 12 }}>
        <div className="row" style={{ background: "#fff", border: "1px solid var(--line-strong)", borderRadius: 10, paddingLeft: 10, minWidth: 240 }}>
          <Search size={15} className="muted" aria-hidden />
          <input className="input" style={{ border: 0, boxShadow: "none" }} placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search analyses" />
        </div>
        <select className="select" style={{ width: 180 }} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {["running", "completed", "completed_with_warnings", "needs_review", "insufficient_data", "failed", "cancelled"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
        </select>
        <select className="select" style={{ width: 150 }} value={hazard} onChange={(e) => setHazard(e.target.value)} aria-label="Filter by hazard">
          <option value="">All hazards</option><option value="flood">Flood</option><option value="wildfire">Wildfire</option><option value="landslide">Landslide</option>
        </select>
        <select className="select" style={{ width: 150 }} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Filter by data mode">
          <option value="">Real and simulated</option><option value="real">Real data</option><option value="synthetic">Simulated</option>
        </select>
      </div>
      <Card pad={false}>
        {q.isError && <div style={{ padding: 16 }}><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}
        {q.isLoading && <Loading />}
        {q.data && rows.length === 0 && <Empty title="No analyses match">Adjust the filters or <Link to="/analyze">start a new analysis</Link>.</Empty>}
        {rows.length > 0 && (
          <div className="table-wrap" style={{ opacity: q.isFetching && !q.isLoading ? 0.75 : 1, transition: "opacity .2s" }}>
            <table className="table">
              <thead><tr><th>Name</th><th>Hazard</th><th>Status</th><th>Event</th><th className="num">Affected</th><th className="num">People exposed</th><th>Top priority</th><th className="num">Run time</th><th>Created</th></tr></thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => nav(`/analyses/${a.id}`)}>
                    <td><Link to={`/analyses/${a.id}`} onClick={(e) => e.stopPropagation()}><strong>{a.name}</strong></Link> {a.mode === "synthetic" && <SyntheticChip />}
                      {a.status === "running" && <div className="xs muted">{a.stage} - {Math.round(a.progress * 100)}%</div>}</td>
                    <td><HazardChip hazard={a.hazard} /></td>
                    <td><StatusChip status={a.status} /></td>
                    <td className="xs">{fmtDate(a.event_date)}</td>
                    <td className="num">{fmtArea(a.summary?.affected_area_km2)}</td>
                    <td className="num">{fmtInt(a.summary?.population_exposed)}</td>
                    <td>{a.top_priority ? <PriorityChip category={a.top_priority} /> : <span className="muted">-</span>}</td>
                    <td className="num">{fmtDuration(a.summary?.duration_s)}</td>
                    <td className="xs muted">{timeAgo(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ReviewQueue() {
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const q = useReviews(status);
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>Review queue</h1><p>Findings the agent was not confident enough to act on, or that touch life-safety facilities. Your decisions are logged, change alert and priority status, and are remembered for later analyses of the same area.</p></div>
      </div>
      <Tabs label="Review status" value={status} onChange={setStatus} tabs={[{ id: "open", label: "Open", badge: q.data?.counts.open }, { id: "resolved", label: "Resolved", badge: q.data?.counts.resolved }]} />
      <div style={{ marginTop: 14 }}>
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.isLoading && <Loading />}
        {q.data && q.data.items.length === 0 && <Card><Empty title={status === "open" ? "Nothing to review" : "No resolved items yet"} icon={<ClipboardCheck size={36} />}>{status === "open" ? "The agent escalates uncertain or high-impact findings here." : ""}</Empty></Card>}
        <div className="grid g-2" style={{ gap: 12 }}>
          {q.data?.items.map((t) => status === "open" ? <ReviewItem key={t.id} task={t} /> : (
            <div key={t.id} className="cell-card" style={{ cursor: "default" }}>
              <div className="row between"><strong className="small">{t.title}</strong><span className="chip ok">{t.decision?.replace(/_/g, " ")}</span></div>
              <p className="small" style={{ marginTop: 4, color: "var(--ink-2)" }}>{t.reason}</p>
              <div className="xs muted" style={{ marginTop: 4 }}>By {t.decided_by} · {timeAgo(t.decided_at)}{t.comment ? ` · "${t.comment}"` : ""} · <Link to={`/analyses/${t.analysis_id}`}>{t.analysis_name}</Link></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Alerts() {
  const [status, setStatus] = useState<"pending_review" | "approved" | "published" | "rejected">("pending_review");
  const q = useAlerts(status);
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>Alerts</h1><p>Evidence-grounded alerts drafted by the agent. Every number has been checked against recorded evidence. Nothing leaves AegisEO until an analyst approves it, and alerts from simulated data can never be published.</p></div>
      </div>
      <Tabs label="Alert status" value={status} onChange={setStatus} tabs={[
        { id: "pending_review", label: "Awaiting approval", badge: q.data?.counts.pending_review }, { id: "approved", label: "Approved", badge: q.data?.counts.approved },
        { id: "published", label: "Published", badge: q.data?.counts.published }, { id: "rejected", label: "Rejected", badge: q.data?.counts.rejected }]} />
      <div style={{ marginTop: 14 }}>
        {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.isLoading && <Loading />}
        {q.data && q.data.items.length === 0 && <Card><Empty title="No alerts here" icon={<BellRing size={36} />} /></Card>}
        <div className="grid g-2" style={{ gap: 12 }}>{q.data?.items.map((a) => <AlertItem key={a.id} alert={a} />)}</div>
      </div>
    </div>
  );
}

export function Sources() {
  const q = useSources();
  const re = useRecheckSources();
  const cats: [string, string][] = [["observation", "Satellite observations"], ["context", "Context and exposure layers"], ["feed", "Live hazard feeds"], ["training", "Training data"], ["service", "Optional services"]];
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>Data sources</h1><p>What each integrated source provides, how current it is, how it can be accessed and where it falls short. Status is checked live; unavailable sources degrade the analysis gracefully and are reported, never replaced with invented values.</p></div>
        <button className="btn" onClick={() => re.mutate()} disabled={re.isPending}><RefreshCcw size={14} aria-hidden /> {re.isPending ? "Checking..." : "Re-check all"}</button>
      </div>
      {q.isLoading && <Loading label="Checking every source" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {cats.map(([c, label]) => {
        const items = (q.data ?? []).filter((s) => s.category === c);
        if (!items.length) return null;
        return (
          <section key={c} style={{ marginBottom: 20 }}>
            <h3 style={{ marginBottom: 10 }}>{label}</h3>
            <div className="grid g-3" style={{ gap: 12 }}>
              {items.map((s) => (
                <Card key={s.id} title={s.name} sub={s.provider} actions={<SourceStatus status={s.status} />}>
                  <p className="small" style={{ marginBottom: 10 }}>{s.provides}</p>
                  <dl className="kv" style={{ gridTemplateColumns: "110px 1fr", fontSize: "var(--fs-xs)" }}>
                    <dt>Coverage</dt><dd>{s.coverage}</dd><dt>Resolution</dt><dd>{s.spatial_resolution}</dd>
                    <dt>Revisit</dt><dd>{s.temporal_resolution}</dd><dt>Updates</dt><dd>{s.update_frequency}</dd>
                    <dt>Timeliness</dt><dd><span className="chip outline" style={{ height: 20 }}>{s.timeliness}</span></dd>
                    <dt>Access</dt><dd>{s.access}</dd><dt>Licence</dt><dd>{s.license}</dd><dt>Limitations</dt><dd style={{ fontWeight: 450 }}>{s.limitations}</dd>
                  </dl>
                  <div className="row between xs muted" style={{ marginTop: 10 }}>
                    <span>{s.health?.latency_ms != null ? `${fmtInt(s.health.latency_ms)} ms` : ""}{s.health?.checked_at ? ` · checked ${timeAgo(s.health.checked_at)}` : ""}</span>
                    <a href={s.url} target="_blank" rel="noopener noreferrer">Documentation</a>
                  </div>
                  {(s.health?.error || s.health?.detail) && <div className={`banner ${s.health?.error ? "warn" : "info"}`} style={{ marginTop: 8, padding: "6px 10px", fontSize: 12 }}>{s.health?.error ?? s.health?.detail}</div>}
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
