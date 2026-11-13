import { ArrowRight, Check, Globe2, History, MapPinned } from "lucide-react";
import { lazy, Suspense, type Dispatch } from "react";
import type { LiveEvent, Scenario } from "@/api/types";
import { Callout, Disclosure, ErrorState, Loading, PracticeChip } from "@/components/ui";
import { EVENT_NAME, HAZARD_COLOR } from "@/lib/events";
import { fmtDate, fmtInt, timeAgo } from "@/lib/format";
import { type Limits, useLimits } from "@/lib/limits";
import { HAZARDS } from "@/lib/meta";
import { areaPicture } from "@/lib/plain";
import { type Action, type Draft, SUPPORTED_EVENT, areaKm2 } from "./draft";

const AoiPicker = lazy(() => import("@/components/map/AoiPicker").then((m) => ({ default: m.AoiPicker })));
const EventsMap = lazy(() => import("@/components/map/EventsMap").then((m) => ({ default: m.EventsMap })));

export const SCENARIO_IMG: Record<string, string> = {
  "pakistan-sindh-2022": "/images/case-sindh-2022.jpg", "emilia-romagna-2023": "/images/case-emilia-2023.jpg",
  "derna-2023": "/images/case-derna-2023.jpg", "palisades-fire-2025": "/images/case-palisades-2025.jpg",
  "wayanad-2024": "/images/case-wayanad-2024.jpg",
  "synthetic-flood": "/images/synthetic-flood.jpg", "synthetic-flood-cloudy": "/images/synthetic-flood-cloudy.jpg",
  "synthetic-wildfire": "/images/synthetic-wildfire.jpg", "synthetic-landslide": "/images/synthetic-landslide.jpg",
};
const PRACTICE_TITLE: Record<string, string> = {
  "synthetic-flood": "Practice: river flood", "synthetic-flood-cloudy": "Practice: flood under thick cloud",
  "synthetic-wildfire": "Practice: wildfire", "synthetic-landslide": "Practice: landslides",
};
const LEVEL_ORDER: Record<string, number> = { Red: 0, Orange: 1, Green: 2 };
const mapFallback = <div className="map-frame" style={{ height: 420, display: "grid", placeItems: "center" }}><Loading label="Loading the map" /></div>;

