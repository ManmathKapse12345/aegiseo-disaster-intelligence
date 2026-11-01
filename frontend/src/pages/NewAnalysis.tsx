import { ArrowLeft, ArrowRight, CalendarRange, CheckCircle2, CloudSun, FlaskConical, Play, Satellite, Settings2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { errorMessage } from "@/api/client";
import { useCatalogPreview, useCreateAnalysis, useScenarios } from "@/api/hooks";
import type { CreateAnalysis, Hazard, Scenario } from "@/api/types";
import { AoiPicker, bboxAreaKm2, type BBox } from "@/components/map/AoiPicker";
import { Card, ErrorState, InfoTip, Loading, SyntheticChip, useToast } from "@/components/ui";
import { addDays, fmtDate, isoDate } from "@/lib/format";
import { HAZARDS } from "@/lib/meta";

const SCENARIO_IMG: Record<string, string> = {
  "pakistan-sindh-2022": "/images/case-sindh-2022.jpg", "emilia-romagna-2023": "/images/case-emilia-2023.jpg",
  "derna-2023": "/images/case-derna-2023.jpg", "palisades-fire-2025": "/images/case-palisades-2025.jpg",
  "wayanad-2024": "/images/case-wayanad-2024.jpg",
  // simulated scenes (rendered from the synthetic generator, clearly labelled)
  "synthetic-flood": "/images/synthetic-flood.jpg", "synthetic-flood-cloudy": "/images/synthetic-flood-cloudy.jpg",
  "synthetic-wildfire": "/images/synthetic-wildfire.jpg", "synthetic-landslide": "/images/synthetic-landslide.jpg",
};
const MAX_KM2 = 1500;
const today = isoDate(new Date());

function defaultsFor(event: string): { pre: [string, string]; post: [string, string] } {
  const post1 = addDays(event, 12);
  return { pre: [addDays(event, -45), addDays(event, -1)], post: [event, post1 > today ? today : post1] };
}

export function NewAnalysis() {
  const [params] = useSearchParams();
  const scenarios = useScenarios();
  const create = useCreateAnalysis();
  const preview = useCatalogPreview();
  const toast = useToast();
  const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [bbox, setBbox] = useState<BBox | null>(null);
  const [hazard, setHazard] = useState<Hazard>("flood");
  const [name, setName] = useState("");
  const [event, setEvent] = useState(addDays(today, -7));
  const [pre, setPre] = useState<[string, string]>(defaultsFor(addDays(today, -7)).pre);
  const [post, setPost] = useState<[string, string]>(defaultsFor(addDays(today, -7)).post);
  const [advanced, setAdvanced] = useState(false);
  const [resolution, setResolution] = useState(20);
  const [threshold, setThreshold] = useState(0.5);
  const [mc, setMc] = useState(6);
  const [weights, setWeights] = useState({ extent: 0.55, intensity: 0.45, population: 0.45, critical_facilities: 0.35, access: 0.2, hazard_exponent: 0.5 });

  const synthetic = scenario?.mode === "synthetic";

  // prefill from a scenario id or a live event (?lat=&lon=&hazard=&date=&name=)
  useEffect(() => {
    const sid = params.get("scenario");
    if (sid && scenarios.data) {
      const s = scenarios.data.find((x) => x.id === sid);
      if (s) pickScenario(s);
      return;
    }
    const lat = Number(params.get("lat"));
    const lon = Number(params.get("lon"));
    if (params.has("lat") && Number.isFinite(lat) && Number.isFinite(lon)) {
      const d = 0.08;
      setBbox([+(lon - d).toFixed(4), +(lat - d).toFixed(4), +(lon + d).toFixed(4), +(lat + d).toFixed(4)]);
      const hz = params.get("hazard") as Hazard | null;
      if (hz && hz in HAZARDS) setHazard(hz);
      const date = params.get("date");
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today) setEventDate(date);
      setName(params.get("name") ?? "");
    }
  }, [params, scenarios.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEventDate = (d: string) => {
    setEvent(d);
    const def = defaultsFor(d);
    setPre(def.pre);
    setPost(def.post);
  };

  const pickScenario = (s: Scenario) => {
    setScenario(s);
    setBbox(s.bbox);
    setHazard(s.hazard);
    setName(s.title);
    setEvent(s.event_date);
    const def = defaultsFor(s.event_date);
    setPre(s.pre_window ?? def.pre);
    setPost(s.post_window ?? def.post);
  };

  const area = bbox ? bboxAreaKm2(bbox) : null;
  const areaError = !synthetic && area != null && (area > MAX_KM2 || area < 0.25);
  const dateError = useMemo(() => {
    if (synthetic) return null;
    if (event > today) return "The event date cannot be in the future.";
    if (pre[0] > pre[1] || post[0] > post[1]) return "Each window must start before it ends.";
    if (pre[1] > event) return "The pre-event window must end on or before the event date.";
    if (post[1] < event) return "The post-event window must end on or after the event date.";
    return null;
  }, [event, pre, post, synthetic]);

  const canNext = [!!bbox && !areaError, !dateError && name.trim().length >= 3, true][step];

  const submit = async () => {
    const body: CreateAnalysis = {
      name: name.trim(), hazard, mode: synthetic ? "synthetic" : "real", event_date: event, scenario_id: scenario?.id,
      resolution_m: resolution, detection: { prob_threshold: threshold, mc_samples: mc }, weights,
      ...(synthetic ? {} : { bbox: bbox!, pre_window: pre, post_window: post }),
    };
    try {
      const a = await create.mutateAsync(body);
      toast("ok", "Analysis started - the agent is gathering evidence.");
      nav(`/analyses/${a.id}`);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const runPreview = () => bbox && preview.mutate({ bbox, event_date: event, pre_window: pre, post_window: post });

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h1>New analysis</h1>
          <p>Choose an area, a hazard and the event date. The agent finds the satellite data, maps the change, assesses exposure and drafts priorities for your review.</p>
        </div>
        <div className="stepper" aria-label="Progress">
          {["Area", "Hazard & time", "Review & run"].map((s, i) => (
            <div key={s} className="row" style={{ gap: 6 }}>
              {i > 0 && <span className="step-sep" aria-hidden />}
              <span className={`step ${i === step ? "on" : i < step ? "done" : ""}`}><span className="num">{i < step ? <CheckCircle2 size={14} /> : i + 1}</span>{s}</span>
            </div>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.25fr)", gap: 16 }}>
          <Card title="Start from a case study" sub="Real historical events (live archive data) or simulated scenes (offline)">
            {scenarios.isLoading && <Loading />}
            {scenarios.isError && <ErrorState error={scenarios.error} onRetry={() => scenarios.refetch()} />}
            <div className="grid g-2" style={{ gap: 12 }}>
              {scenarios.data?.map((s) => (
                <button key={s.id} className={`card scenario-card ${scenario?.id === s.id ? "selected" : ""}`} onClick={() => pickScenario(s)} aria-pressed={scenario?.id === s.id}>
                  <div className="scenario-img" style={{ backgroundImage: SCENARIO_IMG[s.id] ? `url(${SCENARIO_IMG[s.id]})` : "linear-gradient(135deg, #ede7fe, #e0f2fe)" }}>
                    {s.mode === "synthetic" ? <SyntheticChip /> : <span className="chip" style={{ background: "rgba(255,255,255,.92)" }}>{HAZARDS[s.hazard].icon(13)} {HAZARDS[s.hazard].label}</span>}
                  </div>
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div style={{ fontWeight: 650, fontSize: "var(--fs-sm)" }}>{s.title}</div>
                    <div className="xs muted" style={{ marginTop: 2 }}>{s.region}</div>
                    <div className="xs" style={{ marginTop: 6, color: "var(--ink-2)" }}>{s.why}</div>
                  </div>
                </button>
              ))}
            </div>
          </Card>
          <Card title="Or define your own area" sub={`Draw a rectangle (up to ${MAX_KM2} km²). Smaller areas run faster.`}>
            <AoiPicker value={bbox} onChange={(b) => { setBbox(b); if (scenario) setScenario(null); }} maxKm2={MAX_KM2} />
            {bbox && (
              <div className="row-wrap small muted" style={{ marginTop: 10 }}>
                <span>Bounding box:</span>
                <code>{bbox.map((v) => v.toFixed(4)).join(", ")}</code>
                {synthetic && <SyntheticChip />}
              </div>
            )}
            {scenario && <p className="small" style={{ marginTop: 8 }}>{scenario.summary}</p>}
          </Card>
        </div>
      )}

      {step === 1 && (
        <div className="grid g-2" style={{ gap: 16 }}>
          <Card title="Hazard type" sub="The agent picks a detection method suited to the hazard">
            <div className="stack">
              {(Object.keys(HAZARDS) as Hazard[]).map((h) => (
                <button key={h} className="choice" aria-pressed={hazard === h} onClick={() => setHazard(h)} disabled={synthetic && scenario?.hazard !== h}>
                  <span className="stat" style={{ padding: 0 }}><span className="icon" style={{ color: HAZARDS[h].color, background: "var(--surface-3)" }}>{HAZARDS[h].icon(17)}</span></span>
                  <span>
                    <strong>{HAZARDS[h].label}</strong>
                    <div className="small muted">{HAZARDS[h].blurb}</div>
                    <div className="xs" style={{ marginTop: 4, color: "var(--ink-2)" }}>{HAZARDS[h].method}</div>
                  </span>
                </button>
              ))}
              <p className="xs muted">Earthquake damage and cyclone wind damage cannot be mapped reliably from 10-20 m imagery and are not offered; cyclone-related flooding uses the flood method.</p>
            </div>
          </Card>
          <Card title="Name and observation period" sub={synthetic ? "Simulated scenes have fixed dates" : "Defaults: 45 days before the event, up to 12 days after"}>
            <div className="stack" style={{ gap: 14 }}>
              <div className="field">
                <label htmlFor="name">Analysis name</label>
                <input id="name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sindh flood - Dadu district" />
              </div>
              <div className="field">
                <label htmlFor="event">Event date <InfoTip text="When the disaster happened (or started). Pre-event images are searched before it and post-event images after it." /></label>
                <input id="event" className="input" type="date" max={today} value={event} disabled={synthetic} onChange={(e) => e.target.value && setEventDate(e.target.value)} />
              </div>
              <div className="grid g-2" style={{ gap: 12 }}>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} disabled={synthetic}>
                  <legend className="label" style={{ marginBottom: 6 }}><CalendarRange size={13} aria-hidden /> Pre-event window</legend>
                  <input className="input" type="date" aria-label="Pre-event start" value={pre[0]} onChange={(e) => setPre([e.target.value, pre[1]])} />
                  <input className="input" type="date" aria-label="Pre-event end" value={pre[1]} max={event} onChange={(e) => setPre([pre[0], e.target.value])} />
                </fieldset>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} disabled={synthetic}>
                  <legend className="label" style={{ marginBottom: 6 }}><CalendarRange size={13} aria-hidden /> Post-event window</legend>
                  <input className="input" type="date" aria-label="Post-event start" value={post[0]} min={event} onChange={(e) => setPost([e.target.value, post[1]])} />
                  <input className="input" type="date" aria-label="Post-event end" value={post[1]} max={today} onChange={(e) => setPost([post[0], e.target.value])} />
                </fieldset>
              </div>
              {dateError && <div className="banner danger" role="alert"><TriangleAlert size={16} aria-hidden /> {dateError}</div>}
              <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start", paddingLeft: 0 }} onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
                <Settings2 size={14} aria-hidden /> {advanced ? "Hide" : "Show"} advanced settings
              </button>
              {advanced && (
                <div className="stack" style={{ gap: 10, padding: 12, borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
                  <Slider label="Resolution (m)" min={10} max={60} step={10} value={resolution} onChange={setResolution} tip="Analysis pixel size. 20 m balances detail and speed; large areas are coarsened automatically." />
                  <Slider label="Detection threshold" min={0.3} max={0.8} step={0.05} value={threshold} onChange={setThreshold} tip="Minimum calibrated probability for a pixel to count as affected." />
                  <Slider label="Uncertainty samples" min={1} max={12} step={1} value={mc} onChange={setMc} tip="Monte-Carlo dropout samples used to estimate model uncertainty." />
                  <div className="xs muted" style={{ marginTop: 4 }}>Priority weights (score = 100 x Hazard^a x Exposure^(1-a))</div>
                  {(["extent", "intensity", "population", "critical_facilities", "access"] as const).map((k) => (
                    <Slider key={k} label={k.replace("_", " ")} min={0} max={1} step={0.05} value={weights[k]} onChange={(v) => setWeights((w) => ({ ...w, [k]: v }))} />
                  ))}
                  <Slider label="Hazard exponent a" min={0.2} max={0.8} step={0.05} value={weights.hazard_exponent} onChange={(v) => setWeights((w) => ({ ...w, hazard_exponent: v }))}
                    tip="Balance between hazard and exposure in the priority score." />
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {step === 2 && (
        <div className="grid g-2" style={{ gap: 16 }}>
          <Card title="Summary">
            <dl className="kv" style={{ gridTemplateColumns: "150px 1fr", rowGap: 10 }}>
              <dt>Name</dt><dd>{name}</dd>
              <dt>Hazard</dt><dd className="row">{HAZARDS[hazard].icon(15)} {HAZARDS[hazard].label}</dd>
              <dt>Data</dt><dd>{synthetic ? <SyntheticChip /> : "Live Sentinel-1 / Sentinel-2 archives + open context data"}</dd>
              <dt>Area</dt><dd>{area ? `${area.toFixed(area < 10 ? 2 : 0)} km²` : "-"}</dd>
              <dt>Event date</dt><dd>{fmtDate(event)}</dd>
              {!synthetic && <><dt>Pre-event</dt><dd>{fmtDate(pre[0])} - {fmtDate(pre[1])}</dd><dt>Post-event</dt><dd>{fmtDate(post[0])} - {fmtDate(post[1])}</dd></>}
              <dt>Resolution</dt><dd>{resolution} m</dd>
            </dl>
            <div className="banner info" style={{ marginTop: 16 }}>
              <Satellite size={16} aria-hidden />
              <span>Typical run time: {synthetic ? "under a minute" : "2-6 minutes"}. You can leave the page; progress is saved. Alerts are drafts until a person approves them.</span>
            </div>
          </Card>
          <Card title="Data availability" sub="Optional: check which satellite passes exist before running" actions={!synthetic && (
            <button className="btn btn-sm" onClick={runPreview} disabled={preview.isPending}><CloudSun size={14} aria-hidden /> {preview.isPending ? "Checking..." : "Check catalogue"}</button>)}>
            {synthetic && <p className="small muted">Simulated scenes always include Sentinel-1 and Sentinel-2-like observations with known ground truth.</p>}
            {preview.isError && <ErrorState error={preview.error} />}
            {!synthetic && !preview.data && !preview.isPending && <p className="small muted">The agent searches automatically when the run starts; checking first helps you adjust dates.</p>}
            {preview.isPending && <Loading label="Searching the Planetary Computer catalogue" />}
            {preview.data && (
              <div className="stack" style={{ gap: 10 }}>
                {(["S1", "S2"] as const).map((s) => (
                  <div key={s}>
                    <strong className="small">{s === "S1" ? "Sentinel-1 radar" : "Sentinel-2 optical"}</strong>
                    {(["pre", "post"] as const).map((role) => {
                      const v = preview.data.sensors[s]?.[role];
                      const list = Array.isArray(v) ? v : [];
                      return (
                        <div key={role} className="xs" style={{ marginTop: 4 }}>
                          <span className="muted">{role}-event:</span>{" "}
                          {!Array.isArray(v) ? <span className="chip danger">{v?.error ?? "unavailable"}</span>
                            : list.length === 0 ? <span className="chip warn">no acquisitions - widen the window</span>
                              : list.slice(0, 8).map((a: { datetime: string; tile_cloud_cover: number | null; relative_orbit: number | null }) => (
                                <span key={a.datetime} className="chip outline" style={{ margin: "2px 4px 2px 0" }}>
                                  {fmtDate(a.datetime, { day: "numeric", month: "short" })}
                                  {s === "S2" && a.tile_cloud_cover != null ? ` · ${Math.round(a.tile_cloud_cover)}% cloud` : s === "S1" ? ` · orbit ${a.relative_orbit}` : ""}
                                </span>
                              ))}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <p className="xs muted">Tile cloud cover is indicative; the agent measures cloud over your exact area before choosing images.</p>
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="row between" style={{ marginTop: 18 }}>
        <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}><ArrowLeft size={15} aria-hidden /> Back</button>
        {step < 2 ? (
          <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Continue <ArrowRight size={15} aria-hidden /></button>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={submit} disabled={create.isPending}>
            {synthetic ? <FlaskConical size={16} aria-hidden /> : <Play size={16} aria-hidden />} {create.isPending ? "Starting..." : "Run analysis"}
          </button>
        )}
      </div>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, tip }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; tip?: string }) {
  return (
    <div className="slider-row">
      <span style={{ textTransform: "capitalize" }}>{label} {tip && <InfoTip text={tip} />}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <span className="tabular" style={{ textAlign: "right" }}>{value}</span>
    </div>
  );
}
