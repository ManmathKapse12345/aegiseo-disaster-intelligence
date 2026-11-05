import { ArrowLeft, ArrowRight, Check, Compass, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useCreateAnalysis, useLiveEvents, useScenarios } from "@/api/hooks";
import type { AnalysisDetail, CreateAnalysis, Hazard } from "@/api/types";
import { useToast } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { store, useDocumentTitle } from "@/lib/hooks";
import { HAZARDS } from "@/lib/meta";
import { friendlyError } from "@/lib/plain";
import { DEFAULT_EXPERT, DRAFT_KEY, type Draft, type Source, EVENT_HALF_DEG, areaKm2, displayName, emptyDraft, reducer, stepStatus } from "./draft";
import { StepStart } from "./StepStart";
import { StepWhat, StepWhen } from "./StepWhatWhen";
import { StepWhere } from "./StepWhere";

const STEPS = [
  { short: "Where", title: "Where should AegisEO look?", sub: "Choose a past disaster, one happening now, or any place on the map." },
  { short: "What", title: "What happened there?", sub: "Choose the kind of disaster. Each one is found in a different way." },
  { short: "When", title: "When did it happen?", sub: "AegisEO compares photos from just before with photos from just after this date." },
  { short: "Start", title: "Ready to start", sub: "Check the summary, then press Start. You can still go back and change anything." },
] as const;