interface Props {
  d: Draft;
  dispatch: Dispatch<Action>;
  onContinue: () => void;
  canContinue: boolean;
  scenarios: { data?: Scenario[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  events: { data?: { events: LiveEvent[]; fetched_at: string }; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
}

export function StepWhere({ d, dispatch, scenarios, events, onContinue, canContinue }: Props) {
  const real = (scenarios.data ?? []).filter((s) => s.mode === "real");
  const practice = (scenarios.data ?? []).filter((s) => s.mode === "synthetic");
  const tabs = [
    { id: "past", icon: History, title: "A past disaster", text: "Real events, ready to go" },
    { id: "live", icon: Globe2, title: "Happening now", text: "Current alerts worldwide" },
    { id: "map", icon: MapPinned, title: "Anywhere", text: "Find a place on the map" },
  ] as const;
  const chosen = d.scenarioId ? (scenarios.data ?? []).find((s) => s.id === d.scenarioId) : null;
  const km2 = areaKm2(d);
  const limits = useLimits();

  return (
    <div>
      <div className="where-tabs" role="tablist" aria-label="How do you want to choose the place?">
        {tabs.map((t) => (
          <button key={t.id} role="tab" className="where-tab" aria-selected={d.source === t.id} onClick={() => dispatch({ type: "source", source: t.id })}>
            <span className="wt-icon"><t.icon size={20} aria-hidden /></span>
            <span><strong>{t.title}</strong><span>{t.text}</span></span>
          </button>
        ))}
      </div>

      {d.source === "past" && (
        <div className="fade-in" role="tabpanel" aria-label="A past disaster">
          {scenarios.isLoading && <Loading label="Loading past disasters" />}
          {scenarios.isError && <ErrorState error={scenarios.error} onRetry={scenarios.refetch} />}
          <div className="case-grid">
            {real.map((s) => (
              <button key={s.id} className="case-card" aria-pressed={d.scenarioId === s.id} onClick={() => dispatch({ type: "scenario", s })}>
                <div className="case-img" style={{ backgroundImage: `url(${SCENARIO_IMG[s.id] ?? ""})` }}>
                  <span className="chip on-image"><span style={{ color: HAZARDS[s.hazard].color, display: "inline-flex" }}>{HAZARDS[s.hazard].icon(14)}</span>{HAZARDS[s.hazard].label}</span>
                  <span className="case-check" aria-hidden><Check size={16} /></span>
                </div>
                <div className="case-body">
                  <strong>{s.title}</strong>
                  <div className="region">{s.region} · {fmtDate(s.event_date)}</div>
                  <p>{s.summary}</p>
                </div>
              </button>
            ))}
          </div>
          {chosen && chosen.mode === "real" && (
            <Callout tone="ok" title={`Chosen: ${chosen.title}`}>
              <span>Why it's a good example: {chosen.why} The place, the type of disaster and the dates are filled in for you.</span>
              <div style={{ marginTop: 12 }}><button className="btn btn-primary btn-sm" onClick={onContinue}>Continue with this <ArrowRight size={16} className="arrow" aria-hidden /></button></div>
            </Callout>
          )}
          {practice.length > 0 && (
            <div style={{ marginTop: 40 }}>
              <h3 style={{ fontSize: "1.25rem" }}>Or a practice run with made-up data</h3>
              <p className="small muted" style={{ margin: "6px 0 16px" }}>Practice runs take less than a minute, work without internet, and never describe a real place.</p>
              <div className="case-grid">
                {practice.map((s) => (
                  <button key={s.id} className="case-card" aria-pressed={d.scenarioId === s.id} onClick={() => dispatch({ type: "scenario", s })}>
                    <div className="case-img" style={{ height: 110, backgroundImage: `url(${SCENARIO_IMG[s.id] ?? ""})` }}>
                      <PracticeChip onImage />
                      <span className="case-check" aria-hidden><Check size={16} /></span>
                    </div>
                    <div className="case-body">
                      <strong>{PRACTICE_TITLE[s.id] ?? s.title}</strong>
                      <p>{s.summary}</p>
                    </div>
                  </button>
                ))}
              </div>
              {chosen && chosen.mode === "synthetic" && (
                <div style={{ marginTop: 16 }}>
                  <Callout tone="practice" title={`Chosen: ${PRACTICE_TITLE[chosen.id] ?? chosen.title}`}>
                    <span>The disaster type and dates are fixed for practice scenes, so you can go straight to the start.</span>
                    <div style={{ marginTop: 12 }}><button className="btn btn-primary btn-sm" onClick={onContinue}>Continue to the start <ArrowRight size={16} className="arrow" aria-hidden /></button></div>
                  </Callout>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {d.source === "live" && (
        <LiveTab d={d} dispatch={dispatch} events={events} onContinue={onContinue} canContinue={canContinue} limits={limits} />
      )}

      {d.source === "map" && (
        <div className="fade-in" role="tabpanel" aria-label="Anywhere on the map">
          <p className="small ink-2" style={{ margin: "0 0 14px" }}>
            Search for a place (or move the map yourself), zoom until the <strong>white frame</strong> covers your area, then press <strong>Use this area</strong>.
            To see more of the map, press <strong>Expand map</strong>.
          </p>
          <Suspense fallback={mapFallback}>
            <AoiPicker value={d.synthetic ? null : d.bbox} maxKm2={limits.maxKm2} minKm2={limits.minKm2} fullDetailKm2={limits.fullDetailKm2} height="min(62vh, 560px)"
              onChange={(b, label) => dispatch({ type: "area", bbox: b, place: label ?? null })} />
          </Suspense>
          {!d.synthetic && d.bbox && canContinue && (
            <div className="row-wrap fade-in" style={{ marginTop: 12, gap: 12 }}>
              <span className="chip ok"><Check size={14} aria-hidden /> Area chosen{d.place ? `: ${d.place.split(",")[0]}` : ""}</span>
              <button className="btn btn-primary btn-sm" onClick={onContinue}>Continue with this area <ArrowRight size={16} className="arrow" aria-hidden /></button>
            </div>
          )}
        </div>
      )}

      {!d.synthetic && d.bbox && km2 != null && d.source !== "map" && d.source !== "past" && (
        <p className="caption muted" style={{ marginTop: 12 }}>Area: {km2 < 10 ? km2.toFixed(1) : Math.round(km2)} km², {areaPicture(km2)}.</p>
      )}
      {(d.source === "map" || d.source === "live") && <SizeLimitExplained limits={limits} />}
    </div>
  );
}

/** Why one check is limited in size - every statement mirrors the backend code named in the comments. */
function SizeLimitExplained({ limits }: { limits: Limits }) {
  return (
    <div style={{ marginTop: 20 }}>
      <Disclosure summary={`Why can one check cover at most ${fmtInt(limits.maxKm2)} km²?`}>
        <div className="small ink-2 prose">
          <p>
            This limit is a setting of this AegisEO server (it decides how much work one check may do on one computer). It is not a limit of the satellites or
            of the image archive. A larger area makes a check slower and less detailed, for four reasons:
          </p>
          <ol>
            <li><strong>More data to download.</strong> AegisEO downloads every image for the whole area: radar and optical, before and after, plus maps of
              height, permanent water and land cover. Downloading already takes most of the time of a first check, and at the same pixel size a larger area
              means more data.</li>
            {/* backend/aegis/geo/grid.py Grid.for_aoi + AEGIS_MAX_GRID_PIXELS */}
            <li><strong>Less detail.</strong> Each image layer may have at most {(limits.maxGridPixels / 1e6).toLocaleString("en", { maximumFractionDigits: 1 })} million pixels, so that memory use stays bounded.
              Areas above about {fmtInt(limits.fullDetailKm2)} km² are therefore processed with 30 m pixels instead of 20 m, and narrow features are lost.</li>
            {/* backend/aegis/analysis/prioritize.py max_cells = 900 */}
            <li><strong>Larger priority squares.</strong> At most 900 squares are ranked, so above 900 km² each square grows from 1 km to 1.5 km across and
              describes a bigger area.</li>
            {/* backend/aegis/sources/osm.py build_query: [timeout:90][maxsize:128 MiB] */}
            <li><strong>Map data can fail.</strong> Hospitals, schools and roads come from free public OpenStreetMap servers, which stop a request after
              90 seconds or 128 MB of data. If that happens, the check continues without that information and says so.</li>
          </ol>
          <p>To cover a bigger region, split it into several checks of up to {fmtInt(limits.maxKm2)} km² each. An administrator can change the limit with the
            server setting <code>AEGIS_MAX_AOI_KM2</code>; the effects above then grow with the area.</p>
        </div>
      </Disclosure>
    </div>
  );
}

function LiveTab({ d, dispatch, events, onContinue, canContinue, limits }: Pick<Props, "d" | "dispatch" | "events" | "onContinue" | "canContinue"> & { limits: Limits }) {
  const list = (events.data?.events ?? []).slice().sort((a, b) =>
    (SUPPORTED_EVENT[a.hazard] ? 0 : 1) - (SUPPORTED_EVENT[b.hazard] ? 0 : 1)
    || (LEVEL_ORDER[a.alert_level ?? ""] ?? 3) - (LEVEL_ORDER[b.alert_level ?? ""] ?? 3));
  const selected = list.find((e) => e.id === d.eventId) ?? null;
  return (
    <div className="fade-in" role="tabpanel" aria-label="Happening now">
      {events.isError && <ErrorState error={events.error} onRetry={events.refetch} title="Live alerts couldn't be loaded" />}
      <div className="live-grid">
        <Suspense fallback={mapFallback}>
          <EventsMap events={list} selectedId={d.eventId} onSelect={(e) => SUPPORTED_EVENT[e.hazard] && dispatch({ type: "liveEvent", e })} height={420} />
        </Suspense>
        <div className="card" style={{ maxHeight: 420, overflowY: "auto" }} role="list" aria-label="Current alerts">
          {events.isLoading && <div style={{ padding: 16 }}><Loading label="Loading live alerts" /></div>}
          {events.data && list.length === 0 && <p className="small muted" style={{ padding: 16 }}>There are no current alerts right now.</p>}
          {list.map((e) => {
            const ok = !!SUPPORTED_EVENT[e.hazard];
            const color = HAZARD_COLOR[e.hazard] ?? "#5c677a";
            return (
              <button key={e.id} role="listitem" disabled={!ok} aria-pressed={d.eventId === e.id} onClick={() => dispatch({ type: "liveEvent", e })}
                className="pulse-item" style={{ width: "100%", textAlign: "left", border: 0, borderBottom: "1px solid var(--line)", background: d.eventId === e.id ? "var(--accent-soft)" : "transparent",
                  padding: "12px 14px", cursor: ok ? "pointer" : "not-allowed", opacity: ok ? 1 : 0.62 }}>
                <span className="chip-dot" style={{ width: 12, height: 12, background: color }} aria-hidden />
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: "block", fontSize: "var(--fs-sm)" }}>{e.name}</strong>
                  <span className="caption muted">{EVENT_NAME[e.hazard] ?? e.hazard} · since {fmtDate(e.from || e.time)}{ok ? "" : " · can't be mapped from these images"}</span>
                </span>
                {e.alert_level && <span className={`chip ${e.alert_level === "Red" ? "danger" : e.alert_level === "Orange" ? "warn" : "ok"}`}>{e.alert_level}</span>}
              </button>
            );
          })}
        </div>
      </div>
      {events.data && <p className="caption muted" style={{ marginTop: 10 }}>Alerts from GDACS (European Commission and United Nations) and USGS, fetched {timeAgo(events.data.fetched_at)}. Earthquakes, droughts and volcanoes are shown for context only.</p>}
      {selected && (
        <div style={{ marginTop: 24 }} className="fade-in">
          <Callout tone="info" title={`Chosen: ${selected.name}`}>
            An alert gives only one point on the map, so AegisEO drew a box around that point (shown on the map below; its size is written under the map).
            If the flooding or fire is somewhere else nearby, press <strong>Change area</strong> on the map and move the frame there.
          </Callout>
          <div style={{ marginTop: 16 }}>
            <Suspense fallback={mapFallback}>
              <AoiPicker value={d.bbox} maxKm2={limits.maxKm2} minKm2={limits.minKm2} fullDetailKm2={limits.fullDetailKm2} height={420}
                onChange={(b, label) => dispatch({ type: "area", bbox: b, place: label ?? undefined, keepSource: true })} />
            </Suspense>
          </div>
          {canContinue && <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onContinue}>Continue with this alert <ArrowRight size={16} className="arrow" aria-hidden /></button>}
        </div>
      )}
    </div>
  );
}
