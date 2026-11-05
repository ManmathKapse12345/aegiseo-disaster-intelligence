import {
  ArrowLeft, Binoculars, CalendarDays, Check, ChevronDown, CircleSlash, ClipboardCheck, Download, FileSpreadsheet, FileText, Map as MapIcon, RefreshCcw,
  ScanSearch, Square, Users, Building2, ListOrdered, Ruler,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, apiUrl } from "@/api/client";
import {
  useAlerts, useAnalysis, useAnalysisAction, useDetections, useFacilities, useLayers, usePriorities, useReviews, useTrace,
} from "@/api/hooks";
import type { AnalysisDetail, Trace } from "@/api/types";
import {
  Callout, ConfidenceMeter, Disclosure, Empty, ErrorState, HazardChip, Loading, Modal, PracticeChip, StatusChip, Tabs, useToast,
} from "@/components/ui";
import { fmtArea, fmtDate, fmtInt, timeAgo } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { ACTIVE, CHECKS, FINISHED, HAZARDS, PRIORITY, STATUS } from "@/lib/meta";
import { RUN_STAGES, areaPicture, friendlyError, headline, runStageIndex, topCategory } from "@/lib/plain";
import { AlertCard, ReviewCard } from "../review/ReviewCards";
import { EvidencePanel, PeoplePanel, PrioritiesPanel, TraceView } from "./ResultPanels";

const AnalysisMap = lazy(() => import("@/components/map/AnalysisMap").then((m) => ({ default: m.AnalysisMap })));
type TabId = "where" | "people" | "how" | "review";
const STAGE_ICONS = [Check, Binoculars, ScanSearch, Users, ListOrdered];

