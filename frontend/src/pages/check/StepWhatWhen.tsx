import { Check, CloudSun, RotateCcw, Satellite } from "lucide-react";
import type { Dispatch } from "react";
import { useCatalogPreview } from "@/api/hooks";
import type { Hazard } from "@/api/types";
import { Callout, Disclosure, ErrorState, InfoTip, Loading } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { type Limits, useLimits } from "@/lib/limits";
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
            Earthquake damage (cracked or collapsed buildings) and storm wind damage are smaller than what these free satellite images can show:
            each pixel covers 10 to 20 metres. Storms often cause floods, though: for a storm, choose <strong>Flood</strong> to map the flooding.
          </p>
        </Disclosure>
      </div>
    </div>
  );
}

// ============================================================================ when
export function StepWhen({ d, dispatch }: { d: Draft; dispatch: Dispatch<Action> }) {
  const today = todayIso();
  const limits = useLimits();
  const { errors, warnings } = dateProblems(d.event, d.windows, today, limits.maxWindowDays, limits.maxGapDays);
  const w = d.windows;
  const setW = (patch: Partial<Windows>) => dispatch({ type: "windows", windows: { ...w, ...patch } });

  if (d.synthetic) {
    return (
      <Callout tone="practice" title="Dates are fixed for this practice run">
        The made-up scene has one 'before' and one 'after' image, so there's nothing to choose here. Press Continue.
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
        <h4>Which images AegisEO will search for</h4>
        <TimelineViz event={d.event} w={w} />
        {/* selection rules: backend/aegis/agents/specialists.py DataAcquisitionAgent (P1, P2, P4) */}
        <div className="grid g-2" style={{ marginTop: 18, gap: 16 }}>
          <p className="small"><strong>Before:</strong> images taken between {fmtDate(w.pre[0])} and {fmtDate(w.pre[1])}. AegisEO uses the clearest optical image,
            and the latest radar image taken from the same orbit as the 'after' radar image.</p>
          <p className="small"><strong>After:</strong> images taken between {fmtDate(w.post[0])} and {fmtDate(w.post[1])}. AegisEO uses the earliest radar image
            and the clearest optical image, preferring earlier dates.</p>
        </div>
        {!d.customDates && (
          <p className="caption muted" style={{ marginTop: 10 }}>
            {d.scenarioId
              ? "These date ranges were chosen for this case study, so that suitable images exist before and after the event."
              : "These date ranges were suggested from your date: the 'before' search covers the 45 days before it, and the 'after' search covers the day itself and up to 12 days after it."}
          </p>
        )}
      </div>

      {errors.length > 0 && <Callout tone="danger" role="alert" title="Please fix the dates">{errors.map((e) => <div key={e}>{e}</div>)}</Callout>}
      {warnings.map((m) => <Callout key={m} tone="warn">{m}</Callout>)}

      <div>
        <Disclosure summary={d.customDates ? "Search dates (changed by you)" : "Change the search dates (optional)"} defaultOpen={d.customDates}>
          <div className="grid g-2" style={{ gap: 20 }}>
            <fieldset className="stack">
              <legend className="label" style={{ marginBottom: 8 }}>'Before' images taken between</legend>
              <input className="input" type="date" aria-label="Before: from" value={w.pre[0]} max={w.pre[1]} onChange={(e) => e.target.value && setW({ pre: [e.target.value, w.pre[1]] })} />
              <input className="input" type="date" aria-label="Before: until" value={w.pre[1]} max={d.event} onChange={(e) => e.target.value && setW({ pre: [w.pre[0], e.target.value] })} />
            </fieldset>
            <fieldset className="stack">
              <legend className="label" style={{ marginBottom: 8 }}>'After' images taken between</legend>
              <input className="input" type="date" aria-label="After: from" value={w.post[0]} min={d.event} onChange={(e) => e.target.value && setW({ post: [e.target.value, w.post[1]] })} />
              <input className="input" type="date" aria-label="After: until" value={w.post[1]} max={today} onChange={(e) => e.target.value && setW({ post: [w.post[0], e.target.value] })} />
            </fieldset>
          </div>
          <RevisitExplained limits={limits} />
          {d.customDates && <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => dispatch({ type: "resetWindows" })}><RotateCcw size={15} aria-hidden /> Use the suggested dates</button>}
        </Disclosure>
        <PhotoCheck d={d} disabled={errors.length > 0} />
      </div>
    </div>
  );
}

/**
 * What to do when no 'after' image is found, and why images don't exist for every date.
 * Facts used: revisit intervals from backend/aegis/sources/registry.py (Sentinel-1: 6-12 day repeat; Sentinel-2: ~5 days),
 * window rules from guardrails.py (G03: <= 120 days) and the automatic extension rule P3 in agents/specialists.py.
 */