export function CheckWizard() {
  useDocumentTitle("Check a place");
  const [params, setParams] = useSearchParams();
  const scenarios = useScenarios();
  const events = useLiveEvents();
  const create = useCreateAnalysis();
  const toast = useToast();
  const nav = useNavigate();
  const [d, dispatch] = useReducer(reducer, undefined, () => {
    const saved = store.get<Draft>(DRAFT_KEY, "session");
    if (!saved || typeof saved !== "object" || !("windows" in saved)) return emptyDraft();
    const base = emptyDraft();
    return { ...base, ...saved, expert: { ...DEFAULT_EXPERT, ...(saved.expert ?? {}), weights: { ...DEFAULT_EXPERT.weights, ...(saved.expert?.weights ?? {}) } } };
  });
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const pending = useRef(true);

  useEffect(() => store.set(DRAFT_KEY, d, "session"), [d]);

  // ------------------------------------------------------------------ prefill from links (?scenario= ?start= ?event= ?lat=&lon= ?from=)
  useEffect(() => {
    if (!pending.current || !params.toString()) return;
    const sid = params.get("scenario");
    const start = params.get("start") as Source | null;
    const eid = params.get("event");
    const from = params.get("from");
    const done = () => {
      pending.current = false;
      setParams({}, { replace: true });
    };
    if (sid) {
      if (!scenarios.data) return;
      const s = scenarios.data.find((x) => x.id === sid);
      if (s) {
        dispatch({ type: "reset", source: "past" });
        dispatch({ type: "scenario", s });
        go(s.mode === "synthetic" ? 3 : 0, "fwd");
      }
      return done();
    }
    if (eid) {
      if (!events.data) return;
      const e = events.data.events.find((x) => x.id === eid);
      dispatch({ type: "reset", source: "live" });
      if (e) dispatch({ type: "liveEvent", e });
      return done();
    }
    if (from && /^[0-9a-f]{32}$/.test(from)) {
      api<AnalysisDetail>(`/api/analyses/${from}`).then((a) => {
        dispatch({ type: "reset", source: "map" });
        dispatch({ type: "prefill", patch: {
          bbox: a.bbox, hazard: a.hazard, suggestedHazard: null, event: a.event_date, windows: { pre: a.pre_window, post: a.post_window },
          customDates: true, name: `${a.name.replace(/ \(re-run\)$/, "")} (new dates)`.slice(0, 120), nameTouched: true, synthetic: false,
          scenarioId: null,
        } });
        go(2, "fwd");
      }).catch((e) => toast("error", friendlyError(e)));
      return done();
    }
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (params.has("lat") && Number.isFinite(lat) && Number.isFinite(lon)) {
      // older links: /analyze?lat=&lon=&hazard=&date=&name=
      dispatch({ type: "reset", source: "map" });
      const k = EVENT_HALF_DEG;
      const hz = params.get("hazard") as Hazard | null;
      const date = params.get("date");
      dispatch({ type: "prefill", patch: {
        bbox: [+(lon - k).toFixed(4), +(lat - k).toFixed(4), +(lon + k).toFixed(4), +(lat + k).toFixed(4)],
        place: params.get("name"), hazard: hz && hz in HAZARDS ? hz : null, suggestedHazard: hz && hz in HAZARDS ? hz : null,
      } });
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) dispatch({ type: "date", event: date });
      return done();
    }
    if (start && ["past", "live", "map"].includes(start)) {
      dispatch({ type: "reset", source: start });
      setStep(0);
    }
    done();
  }, [params, scenarios.data, events.data]); // eslint-disable-line react-hooks/exhaustive-deps

  function go(next: number, direction: "fwd" | "back") {
    setDir(direction);
    setStep(next);
    requestAnimationFrame(() => {
      titleRef.current?.focus({ preventScroll: true });
      titleRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  const status = stepStatus(d, step);
  // practice scenes have a fixed disaster type and dates, so those two steps are skipped
  const next = () => go(step === 0 && d.synthetic ? 3 : step + 1, "fwd");
  const back = () => go(step === 3 && d.synthetic ? 0 : Math.max(0, step - 1), "back");
  const reachable = (i: number) => [0, 1, 2].slice(0, i).every((k) => stepStatus(d, k).ok);

  const start = async () => {
    if (!d.hazard) return;
    const body: CreateAnalysis = {
      name: displayName(d).trim(), hazard: d.hazard, mode: d.synthetic ? "synthetic" : "real", event_date: d.event, scenario_id: d.scenarioId ?? undefined,
      ...(d.synthetic ? {} : { bbox: d.bbox!, pre_window: d.windows.pre, post_window: d.windows.post }),
      // only the settings that the chosen detection method actually uses (backend/aegis/analysis/hazards.py)
      ...(d.expert.touched && !d.synthetic ? {
        resolution_m: d.expert.resolution, weights: d.expert.weights,
        detection: {
          min_mapping_unit_ha: d.expert.mmu,
          ...(d.hazard === "flood" ? { prob_threshold: d.expert.threshold, mc_samples: d.expert.mc } : {}),
          ...(d.hazard === "wildfire" ? { dnbr_threshold: d.expert.dnbr } : {}),
        },
      } : {}),
    };
    try {
      const a = await create.mutateAsync(body);
      store.remove(DRAFT_KEY, "session");
      toast("ok", "Started! AegisEO is now looking for satellite photos.");
      nav(`/results/${a.id}`);
    } catch (e) {
      toast("error", friendlyError(e));
    }
  };

  const S = STEPS[step];
  return (
    <div className="page page-enter">
      <div className="wizard">
        <div className="wizard-main">
          <ProgressSteps step={step} reachable={reachable} onGo={(i) => go(i, i < step ? "back" : "fwd")} />
          <div key={step} className={`step-anim ${dir === "back" ? "back" : ""}`}>
            <div className="eyebrow">Step {step + 1} of 4</div>
            <h1 className="step-title" ref={titleRef} tabIndex={-1} style={{ marginTop: 8, outline: "none" }}>{S.title}</h1>
            <p className="step-sub">{S.sub}</p>
            <div className="step-body">
              {step === 0 && <StepWhere d={d} dispatch={dispatch} scenarios={scenarios} events={events} onContinue={next} canContinue={status.ok} />}
              {step === 1 && <StepWhat d={d} dispatch={dispatch} />}
              {step === 2 && <StepWhen d={d} dispatch={dispatch} />}
              {step === 3 && <StepStart d={d} dispatch={dispatch} />}
            </div>
          </div>
          <div className="wizard-nav">
            <button className="btn" onClick={back} disabled={step === 0}><ArrowLeft size={18} aria-hidden /> Back</button>
            <span className="status" id="wiz-why" aria-live="polite">{status.ok ? (step < 3 ? "Looks good." : "") : status.why}</span>
            {step < 3 ? (
              <button className="btn btn-primary" onClick={next} disabled={!status.ok} aria-describedby="wiz-why">
                Continue <ArrowRight size={18} className="arrow" aria-hidden />
              </button>
            ) : (
              <button className="btn btn-accent btn-lg" onClick={start} disabled={!status.ok || create.isPending}>
                {create.isPending ? <span className="spinner" style={{ borderColor: "rgba(255,255,255,.4)", borderTopColor: "#fff" }} aria-hidden /> : <Play size={18} aria-hidden />}
                {create.isPending ? "Starting…" : "Start the check"}
              </button>
            )}
          </div>
        </div>
        <Guide step={step} d={d} onGo={(i) => { if (i < step || reachable(i)) go(i, i < step ? "back" : "fwd"); }} onReset={() => { dispatch({ type: "reset", source: d.source }); go(0, "back"); }} />
      </div>
    </div>
  );
}

function ProgressSteps({ step, reachable, onGo }: { step: number; reachable: (i: number) => boolean; onGo: (i: number) => void }) {
  return (
    <ol className="progress-steps" aria-label="Progress">
      {STEPS.map((s, i) => (
        <li key={s.short} className={i < step ? "done" : i === step ? "current" : ""}>
          <button onClick={() => onGo(i)} disabled={i === step || !reachable(i)} aria-current={i === step ? "step" : undefined}
            aria-label={`Step ${i + 1}: ${s.short}${i < step ? " (done)" : ""}`}>
            <span className="ps-dot">{i < step ? <Check size={16} aria-hidden /> : i + 1}</span>
            <span className="ps-label">{s.short}</span>
          </button>
          {i < STEPS.length - 1 && <span className="ps-bar" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

const GUIDE: { todo: ReactNode; know: ReactNode; next: string }[] = [
  {
    todo: <>Pick <strong>one</strong> of the three ways to choose a place. Not sure? Choose <strong>A past disaster</strong> - everything is filled in for you.</>,
    know: <>Smaller areas are faster. Up to 1,500 km² can be checked - about a square 39 km on each side.</>,
    next: "You'll choose what kind of disaster to look for.",
  },
  {
    todo: <>Choose <strong>Flood</strong>, <strong>Wildfire</strong> or <strong>Landslide</strong>. Each card says what AegisEO looks for.</>,
    know: <>If you picked a past disaster or a live alert, the right type is already chosen.</>,
    next: "You'll check the date it happened.",
  },
  {
    todo: <>Enter the day it happened. The search dates for the photos are filled in for you.</>,
    know: <>Satellites pass over every few days, and clouds can block the camera ones. Radar sees through clouds.</>,
    next: "You'll see a summary and start the check.",
  },
  {
    todo: <>Read the summary. If something is wrong, use <strong>Back</strong> or the steps at the top. Then press <strong>Start the check</strong>.</>,
    know: <>Nothing is sent to anyone automatically. If AegisEO is unsure, it will ask a person to check.</>,
    next: "You'll watch the progress, then see the results on a map.",
  },
];

function Guide({ step, d, onGo, onReset }: { step: number; d: Draft; onGo: (i: number) => void; onReset: () => void }) {
  const g = GUIDE[step];
  const km2 = areaKm2(d);
  const choices = useMemo(() => [
    { i: 0, label: "Place", value: d.synthetic ? "Practice scene (made-up)" : d.bbox ? `${d.place?.split(",").slice(0, 2).join(",") || "Area on the map"}${km2 != null ? ` · ${km2 < 10 ? km2.toFixed(1) : Math.round(km2)} km²` : ""}` : null },
    { i: 1, label: "Disaster", value: d.hazard ? HAZARDS[d.hazard].label : null },
    { i: 2, label: "Date", value: d.synthetic ? "Fixed for practice" : step >= 2 || d.scenarioId || d.eventId || d.customDates ? fmtDate(d.event) : null },
  ], [d, km2, step]);
  return (
    <aside className="guide" aria-label="Guide">
      <div className="guide-head">
        <span className="guide-avatar"><Compass size={20} aria-hidden /></span>
        <div>
          <div className="caption muted">Your guide · step {step + 1} of 4</div>
          <h4>{["Choosing the place", "Choosing the disaster", "Choosing the date", "Almost done"][step]}</h4>
        </div>
      </div>
      <div className="guide-section"><h5>What to do</h5><p>{g.todo}</p></div>
      <div className="guide-section"><h5>Good to know</h5><p>{g.know}</p></div>
      <div className="guide-section">
        <h5>Your choices so far</h5>
        <dl className="stack" style={{ gap: 8, margin: "8px 0 0" }}>
          {choices.map((c) => (
            <div key={c.label} className="row between" style={{ gap: 12, alignItems: "baseline" }}>
              <dt className="caption muted" style={{ minWidth: 64 }}>{c.label}</dt>
              <dd className="small grow" style={{ margin: 0, fontWeight: 600, color: c.value ? "var(--ink)" : "var(--ink-3)" }}>{c.value ?? "not chosen yet"}</dd>
              {c.value && step !== c.i && <button className="linklike small" onClick={() => onGo(c.i)}>Change</button>}
            </div>
          ))}
        </dl>
        {(d.bbox || d.scenarioId) && <button className="linklike caption" style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6 }} onClick={onReset}><RotateCcw size={13} aria-hidden /> Start over</button>}
      </div>
      <div className="guide-section guide-next"><ArrowRight size={18} aria-hidden style={{ flex: "none", marginTop: 3, color: "var(--accent)" }} /><p><strong>Next:</strong> {g.next}</p></div>
    </aside>
  );
}
