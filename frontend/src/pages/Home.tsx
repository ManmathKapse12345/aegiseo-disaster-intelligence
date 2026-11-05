import { ArrowRight, ClipboardCheck, Clock3, FlaskConical, Globe2, History, MapPinned, ShieldCheck, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import credits from "@/data/explainer-images.json";
import { useAnalyses, useDashboard, useLiveEvents } from "@/api/hooks";
import type { AnalysisBrief, LiveEvent } from "@/api/types";
import { ExplainerStrip } from "@/components/ExplainerStrip";
import { Contours } from "@/components/illustrations";
import { EVENT_NAME, HAZARD_COLOR, SUPPORTED_EVENT } from "@/lib/events";
import { PracticeChip, StatusChip } from "@/components/ui";
import { fmtDate, timeAgo } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { FINISHED, HAZARDS } from "@/lib/meta";
import { oneLiner } from "@/lib/plain";

const C = (credits as Record<string, { before_date?: string; after_date?: string; credit: string }>)["explain-sindh-2022"];
const CASE_ORDER = ["pakistan-sindh-2022", "emilia-romagna-2023", "palisades-fire-2025", "wayanad-2024", "derna-2023"];

/** The best finished real-data example to open without waiting: a case study, Sindh first. */
export function pickExample(items: AnalysisBrief[] | undefined): AnalysisBrief | null {
  const done = (items ?? []).filter((a) => a.mode === "real" && FINISHED.has(a.status) && a.scenario_id && (a.summary?.affected_area_km2 ?? 0) > 0);
  for (const id of CASE_ORDER) {
    const hit = done.find((a) => a.scenario_id === id);
    if (hit) return hit;
  }
  return null;
}

export function Home() {
  useDocumentTitle("See where a disaster hit");
  const dash = useDashboard();
  const analyses = useAnalyses();
  const events = useLiveEvents();
  const example = useMemo(() => pickExample(analyses.data?.items), [analyses.data]);
  const waitingTasks = dash.data?.review.open_tasks ?? 0;
  const waitingAlerts = dash.data?.review.alerts_pending ?? 0;
  const recent = (analyses.data?.items ?? []).filter((a) => FINISHED.has(a.status)).slice(0, 4);
  const now = useMemo(() => (events.data?.events ?? [])
    .filter((e) => SUPPORTED_EVENT[e.hazard])
    .sort((a, b) => ({ Red: 0, Orange: 1, Green: 2 }[a.alert_level ?? ""] ?? 3) - ({ Red: 0, Orange: 1, Green: 2 }[b.alert_level ?? ""] ?? 3))
    .slice(0, 5), [events.data]);

  return (
    <div className="page page-enter" style={{ position: "relative" }}>
      <Contours />
      {/* ------------------------------------------------------------ hero */}
      <section className="hero" aria-labelledby="hero-title">
        <div>
          <div className="eyebrow rise"><Sparkles size={16} aria-hidden /> Disaster maps from satellite photos</div>
          <h1 id="hero-title" className="rise rise-1" style={{ marginTop: 16 }}>
            See where a disaster hit - and <em>where help is needed first.</em>
          </h1>
          <p className="lead rise rise-2">
            AegisEO compares satellite photos from before and after a flood, wildfire or landslide. It shows what changed,
            who lives there, and which places to check first. A person always makes the final call.
          </p>
          <div className="hero-actions rise rise-3">
            <Link to="/check" className="btn btn-primary btn-lg">Check a place <ArrowRight size={18} className="arrow" aria-hidden /></Link>
            {example ? (
              <Link to={`/results/${example.id}`} className="btn btn-lg">See a finished example</Link>
            ) : (
              <Link to="/check?scenario=synthetic-flood" className="btn btn-lg"><FlaskConical size={18} aria-hidden /> Try a practice run</Link>
            )}
          </div>
          <p className="hero-note rise rise-4"><Clock3 size={15} aria-hidden /> Free satellite data · nothing to install · results in a few minutes</p>
        </div>
        <div className="hero-visual rise rise-2">
          <figure className="scan-figure auto" style={{ margin: 0 }} aria-label="The same place before and after the 2022 Sindh floods. The after photo slides over the before photo.">
            <img src="/images/explain-sindh-2022-before.jpg" alt="Satellite photo before the floods: dry fields around a town." width={720} height={803} />
            <img className="after" src="/images/explain-sindh-2022-after.jpg" alt="Satellite photo after the floods: large areas of water to the east of the town." width={720} height={803} />
            <span className="split-line" aria-hidden />
            <span className="scan-tag left">Before{C?.before_date ? ` · ${fmtDate(C.before_date)}` : ""}</span>
            <span className="scan-tag right">After{C?.after_date ? ` · ${fmtDate(C.after_date)}` : ""}</span>
            <figcaption className="scan-credit">Dadu district, Pakistan, 2022 floods · {C?.credit.split(";")[0] ?? "Contains modified Copernicus Sentinel data 2022"}</figcaption>
          </figure>
        </div>
      </section>

      {/* ------------------------------------------------------------ choices */}
      <section className="section" aria-labelledby="choose-title">
        <div className="section-head">
          <div>
            <h2 id="choose-title">What would you like to do?</h2>
            <p>Pick one. AegisEO will guide you through every step.</p>
          </div>
        </div>
        <div className="choices">
          <Link to="/check?start=map" className="choice-card featured">
            <span className="choice-icon"><MapPinned size={26} aria-hidden /></span>
            <span>
              <h3>Check a place</h3>
              <p>Choose any place on the map and the date something happened. AegisEO looks for damage in satellite photos.</p>
              <span className="expect"><Clock3 size={14} aria-hidden /> 3 quick questions, then results in about 2-6 minutes</span>
            </span>
            <ArrowRight size={22} className="go" aria-hidden />
          </Link>
          <Link to="/check?start=past" className="choice-card">
            <span className="choice-icon"><History size={26} aria-hidden /></span>
            <span>
              <h3>Explore a past disaster</h3>
              <p>Start from a real flood, wildfire or landslide that's already set up - like the 2022 Pakistan floods.</p>
              <span className="expect"><Clock3 size={14} aria-hidden /> Place and dates are filled in for you</span>
            </span>
            <ArrowRight size={22} className="go" aria-hidden />
          </Link>
          <Link to="/check?start=live" className="choice-card">
            <span className="choice-icon"><Globe2 size={26} aria-hidden /></span>
            <span>
              <h3>Look at disasters happening now</h3>
              <p>See current flood, storm and wildfire alerts from around the world, and check one of them.</p>
              <span className="expect"><Clock3 size={14} aria-hidden /> Live alerts from GDACS, updated every few minutes</span>
            </span>
            <ArrowRight size={22} className="go" aria-hidden />
          </Link>
          <Link to="/check?scenario=synthetic-flood" className="choice-card">
            <span className="choice-icon" style={{ background: "var(--practice-bg)", color: "var(--practice)" }}><FlaskConical size={26} aria-hidden /></span>
            <span>
              <h3>Try a practice run</h3>
              <p>See how it works on made-up data. Nothing real is shown and nothing can be sent.</p>
              <span className="expect"><Clock3 size={14} aria-hidden /> Takes under a minute, works offline</span>
            </span>
            <ArrowRight size={22} className="go" aria-hidden />
          </Link>
        </div>
      </section>

      {(waitingTasks > 0 || waitingAlerts > 0) && (
        <section className="section-tight">
          <Link to="/review" className="card card-pad lift row" style={{ textDecoration: "none", color: "var(--ink)", gap: 18, flexWrap: "wrap" }}>
            <span className="choice-icon" style={{ width: 48, height: 48, borderRadius: 14, display: "grid", placeItems: "center", background: "var(--p-high-bg)", color: "var(--p-high-ink)" }}>
              <ClipboardCheck size={24} aria-hidden />
            </span>
            <span className="grow">
              <strong style={{ fontSize: "var(--fs-lg)" }}>A person needs to look at {waitingTasks + waitingAlerts} item{waitingTasks + waitingAlerts === 1 ? "" : "s"}</strong>
              <span className="small muted" style={{ display: "block" }}>
                {waitingTasks} unsure finding{waitingTasks === 1 ? "" : "s"} to double-check and {waitingAlerts} draft warning{waitingAlerts === 1 ? "" : "s"} waiting for approval.
              </span>
            </span>
            <span className="btn">Review now <ArrowRight size={16} className="arrow" aria-hidden /></span>
          </Link>
        </section>
      )}

      {/* ------------------------------------------------------------ how it works */}
      <section className="section" aria-labelledby="how-title">
        <div className="section-head">
          <div>
            <h2 id="how-title">How it works, in four pictures</h2>
            <p>These are real results from the 2022 floods in Pakistan.</p>
          </div>
          <Link to="/about" className="btn btn-ghost">More about how it works <ArrowRight size={16} className="arrow" aria-hidden /></Link>
        </div>
        <ExplainerStrip />
        <div className="callout neutral" style={{ marginTop: 24 }}>
          <ShieldCheck size={20} aria-hidden />
          <span><strong>A person stays in charge.</strong> When AegisEO is unsure, it asks someone to check. Warnings are only drafts until a person approves them.</span>
        </div>
      </section>

      {/* ------------------------------------------------------------ recent + live */}
      <section className="section grid g-2" style={{ alignItems: "start", gap: "var(--sp-6)" }}>
        <div>
          <div className="section-head" style={{ marginBottom: 12 }}>
            <h3>Recent results</h3>
            <Link to="/results" className="small">See all</Link>
          </div>
          {analyses.isLoading && <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}</div>}
          {!analyses.isLoading && recent.length === 0 && <p className="muted small">No finished checks yet. Start one above - it will appear here.</p>}
          <div className="pulse-list">
            {recent.map((a) => (
              <Link key={a.id} to={`/results/${a.id}`} className="pulse-item">
                <span className="hz-dot" style={{ background: HAZARDS[a.hazard].soft, color: HAZARDS[a.hazard].color }}>{HAZARDS[a.hazard].icon(20)}</span>
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</strong>
                  <span className="caption muted">{oneLiner(a) || HAZARDS[a.hazard].label} · {timeAgo(a.created_at)}</span>
                </span>
                {a.mode === "synthetic" ? <PracticeChip /> : <StatusChip status={a.status} />}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <div className="section-head" style={{ marginBottom: 12 }}>
            <h3>Happening now</h3>
            <Link to="/check?start=live" className="small">See the world map</Link>
          </div>
          {events.isLoading && <div className="stack">{[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64 }} />)}</div>}
          {events.isError && <p className="small muted">Live alerts can't be loaded right now.</p>}
          {events.data && now.length === 0 && <p className="small muted">No current flood, storm or wildfire alerts.</p>}
          <div className="pulse-list">
            {now.map((e) => <LiveRow key={e.id} e={e} />)}
          </div>
          {events.data && <p className="caption muted" style={{ marginTop: 10 }}>From GDACS (European Commission and UN). Fetched {timeAgo(events.data.fetched_at)}.</p>}
        </div>
      </section>
    </div>
  );
}

function LiveRow({ e }: { e: LiveEvent }) {
  const color = HAZARD_COLOR[e.hazard] ?? "#5c677a";
  return (
    <Link to={`/check?start=live&event=${encodeURIComponent(e.id)}`} className="pulse-item">
      <span className="hz-dot" style={{ background: `${color}1a`, color }}>{SUPPORTED_EVENT[e.hazard] ? HAZARDS[SUPPORTED_EVENT[e.hazard]].icon(20) : null}</span>
      <span style={{ minWidth: 0 }}>
        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</strong>
        <span className="caption muted">{EVENT_NAME[e.hazard] ?? e.hazard} · since {fmtDate(e.from || e.time)}</span>
      </span>
      {e.alert_level && <span className={`chip ${e.alert_level === "Red" ? "danger" : e.alert_level === "Orange" ? "warn" : "ok"}`}>{e.alert_level} alert</span>}
    </Link>
  );
}