function RevisitExplained({ limits }: { limits: Limits }) {
  return (
    <div className="callout neutral" style={{ marginTop: 16 }}>
      <Satellite size={20} aria-hidden />
      <div className="small ink-2 prose" style={{ maxWidth: "none" }}>
        <p><strong style={{ color: "var(--ink)" }}>If no 'after' image is found, make the 'after' search longer by moving its end date later.</strong></p>
        <p>
          A satellite does not take an image of every place every day. It travels around the Earth on a fixed path, so it passes over the same place again
          only after a set number of days (its <em>revisit interval</em>). The radar satellites (Sentinel-1) usually image the same place every 6 to 12
          days, depending on the year and the region. The optical satellites (Sentinel-2) pass about every 5 days, but their images are only useful when
          clouds do not hide the ground.
        </p>
        <p>
          The 'after' search is the date range in which AegisEO looks for images taken after the event. Each search can be at most {limits.maxWindowDays} days
          long. A longer range makes it more likely that an image exists. It does not replace an earlier radar image with a later one, because AegisEO always
          uses the earliest radar image in the range. If the range contains no usable image of one type (radar or optical), AegisEO extends the end date for
          that type by itself, 7 days at a time, at most twice and never past today.
        </p>
        <p>
          A later image is not always better: floodwater can drain away within days, so an image taken long after the event may show nothing. These revisit
          intervals are typical, not guaranteed for every place; to see which images really exist, use <strong>Check which satellite images exist</strong> below.
        </p>
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

type Acq = { datetime: string; tile_cloud_cover: number | null; relative_orbit: number | null; aoi_coverage?: number };
/** An image must cover at least half of the area to be used (MIN_COVERAGE in backend/aegis/agents/specialists.py). */
const MIN_COVERAGE = 0.5;

/** Optional: ask the archive which passes exist (search only, nothing is downloaded). */
function PhotoCheck({ d, disabled }: { d: Draft; disabled: boolean }) {
  const preview = useCatalogPreview();
  const run = () => d.bbox && preview.mutate({ bbox: d.bbox, event_date: d.event, pre_window: d.windows.pre, post_window: d.windows.post });
  const line = (role: "pre" | "post") => {
    const s1 = preview.data?.sensors.S1?.[role];
    const s2 = preview.data?.sensors.S2?.[role];
    const err = (v: unknown) => (v && !Array.isArray(v) ? String((v as { error?: string }).error ?? "unavailable") : null);
    if (err(s1) || err(s2)) return { text: `Couldn't be checked right now (${err(s1) ?? err(s2)}).`, none: false };
    const usable = (v: unknown) => (Array.isArray(v) ? (v as Acq[]).filter((a) => (a.aoi_coverage ?? 1) >= MIN_COVERAGE) : []);
    const radar = usable(s1);
    const opt = usable(s2);
    const clear = opt.filter((a) => a.tile_cloud_cover != null && a.tile_cloud_cover < 30).length;
    const dates = (list: Acq[]) => (list.length ? ` (${list.slice(0, 6).map((a) => fmtDate(a.datetime, { day: "numeric", month: "short" })).join(", ")}${list.length > 6 ? ", …" : ""})` : "");
    return {
      text: `${radar.length} radar image${radar.length === 1 ? "" : "s"}${dates(radar)} · ${opt.length} optical image${opt.length === 1 ? "" : "s"}${opt.length ? `, ${clear} mostly clear` : ""}`,
      none: radar.length + opt.length === 0,
    };
  };
  return (
    <Disclosure summary="Check which satellite images exist (optional)">
      <p className="small ink-2" style={{ marginBottom: 12 }}>
        AegisEO searches automatically when it starts. Searching first can save time if your dates have no images yet. This only searches the archive
        (Microsoft Planetary Computer); nothing is downloaded.
      </p>
      <button className="btn btn-sm" onClick={run} disabled={disabled || preview.isPending || !d.bbox}><CloudSun size={16} aria-hidden /> {preview.isPending ? "Searching…" : "Search the image archive"}</button>
      {preview.isPending && <Loading label="Searching the Sentinel archive (Microsoft Planetary Computer)" />}
      {preview.isError && <div style={{ marginTop: 12 }}><ErrorState error={preview.error} /></div>}
      {preview.data && (() => {
        const pre = line("pre");
        const post = line("post");
        return (
          <div className="stack" style={{ marginTop: 14 }}>
            <div className="small"><strong>Before:</strong> {pre.text}</div>
            <div className="small"><strong>After:</strong> {post.text}</div>
            {post.none && <Callout tone="warn">No 'after' images were found. Make the 'after' search longer, or wait a few days for the next satellite pass.</Callout>}
            {pre.none && !post.none && (d.hazard === "flood"
              ? <Callout tone="info">No 'before' images were found. AegisEO can still run, comparing against long-term water records instead, but that is less precise.</Callout>
              : <Callout tone="warn">No 'before' images were found. Wildfire and landslide checks need one, so make the 'before' search longer.</Callout>)}
            <p className="caption muted">
              Only images that cover at least half of your area are counted, because AegisEO uses no others. Optical images with 80% or more cloud over the
              whole satellite tile are not listed. "Mostly clear" means under 30% cloud over the tile.{" "}
              <InfoTip text="When it runs, AegisEO measures the cloud over your exact area (not the whole tile) and picks the clearest optical image itself." />
            </p>
          </div>
        );
      })()}
    </Disclosure>
  );
}