export function ResultPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const q = useAnalysis(id);
  const a = q.data;
  const active = !!a && ACTIVE.has(a.status);
  const done = !!a && FINISHED.has(a.status);
  const trace = useTrace(id, active);
  const layers = useLayers(id, a?.status);
  const det = useDetections(id, a?.status);
  const cells = usePriorities(id, a?.status);
  const fac = useFacilities(id, a?.status);
  const [tab, setTab] = useState<TabId>("where");
  const [selected, setSelected] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useDocumentTitle(a?.name ?? "Result");
  // a new tab starts at its top (the panel scrolls on its own on wide screens)
  useEffect(() => {
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [tab]);

  // deep link from the review page: /results/:id?square=C013-008
  useEffect(() => {
    const sq = params.get("square");
    if (sq && /^C\d{3}-\d{3}$/.test(sq)) {
      setSelected(sq);
      setTab("where");
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  if (q.isLoading) return <div className="page"><Loading label="Loading the result" /></div>;
  if (q.isError || !a) {
    const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 400);
    return (
      <div className="page page-narrow">
        {notFound
          ? <Empty title="This result doesn't exist" action={<Link to="/results" className="btn">See all results</Link>}>It may have been deleted, or the link is wrong.</Empty>
          : <ErrorState error={q.error} onRetry={() => q.refetch()} title="The result couldn't be loaded" />}
      </div>
    );
  }
  const reviewCount = (a.counts.alerts_pending ?? 0) + (a.counts.reviews_open ?? 0);
  const urgent = (a.summary?.distribution?.Critical ?? 0) + (a.summary?.distribution?.High ?? 0);
  const selectCell = (cid: string | null) => {
    setSelected(cid);
    if (cid) setTab("where");
  };

  return (
    <div className="page page-wide page-enter">
      <Link to="/results" className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", marginBottom: 16 }}>
        <ArrowLeft size={16} aria-hidden /> All results
      </Link>
      <Header a={a} active={active} done={done} />
      {a.mode === "synthetic" && (
        <div style={{ marginTop: 20 }}>
          <Callout tone="practice" title="Practice run with made-up data">
            Nothing here describes a real place or event. The scene is placed at 0° N 0° E in the open ocean, and its warnings can never be sent.
          </Callout>
        </div>
      )}

      {active && <RunProgress a={a} trace={trace.data} />}
      {!active && !done && <Problem a={a} trace={trace.data} traceLoading={trace.isLoading} />}

      {done && (
        <>
          <Answer a={a} trace={trace.data} onReview={() => setTab("review")} reviewCount={reviewCount} />
          <div className="workspace" id="workspace">
            <div className="map-frame map-card">
              {layers.isError && <div style={{ padding: 16 }}><ErrorState error={layers.error} onRetry={() => layers.refetch()} /></div>}
              <Suspense fallback={<div style={{ display: "grid", placeItems: "center", height: "100%" }}><Loading label="Loading the map" /></div>}>
                <AnalysisMap aoi={a.aoi} bbox={a.bbox} hazard={a.hazard} layers={layers.data ?? []} detections={det.data} cells={cells.data}
                  facilities={fac.data} selectedCell={selected} onSelectCell={selectCell} />
              </Suspense>
            </div>
            <section className="panel" aria-label="Details">
              <div className="panel-tabs">
                <Tabs<TabId> label="Details" variant="grid" idBase="rt" value={tab} onChange={setTab} tabs={[
                  { id: "where", label: "Where to help first", icon: <ListOrdered size={17} aria-hidden />, badge: urgent || undefined },
                  { id: "people", label: "People & places", icon: <Users size={17} aria-hidden /> },
                  { id: "how", label: "How we know", icon: <ScanSearch size={17} aria-hidden /> },
                  { id: "review", label: "Needs your OK", icon: <ClipboardCheck size={17} aria-hidden />, badge: reviewCount || undefined },
                ]} />
              </div>
              <div className="panel-body" id="rt-panel" role="tabpanel" aria-labelledby={`rt-tab-${tab}`} ref={panelRef}>
                {tab === "where" && <PrioritiesPanel a={a} cells={cells.data?.features.map((f) => f.properties) ?? []} loading={cells.isLoading} selected={selected} onSelect={selectCell} />}
                {tab === "people" && <PeoplePanel a={a} facilities={fac.data} />}
                {tab === "how" && <EvidencePanel a={a} trace={trace.data} traceLoading={trace.isLoading} />}
                {tab === "review" && <ReviewPanel a={a} onOpenMap={(cell) => { if (cell) selectCell(cell); document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }); }} />}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================ header + actions
function Header({ a, active, done }: { a: AnalysisDetail; active: boolean; done: boolean }) {
  const action = useAnalysisAction();
  const toast = useToast();
  const nav = useNavigate();
  const [confirmStop, setConfirmStop] = useState(false);
  const doAction = async (act: "cancel" | "rerun") => {
    try {
      const r = await action.mutateAsync({ id: a.id, action: act });
      if (act === "rerun") {
        toast("ok", "A fresh copy of this check has started.");
        nav(`/results/${r.id}`);
      } else {
        toast("ok", "Stopping… it will finish its current step first.");
      }
    } catch (e) {
      toast("error", friendlyError(e));
    }
  };
  return (
    <header className="result-head">
      <div style={{ minWidth: 0, maxWidth: 900 }}>
        <div className="row-wrap" style={{ marginBottom: 12, gap: 8 }}>
          <HazardChip hazard={a.hazard} /><StatusChip status={a.status} />{a.mode === "synthetic" && <PracticeChip />}
        </div>
        <h1>{a.name}</h1>
        <div className="result-meta">
          <span><CalendarDays size={16} aria-hidden /> Happened {fmtDate(a.event_date)}</span>
          <span><Ruler size={16} aria-hidden /> Area checked: {fmtArea(a.area_km2)}</span>
          <span>Photos: before {fmtDate(a.pre_window[0], { day: "numeric", month: "short" })} - {fmtDate(a.pre_window[1])}, after {fmtDate(a.post_window[0], { day: "numeric", month: "short" })} - {fmtDate(a.post_window[1])}</span>
          <span>Run {timeAgo(a.created_at)} by {a.created_by}</span>
        </div>
      </div>
      <div className="row-wrap" style={{ gap: 10 }}>
        {active && <button className="btn btn-danger" onClick={() => setConfirmStop(true)}><Square size={16} aria-hidden /> Stop</button>}
        {!active && <button className="btn" onClick={() => doAction("rerun")} disabled={action.isPending}><RefreshCcw size={16} aria-hidden /> Run again</button>}
        {done && <Downloads a={a} />}
      </div>
      <Modal title="Stop this check?" open={confirmStop} onClose={() => setConfirmStop(false)} footer={<>
        <button className="btn" onClick={() => setConfirmStop(false)}>Keep it running</button>
        <button className="btn btn-danger" onClick={() => { setConfirmStop(false); doAction("cancel"); }}>Stop it</button></>}>
        <p className="ink-2">It will stop after its current step. Nothing found so far is kept, but you can run it again at any time.</p>
      </Modal>
    </header>
  );
}

function Downloads({ a }: { a: AnalysisDetail }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const items: [string, string, string, ReactNode][] = [
    [`/api/analyses/${a.id}/reports/pdf`, "Report (PDF)", "A printable report with the map, numbers and reasons.", <FileText size={20} aria-hidden key="p" />],
    [`/api/analyses/${a.id}/reports/csv`, "Priority list (spreadsheet)", "Every square with its score - opens in Excel or Sheets.", <FileSpreadsheet size={20} aria-hidden key="c" />],
    [`/api/analyses/${a.id}/reports/geojson`, "Map data (GeoJSON)", "For mapping software such as QGIS or ArcGIS.", <MapIcon size={20} aria-hidden key="g" />],
    [`/api/analyses/${a.id}/exports/products.tif`, "Raster data (GeoTIFF)", "Likelihood, found area and uncertainty, pixel by pixel.", <MapIcon size={20} aria-hidden key="t" />],
  ];
  return (
    <div className="dropdown" ref={ref}>
      <button className="btn btn-primary" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <Download size={16} aria-hidden /> Download <ChevronDown size={16} aria-hidden />
      </button>
      {open && (
        <div className="dropdown-menu" role="menu">
          {items.map(([href, title, sub, icon]) => (
            <a key={href} role="menuitem" href={apiUrl(href)} onClick={() => setOpen(false)}>
              <span style={{ color: "var(--accent)", marginTop: 2 }}>{icon}</span>
              <span><strong className="small">{title}</strong><small>{sub}</small></span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================ the answer
function Answer({ a, trace, onReview, reviewCount }: { a: AnalysisDetail; trace?: Trace; onReview: () => void; reviewCount: number }) {
  const hl = headline(a);
  const s = a.summary;
  const h = HAZARDS[a.hazard];
  const notes = (trace?.guardrails ?? []).filter((g) => g.outcome === "warn" || g.outcome === "escalate");
  const uniq = [...new Map(notes.map((g) => [g.code, g])).values()];
  if (!hl || !s) return null;
  const frac = a.results?.hazard?.quality?.affected_fraction_of_aoi;
  const top = topCategory(s.distribution);
  const marked = (text: string): ReactNode[] => {
    let parts: ReactNode[] = [text];
    hl.marks.forEach((m, mi) => {
      const next: ReactNode[] = [];
      for (const p of parts) {
        if (typeof p !== "string") { next.push(p); continue; }
        const seg = p.split(m);
        seg.forEach((x, i) => { next.push(x); if (i < seg.length - 1) next.push(<mark key={`${mi}-${i}`}>{m}</mark>); });
      }
      parts = next;
    });
    return parts;
  };
  return (
    <section className="answer" aria-labelledby="answer-title">
      <div className="card answer-text">
        <div className="eyebrow" id="answer-title">The short answer</div>
        <p className="summary-sentence" style={{ marginTop: 12 }}>{marked(hl.sentence)}</p>
        <ul className="reason-list" style={{ marginTop: 16 }}>
          {hl.detail.map((t) => <li key={t}><Check size={16} aria-hidden style={{ color: "var(--accent)" }} /><span>{t}</span></li>)}
        </ul>
        <ConfidenceMeter level={a.confidence} />
        {reviewCount > 0 && (
          <div style={{ marginTop: 16 }}>
            <Callout tone="warn" title={`A person should look at ${reviewCount} item${reviewCount === 1 ? "" : "s"} first`}>
              <span>AegisEO wasn't sure about some things, or has draft warnings waiting. <button className="linklike" onClick={() => { onReview(); document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Review them now</button></span>
            </Callout>
          </div>
        )}
        {uniq.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <Disclosure summary={`Things to keep in mind (${uniq.length})`}>
              <ul className="small ink-2">{uniq.map((g) => <li key={g.code}><strong>{CHECKS[g.code]?.title ?? g.name}.</strong> {CHECKS[g.code]?.why ?? g.message}</li>)}</ul>
            </Disclosure>
          </div>
        )}
      </div>
      <div className="stack" style={{ gap: 16 }}>
      <div className="answer-facts" role="list" aria-label="Key numbers">
        <Fact icon={h.icon(16)} label={`Area ${h.found}`} value={hl.nothingFound ? "None" : fmtArea(s.affected_area_km2)}
          sub={hl.nothingFound ? "nothing was found" : frac != null ? `${frac < 0.01 ? "under 1" : Math.round(frac * 100)}% of the area checked` : areaPicture(s.affected_area_km2) ?? ""} />
        <Fact icon={<Users size={16} aria-hidden />} label="People living there" value={s.population_exposed == null ? "Unknown" : fmtInt(s.population_exposed)}
          sub={s.population_exposed == null ? "no population data here" : "an estimate - not people hurt"} />
        <Fact icon={<Building2 size={16} aria-hidden />} label="Important places" value={s.facilities_inside == null ? "Unknown" : `${s.facilities_inside} inside`}
          sub={s.facilities_inside == null ? "map data unavailable" : `${s.facilities_near ?? 0} more within 500 m`} />
        <Fact icon={<ListOrdered size={16} aria-hidden />} label="Where to look first"
          value={top ? `${fmtInt(s.distribution?.[top])} ${top}` : "No squares"} sub={top ? PRIORITY[top].short.toLowerCase() : "nothing to rank"} />
      </div>
      <div className="card card-pad">
        <h4 style={{ fontSize: "1.125rem" }}>What you can do next</h4>
        <ol className="small ink-2" style={{ marginTop: 10, paddingLeft: 20 }}>
          <li><button className="linklike" onClick={() => document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Look at the map</button>: coloured squares show where to look first. Press <em>Compare before / after</em> to see the change yourself.</li>
          {reviewCount > 0 && <li><button className="linklike" onClick={() => { onReview(); document.getElementById("workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Answer the {reviewCount} waiting item{reviewCount === 1 ? "" : "s"}</button> - they need a person's OK.</li>}
          <li><a href={apiUrl(`/api/analyses/${a.id}/reports/pdf`)}>Download the report (PDF)</a> to share it or print it.</li>
        </ol>
      </div>
      </div>
    </section>
  );
}

function Fact({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub: string }) {
  return (
    <div className="fact" role="listitem">
      <span className="fact-label">{icon}{label}</span>
      <span className="fact-value">{value}</span>
      <span className="fact-sub">{sub}</span>
    </div>
  );
}

// ============================================================================ while running
function RunProgress({ a, trace }: { a: AnalysisDetail; trace?: Trace }) {
  const idx = runStageIndex(a.stage, a.progress);
  const pct = Math.max(4, Math.round(a.progress * 100));
  return (
    <section className="card run-card" style={{ marginTop: 24 }} aria-live="polite" aria-busy="true">
      <div className="row between" style={{ gap: 16, flexWrap: "wrap" }}>
        <div>
          <h2>{a.status === "queued" ? "Waiting to start…" : "AegisEO is working on it"}</h2>
          <p className="ink-2" style={{ marginTop: 6 }}>{RUN_STAGES[idx].text}</p>
        </div>
        <span className="fact-value" style={{ fontFamily: "var(--font-display)", fontSize: "2.5rem" }}>{pct}%</span>
      </div>
      <div className="progress" style={{ marginTop: 20 }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress"><div style={{ width: `${pct}%` }} /></div>
      <ol className="run-stages">
        {RUN_STAGES.map((s, i) => {
          const Icon = STAGE_ICONS[i];
          const state = i < idx ? "done" : i === idx ? "current" : "pending";
          return (
            <li key={s.key} className={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="rs-icon">{state === "done" ? <Check size={18} aria-hidden /> : <Icon size={18} aria-hidden />}</span>
              <div><strong>{s.title}</strong><span>{state === "done" ? "Done" : state === "current" ? "In progress…" : s.text}</span></div>
            </li>
          );
        })}
      </ol>
      <p className="small muted" style={{ marginTop: 12 }}>
        {a.mode === "synthetic" ? "Practice runs usually take under a minute." : "This usually takes 2 to 6 minutes."} You can leave this page - the check keeps running and you'll find it under Results.
      </p>
      {trace && trace.steps.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Disclosure summary="Show the technical log">
            <ul className="small ink-2" style={{ listStyle: "none", padding: 0 }}>
              {trace.steps.slice(-8).reverse().map((s) => <li key={s.seq}><strong>{s.title}</strong>{s.detail ? <span className="muted"> - {s.detail.slice(0, 160)}</span> : null}</li>)}
            </ul>
          </Disclosure>
        </div>
      )}
    </section>
  );
}

// ============================================================================ didn't finish
const TIPS: Record<string, string[]> = {
  insufficient_data: [
    "Make the 'after' search longer - radar satellites pass every 6 to 12 days.",
    "Check that the date is right: the 'after' photos must be taken after the event.",
    "Wildfires and landslides need a clear photo before and after; try a longer 'before' search.",
  ],
  rejected: ["Some choices weren't valid. Start a new check and adjust the area or dates."],
  failed: ["Run it again - short outages of the data services are common and usually pass.", "If it keeps failing, look at 'Where the data comes from' to see which service is down."],
  cancelled: ["Run it again whenever you like."],
  interrupted: ["The server restarted while this was running. Run it again."],
};

function Problem({ a, trace, traceLoading }: { a: AnalysisDetail; trace?: Trace; traceLoading: boolean }) {
  const st = STATUS[a.status];
  const action = useAnalysisAction();
  const nav = useNavigate();
  const toast = useToast();
  const rerun = async () => {
    try {
      const r = await action.mutateAsync({ id: a.id, action: "rerun" });
      nav(`/results/${r.id}`);
    } catch (e) {
      toast("error", friendlyError(e));
    }
  };
  return (
    <section className="card card-pad-lg" style={{ marginTop: 24 }} role="alert">
      <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
        <span className="hz-dot" style={{ width: 52, height: 52, background: "var(--warn-bg)", color: "var(--warn)" }}><CircleSlash size={26} aria-hidden /></span>
        <div className="grow">
          <h2>{st.label}</h2>
          <p className="ink-2" style={{ marginTop: 6 }}>{st.help}</p>
          {(TIPS[a.status] ?? []).length > 0 && (
            <>
              <h4 style={{ marginTop: 20 }}>What you can try</h4>
              <ul className="ink-2" style={{ marginTop: 8 }}>{TIPS[a.status].map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
          <div className="row-wrap" style={{ marginTop: 20, gap: 10 }}>
            {a.mode === "real" && <Link to={`/check?from=${a.id}`} className="btn btn-primary">Try different dates</Link>}
            <button className="btn" onClick={rerun} disabled={action.isPending}><RefreshCcw size={16} aria-hidden /> Run it again as it is</button>
          </div>
          {(a.error || a.message) && (
            <div style={{ marginTop: 16 }}>
              <Disclosure summary="Technical detail"><p className="small ink-2"><code>{a.error ?? a.message}</code></p></Disclosure>
              <Disclosure summary="Full step-by-step record (for specialists)"><TraceView trace={trace} loading={traceLoading} /></Disclosure>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================================ review tab
function ReviewPanel({ a, onOpenMap }: { a: AnalysisDetail; onOpenMap: (cell: string | null) => void }) {
  const alerts = useAlerts(undefined, a.id);
  const reviews = useReviews("open");
  const open = useMemo(() => (reviews.data?.items ?? []).filter((t) => t.analysis_id === a.id), [reviews.data, a.id]);
  const waiting = (alerts.data?.items ?? []).filter((x) => x.status === "pending_review");
  const decided = (alerts.data?.items ?? []).filter((x) => x.status !== "pending_review");
  return (
    <div className="stack-lg">
      <p className="small ink-2">AegisEO doesn't act on its own. Unsure findings and draft warnings wait here until a person decides.</p>
      <div>
        <h3 style={{ fontSize: "1.25rem", marginBottom: 12 }}>Findings to double-check ({open.length})</h3>
        {reviews.isLoading && <Loading />}
        {reviews.data && open.length === 0 && <p className="small muted">Nothing to double-check for this result.</p>}
        {open.map((t) => <ReviewCard key={t.id} task={t} showAnalysis={false} onOpenMap={onOpenMap} defaultOpen />)}
      </div>
      <div>
        <h3 style={{ fontSize: "1.25rem", marginBottom: 12 }}>Draft warnings ({waiting.length} waiting)</h3>
        {alerts.isLoading && <Loading />}
        {alerts.data && waiting.length === 0 && <p className="small muted">No warnings are waiting for this result.</p>}
        {waiting.map((x) => <AlertCard key={x.id} alert={x} showAnalysis={false} defaultOpen={waiting.length <= 3} />)}
        {decided.length > 0 && (
          <Disclosure summary={`Already decided (${decided.length})`}>{decided.map((x) => <AlertCard key={x.id} alert={x} showAnalysis={false} />)}</Disclosure>
        )}
      </div>
    </div>
  );
}

