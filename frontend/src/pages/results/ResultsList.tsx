import { ArrowRight, ChevronRight, Plus, Search, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAnalyses } from "@/api/hooks";
import type { AnalysisBrief, Hazard } from "@/api/types";
import { Empty, ErrorState, PageHead, PracticeChip, PriorityChip, StatusChip, Tabs } from "@/components/ui";
import { fmtDate, timeAgo } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { ACTIVE, FINISHED, HAZARDS } from "@/lib/meta";
import { oneLiner } from "@/lib/plain";

type Filter = "all" | "review" | "done" | "running" | "problem";
const FILTERS: Record<Filter, (a: AnalysisBrief) => boolean> = {
  all: () => true,
  review: (a) => a.status === "needs_review",
  done: (a) => FINISHED.has(a.status),
  running: (a) => ACTIVE.has(a.status),
  problem: (a) => !FINISHED.has(a.status) && !ACTIVE.has(a.status),
};

export function ResultsList() {
  useDocumentTitle("Results");
  const q = useAnalyses();
  const [filter, setFilter] = useState<Filter>("all");
  const [hazard, setHazard] = useState<Hazard | "">("");
  const [practice, setPractice] = useState(true);
  const [query, setQuery] = useState("");
  const all = q.data?.items ?? [];
  const rows = useMemo(() => all.filter((a) => FILTERS[filter](a) && (!hazard || a.hazard === hazard) && (practice || a.mode === "real")
    && a.name.toLowerCase().includes(query.trim().toLowerCase())), [all, filter, hazard, practice, query]);
  const count = (f: Filter) => all.filter(FILTERS[f]).length;

  return (
    <div className="page page-enter">
      <PageHead title="Results" lead="Every check that has been run, newest first. Open one to see the map, where to help first, and how AegisEO reached its answer."
        actions={<Link className="btn btn-primary" to="/check"><Plus size={18} aria-hidden /> Check a place</Link>} />

      <div className="row-wrap between" style={{ gap: 16, marginBottom: 20 }}>
        <Tabs<Filter> label="Show" value={filter} onChange={setFilter} tabs={[
          { id: "all", label: "All", badge: all.length || undefined }, { id: "review", label: "Needs a person", badge: count("review") || undefined },
          { id: "done", label: "Done" }, { id: "running", label: "Running", badge: count("running") || undefined }, { id: "problem", label: "Didn't finish" },
        ]} />
        <div className="input-group" style={{ flex: "0 1 320px" }}>
          <Search size={18} aria-hidden />
          <input className="input" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search results by name" />
        </div>
      </div>
      <div className="row-wrap" style={{ marginBottom: 20, gap: 8 }}>
        <span className="small muted" style={{ marginRight: 4 }}>Type:</span>
        {(["", "flood", "wildfire", "landslide"] as const).map((h) => (
          <button key={h || "all"} className={`chip ${hazard === h ? "" : "outline"}`} style={hazard === h ? { background: "var(--ink)", color: "#fff", cursor: "pointer" } : { cursor: "pointer" }}
            aria-pressed={hazard === h} onClick={() => setHazard(h)}>
            {h ? <>{HAZARDS[h].icon(14)} {HAZARDS[h].label}</> : "All types"}
          </button>
        ))}
        <label className="row small" style={{ marginLeft: "auto", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={practice} onChange={(e) => setPractice(e.target.checked)} /> Show practice runs
        </label>
      </div>

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.isLoading && <div className="stack">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 84 }} />)}</div>}
      {q.data && rows.length === 0 && (
        <div className="card">
          <Empty title={all.length ? "Nothing matches" : "No results yet"} icon={<SearchX size={40} aria-hidden />}
            action={<Link to="/check" className="btn btn-primary">Check a place <ArrowRight size={16} className="arrow" aria-hidden /></Link>}>
            {all.length ? "Try a different filter or search." : "Start your first check - it will show up here."}
          </Empty>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="card" style={{ listStyle: "none", padding: 0, margin: 0, opacity: q.isFetching && !q.isLoading ? 0.85 : 1, transition: "opacity .2s" }} aria-label="Checks">
          {rows.map((a) => <Row key={a.id} a={a} />)}
        </ul>
      )}
      {q.data && q.data.total > all.length && <p className="caption muted" style={{ marginTop: 12 }}>Showing the newest {all.length} of {q.data.total}.</p>}
    </div>
  );
}

function Row({ a }: { a: AnalysisBrief }) {
  const h = HAZARDS[a.hazard];
  const line = oneLiner(a);
  return (
    <li style={{ margin: 0, borderBottom: "1px solid var(--line)" }}>
      <Link to={`/results/${a.id}`} className="pulse-item" style={{ gridTemplateColumns: "auto minmax(0, 1fr) auto", padding: "16px 20px", border: 0 }}>
        <span className="hz-dot" style={{ width: 48, height: 48, background: h.soft, color: h.color }}>{h.icon(22)}</span>
        <span style={{ minWidth: 0 }}>
          <strong style={{ display: "block", fontSize: "var(--fs-body)" }}>{a.name}</strong>
          <span className="small muted" style={{ display: "block" }}>
            {a.status === "running" ? `${a.message ?? "Working"} · ${Math.round(a.progress * 100)}%` : line || STATUS_LINE(a)} · {h.label} · happened {fmtDate(a.event_date)} · run {timeAgo(a.created_at)}
          </span>
          <span className="row-wrap" style={{ marginTop: 8, gap: 6 }}>
            <StatusChip status={a.status} />
            {a.mode === "synthetic" && <PracticeChip />}
            {a.top_priority && <PriorityChip category={a.top_priority} />}
          </span>
        </span>
        <ChevronRight size={20} className="muted" aria-hidden />
      </Link>
    </li>
  );
}

const STATUS_LINE = (a: AnalysisBrief) => (a.status === "insufficient_data" ? "No usable photos found" : a.status === "queued" ? "Waiting to start" : "No result");
