import { Check, CloudSun, RotateCcw } from "lucide-react";
import type { Dispatch } from "react";
import { useCatalogPreview } from "@/api/hooks";
import type { Hazard } from "@/api/types";
import { Callout, Disclosure, ErrorState, InfoTip, Loading } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { HAZARDS } from "@/lib/meta";
import { dateProblems, type Windows } from "@/lib/plain";
import { type Action, type Draft, todayIso } from "./draft";

// ============================================================================ what
export function StepWhat({ d, dispatch }: { d: Draft; dispatch: Dispatch<Action> }) {
  const sug = d.suggestedHazard;
  return (
    <div>
      <div className="option-list cols-3" role="group" aria-label="Type of disaster">
        {(Object.keys(HAZARDS) as Hazard[]).map((h) => {
          const z = HAZARDS[h];
          return (
            <button key={h} className="option" aria-pressed={d.hazard === h} onClick={() => dispatch({ type: "hazard", hazard: h })}
              disabled={d.synthetic && d.hazard !== h}>
              <span className="tick" aria-hidden><Check size={16} /></span>
              <span className="opt-icon" style={{ background: z.soft, color: z.color }}>{z.icon(26)}</span>
              <strong>{z.label}</strong>
              <p><span className="strong" style={{ color: "var(--ink)" }}>{z.question}.</span> {z.lookFor}</p>
              <span className="opt-detail">How: {z.how}</span>
            </button>
          );
        })}
      </div>
      <div className="stack" style={{ marginTop: 20 }}>
        {d.synthetic && <Callout tone="practice" title="Fixed for this practice run">The made-up scene was built for this type of disaster.</Callout>}
        {!d.synthetic && sug && d.hazard === sug && <Callout tone="ok" title={`Already chosen for you: ${HAZARDS[sug].label}`}>That's what was reported for the place you picked. You can still change it.</Callout>}
        {!d.synthetic && sug && d.hazard && d.hazard !== sug && (
          <Callout tone="warn" title={`The event you picked was a ${HAZARDS[sug].label.toLowerCase()}`}>
            Looking for {HAZARDS[d.hazard].noun} there may find nothing. Switch back to {HAZARDS[sug].label} unless you know there was {HAZARDS[d.hazard].noun} too.
          </Callout>
        )}
        {d.hazard && HAZARDS[d.hazard].caution && !d.synthetic && <Callout tone="info">{HAZARDS[d.hazard].caution}</Callout>}
        <Disclosure summary="Why aren't earthquakes or storms listed?">
          <p className="small ink-2 prose">
            Earthquake damage (cracked or collapsed buildings) and storm wind damage are smaller than what these free satellite photos can show -
            each picture element covers 10 to 20 metres. Storms often cause floods, though: for a storm, choose <strong>Flood</strong> to map the flooding.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}

// ============================================================================ when
export function StepWhen({ d, dispatch }: { d: Draft; dispatch: Dispatch<Action> }) {
  const today = todayIso();
  const { errors, warnings } = dateProblems(d.event, d.windows, today);
  const w = d.windows;
  const setW = (patch: Partial<Windows>) => dispatch({ type: "windows", windows: { ...w, ...patch } });

  if (d.synthetic) {
    return (
      <Callout tone="practice" title="Dates are fixed for this practice run">
        The made-up scene has one 'before' and one 'after' picture, so there's nothing to choose here. Press Continue.
      </Callout>
    );
  }
  return (
    <div className="stack-lg">
      <div className="field" style={{ maxWidth: 360 }}>
        <label className="label" htmlFor="event-date">When did it happen?</label>
        <input id="event-date" className="input" type="date" max={today} value={d.event} aria-invalid={errors.length > 0}
          onChange={(e) => e.target.value && dispatch({ type: "date", event: e.target.value })} />
        <span className="hint">If it lasted several days, choose the day it started.</span>
      </div>

      <div className="card card-pad">
        <h4>Which photos AegisEO will look for</h4>
        <TimelineViz event={d.event} w={w} />
        <div className="grid g-2" style={{ marginTop: 18, gap: 16 }}>
          <p className="small"><strong>Before:</strong> the clearest photos taken between {fmtDate(w.pre[0])} and {fmtDate(w.pre[1])}.</p>
          <p className="small"><strong>After:</strong> the first good photos taken between {fmtDate(w.post[0])} and {fmtDate(w.post[1])}.</p>
        </div>
        {!d.customDates && <p className="caption muted" style={{ marginTop: 10 }}>These are suggested from your date: 45 days before, and up to 12 days after.</p>}
      </div>

      {errors.length > 0 && <Callout tone="danger" role="alert" title="Please fix the dates">{errors.map((e) => <div key={e}>{e}</div>)}</Callout>}
      {warnings.map((m) => <Callout key={m} tone="warn">{m}</Callout>)}

      <div>
        <Disclosure summary={d.customDates ? "Search dates (changed by you)" : "Change the search dates (optional)"} defaultOpen={d.customDates}>
          <div className="grid g-2" style={{ gap: 20 }}>
            <fieldset className="stack">
              <legend className="label" style={{ marginBottom: 8 }}>'Before' photos taken between</legend>
              <input className="input" type="date" aria-label="Before: from" value={w.pre[0]} max={w.pre[1]} onChange={(e) => e.target.value && setW({ pre: [e.target.value, w.pre[1]] })} />
              <input className="input" type="date" aria-label="Before: until" value={w.pre[1]} max={d.event} onChange={(e) => e.target.value && setW({ pre: [w.pre[0], e.target.value] })} />
            </fieldset>
            <fieldset className="stack">
              <legend className="label" style={{ marginBottom: 8 }}>'After' photos taken between</legend>
              <input className="input" type="date" aria-label="After: from" value={w.post[0]} min={d.event} onChange={(e) => e.target.value && setW({ post: [e.target.value, w.post[1]] })} />
              <input className="input" type="date" aria-label="After: until" value={w.post[1]} max={today} onChange={(e) => e.target.value && setW({ post: [w.post[0], e.target.value] })} />
            </fieldset>
          </div>
          <p className="caption muted" style={{ marginTop: 12 }}>
            Tip: if no 'after' photo is found, make the 'after' search longer. Radar satellites pass every 6 to 12 days. Each search can be up to 120 days.
          </p>
          {d.customDates && <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => dispatch({ type: "resetWindows" })}><RotateCcw size={15} aria-hidden /> Use the suggested dates</button>}
        </Disclosure>
        <PhotoCheck d={d} disabled={errors.length > 0} />
      </div>
    </div>
  );
}

function TimelineViz({ event, w }: { event: string; w: Windows }) {
  const t = (s: string) => Date.parse(`${s}T00:00:00Z`);
  const lo = t(w.pre[0]);
  const hi = Math.max(t(w.post[1]), t(event));
  const span = Math.max(1, hi - lo);
  const pct = (s: string) => Math.min(100, Math.max(0, ((t(s) - lo) / span) * 100));
  const valid = [w.pre[0], w.pre[1], w.post[0], w.post[1], event].every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  if (!valid) return null;
  return (
    <div className="timeline-viz" aria-hidden>
      <div className="tv-track">
        <div className="tv-range before" style={{ left: `${pct(w.pre[0])}%`, width: `${Math.max(1.5, pct(w.pre[1]) - pct(w.pre[0]))}%` }} />
        <div className="tv-range after" style={{ left: `${pct(w.post[0])}%`, width: `${Math.max(1.5, pct(w.post[1]) - pct(w.post[0]))}%` }} />
        <div className="tv-event" style={{ left: `${pct(event)}%` }}>
          <span className="tv-event-label" style={{ transform: pct(event) > 80 ? "translateX(-100%)" : pct(event) < 20 ? "none" : undefined }}>{fmtDate(event, { day: "numeric", month: "short" })}</span>
        </div>
      </div>
      <div className="tv-legend">
        <span><span className="tv-key" style={{ background: "#9fb8d9" }} /> 'Before' search</span>
        <span><span className="tv-key" style={{ background: "var(--p-critical)", width: 3, height: 14, borderRadius: 2 }} /> The event</span>
        <span><span className="tv-key" style={{ background: "var(--accent)" }} /> 'After' search</span>
      </div>
    </div>
  );
}

type Acq = { datetime: string; tile_cloud_cover: number | null; relative_orbit: number | null };

/** Optional: ask the archive which passes exist (search only, nothing is downloaded). */
function PhotoCheck({ d, disabled }: { d: Draft; disabled: boolean }) {
  const preview = useCatalogPreview();
  const run = () => d.bbox && preview.mutate({ bbox: d.bbox, event_date: d.event, pre_window: d.windows.pre, post_window: d.windows.post });
  const line = (role: "pre" | "post") => {
    const s1 = preview.data?.sensors.S1?.[role];
    const s2 = preview.data?.sensors.S2?.[role];
    const err = (v: unknown) => (v && !Array.isArray(v) ? String((v as { error?: string }).error ?? "unavailable") : null);
    if (err(s1) || err(s2)) return { text: `Couldn't be checked right now (${err(s1) ?? err(s2)}).`, none: false };
    const radar = Array.isArray(s1) ? (s1 as Acq[]).length : 0;
    const cam = Array.isArray(s2) ? (s2 as Acq[]) : [];
    const clear = cam.filter((a) => a.tile_cloud_cover != null && a.tile_cloud_cover < 30).length;
    return { text: `${radar} radar photo${radar === 1 ? "" : "s"} · ${cam.length} camera photo${cam.length === 1 ? "" : "s"}${cam.length ? ` (${clear} mostly clear)` : ""}`, none: radar + cam.length === 0 };
  };
  return (
    <Disclosure summary="Check which satellite photos exist (optional)">
      <p className="small ink-2" style={{ marginBottom: 12 }}>
        AegisEO searches automatically when it starts. Checking first can save time if your dates have no photos yet. This only searches the archive - nothing is downloaded.
      </p>
      <button className="btn btn-sm" onClick={run} disabled={disabled || preview.isPending || !d.bbox}><CloudSun size={16} aria-hidden /> {preview.isPending ? "Searching…" : "Search the photo archive"}</button>
      {preview.isPending && <Loading label="Searching the Sentinel archive (Microsoft Planetary Computer)" />}
      {preview.isError && <div style={{ marginTop: 12 }}><ErrorState error={preview.error} /></div>}
      {preview.data && (() => {
        const pre = line("pre");
        const post = line("post");
        return (
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="small"><strong>Before:</strong> {pre.text}</div>
            <div className="small"><strong>After:</strong> {post.text}</div>
            {post.none && <Callout tone="warn">No 'after' photos were found. Make the 'after' search longer, or wait a few days for the next satellite pass.</Callout>}
            {pre.none && !post.none && (d.hazard === "flood"
              ? <Callout tone="info">No 'before' photos were found. AegisEO can still run, comparing against long-term water records instead - but that is less precise.</Callout>
              : <Callout tone="warn">No 'before' photos were found. Wildfire and landslide checks need one - make the 'before' search longer.</Callout>)}
            <p className="caption muted">"Mostly clear" is based on cloud cover over the whole satellite tile. <InfoTip text="AegisEO measures cloud over your exact area when it runs, and picks the clearest photos itself." /></p>
          </div>
        );
      })()}
    </Disclosure>
  );
}
