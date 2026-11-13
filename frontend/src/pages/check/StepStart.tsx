import { Binoculars, FileText, ListOrdered, ScanSearch, Users } from "lucide-react";
import type { Dispatch, ReactNode } from "react";
import { Callout, Disclosure } from "@/components/ui";
import { fmtDate, fmtInt } from "@/lib/format";
import { effectiveResolution, useLimits } from "@/lib/limits";
import { HAZARDS } from "@/lib/meta";
import { areaPicture } from "@/lib/plain";
import { type Action, DEFAULT_EXPERT, type Draft, areaKm2, displayName, weightProblem } from "./draft";

const NEXT = [
  { icon: Binoculars, title: "Find satellite images", text: "Radar (Sentinel-1) and optical (Sentinel-2) images from before and after the event." },
  { icon: ScanSearch, title: "Detect what changed", text: "The detection method compares the images, and a second, independent method checks the result." },
  { icon: Users, title: "Check who and what is there", text: "Population estimates, hospitals, schools and roads in and near the area where change was found." },
  { icon: ListOrdered, title: "Rank where to look first", text: "Each square gets a priority, with the reasons written out." },
  { icon: FileText, title: "Ask a person to review", text: "Findings that need judgement and every draft warning wait for a person's decision." },
];

/** Measured on the project's real runs (data/aegis.db): first checks of 77-407 km² took 5-10 minutes, mostly downloading. */
const RUN_TIME_REAL = "Usually 2 to 10 minutes for an area checked for the first time (most of that time is spent downloading images); faster if the same area was checked before.";

export function StepStart({ d, dispatch }: { d: Draft; dispatch: Dispatch<Action> }) {
  const h = d.hazard ? HAZARDS[d.hazard] : null;
  const km2 = areaKm2(d);
  const name = displayName(d);
  return (
    <div className="stack-lg">
      {d.synthetic ? (
        <>
          <p className="summary-sentence">
            AegisEO will look for <mark>{h?.noun ?? "damage"}</mark> in a <mark>made-up practice scene</mark>, with known right answers.
          </p>
          <Callout tone="practice" title="Practice run">
            The scene is invented and placed at 0° N 0° E, in the open ocean, so it can never be mistaken for a real place.
            Its warnings can never be sent. It usually finishes in under a minute.
          </Callout>
        </>
      ) : (
        <p className="summary-sentence">
          AegisEO will look for <mark>{h?.noun ?? "damage"}</mark> in <mark>{d.place?.split(",").slice(0, 2).join(",") || "your area"}</mark>
          {km2 != null ? ` (${km2 < 10 ? km2.toFixed(1) : Math.round(km2).toLocaleString("en")} km², ${areaPicture(km2)})` : ""}, comparing images
          from <mark>{fmtDate(d.windows.pre[0], { day: "numeric", month: "short" })} - {fmtDate(d.windows.pre[1])}</mark> with images
          from <mark>{fmtDate(d.windows.post[0], { day: "numeric", month: "short" })} - {fmtDate(d.windows.post[1])}</mark>.
        </p>
      )}

      <div className="field" style={{ maxWidth: 560 }}>
        <label className="label" htmlFor="check-name">Name</label>
        <input id="check-name" className="input" value={name} maxLength={120} onChange={(e) => dispatch({ type: "name", name: e.target.value })}
          aria-invalid={name.trim().length < 3} aria-describedby="check-name-hint" />
        <span className="hint" id="check-name-hint">So you can find it later under Results. You can keep the suggested name.</span>
      </div>

      <div>
        <h4 style={{ marginBottom: 6 }}>What happens when you press Start</h4>
        <p className="small muted">{d.synthetic ? "Usually under a minute." : RUN_TIME_REAL} You can leave the page: the check keeps running on the server, and you'll find it under Results.</p>
        <ol className="run-stages" style={{ marginTop: 12 }}>
          {NEXT.map((s, i) => (
            <li key={s.title} className="pending rise" style={{ animationDelay: `${i * 0.05}s` }}>
              <span className="rs-icon"><s.icon size={18} aria-hidden /></span>
              <div><strong>{s.title}</strong><span>{s.text}</span></div>
            </li>
          ))}
        </ol>
      </div>

      {!d.synthetic && <DetectionSettings d={d} dispatch={dispatch} />}
    </div>
  );
}

/**
 * Optional settings that are sent with the check. Each explanation was checked against the code that uses the value:
 * resolution -> geo/grid.py, minimum patch -> analysis/hazards.py (_mmu_pixels), flood threshold and Monte-Carlo samples ->
 * analysis/hazards.py + ml/inference.py, dNBR threshold -> analysis/hazards.py, weights and exponent -> analysis/prioritize.py.
 */
function DetectionSettings({ d, dispatch }: { d: Draft; dispatch: Dispatch<Action> }) {
  const e = d.expert;
  const w = e.weights;
  const limits = useLimits();
  const km2 = areaKm2(d);
  const setW = (k: keyof typeof w, v: number) => dispatch({ type: "expert", patch: { weights: { ...w, [k]: v } } });
  const used = km2 != null ? effectiveResolution(km2, e.resolution, limits.maxGridPixels) : e.resolution;
  const problem = e.touched ? weightProblem(w) : null;
  const D = DEFAULT_EXPERT;
  return (
    <Disclosure summary={e.touched ? "Detection and ranking settings (changed from the defaults)" : "Detection and ranking settings (optional)"}>
      <div className="stack-lg">
        <p className="small ink-2">
          These settings control two things: <strong>how AegisEO decides which pixels count as changed</strong>, and <strong>how it ranks the priority
          squares</strong>. The defaults are the values the flood model was tested with (see "How accurate is it?" on the About page). Change them when you
          have a reason, for example when a first result shows many small false alarms, or when your team wants people and roads weighed differently.
          The values used are recorded with the check: the method description under "How we know" lists the thresholds.
        </p>

        <SettingsGroup title="Image detail">
          <Slider label="Pixel size" unit=" m" min={10} max={60} step={10} value={e.resolution} defaultValue={limits.defaultResolutionM}
            onChange={(v) => dispatch({ type: "expert", patch: { resolution: v } })}
            help={<>The size of one square of the grid on which all images are analysed. Smaller pixels show narrower features (streets, small streams);
              halving the pixel size makes four times as many pixels, so the check takes longer and needs more memory. 10 m is the sharpest the satellites
              provide; 20 m matches the real sharpness of the radar images and of the optical infrared bands. Choose 10 m for a small area where detail
              matters, or 30 to 60 m for a quick, coarse look at a large area.</>}
            note={km2 != null && used > e.resolution ? `For your ${fmtInt(km2)} km² area the server will automatically use about ${used} m pixels, to stay within its limit of ${(limits.maxGridPixels / 1e6).toLocaleString("en")} million pixels per image layer.` : undefined} />
          <Slider label="Smallest patch to count" unit=" ha" min={0.1} max={5} step={0.1} value={e.mmu} defaultValue={D.mmu}
            onChange={(v) => dispatch({ type: "expert", patch: { mmu: v } })}
            help={<>After pixels are marked, groups of marked pixels smaller than this area are removed as noise (single bright or dark pixels are common in
              radar images). A larger value gives a cleaner map but drops small real patches, such as ponds or narrow flooded roads; a smaller value keeps
              them but also keeps more noise. 1 hectare (ha) is 100 m × 100 m; with 20 m pixels, 0.5 ha is about 13 pixels. For possible landslides
              AegisEO uses half of this value (at least 0.2 ha).</>} />
        </SettingsGroup>

        {(d.hazard === "flood" || d.hazard === "wildfire") && (
          <SettingsGroup title={d.hazard === "flood" ? "What counts as flooded" : "What counts as burned"}>
            {d.hazard === "flood" && <>
              <Slider label="Minimum flood probability to mark a pixel" min={0.3} max={0.8} step={0.05} value={e.threshold} defaultValue={D.threshold}
                onChange={(v) => dispatch({ type: "expert", patch: { threshold: v } })}
                help={<>For every pixel the model estimates the probability (0 to 1) that it is newly flooded. A pixel is marked only if this probability is
                  at least this value. A higher value, such as 0.7, marks only pixels the model is confident about: fewer false alarms, but some real flooding
                  is missed. A lower value, such as 0.35, finds more of the flooding but also more false alarms. The model's probabilities were calibrated, so
                  0.5 means "more likely flooded than not". Raise it if a result marked obviously dry land; lower it if visible water was missed.</>} />
              <Slider label="Uncertainty samples (Monte-Carlo dropout)" min={2} max={12} step={1} value={e.mc} defaultValue={D.mc}
                onChange={(v) => dispatch({ type: "expert", patch: { mc: v } })}
                help={<>To measure its own uncertainty, the model analyses the 'after' image several times, each time with a different random part of its
                  last layer switched off (the 'before' image gets half as many passes). AegisEO averages the answers and measures how much they disagree.
                  More passes give a steadier uncertainty map, but this step takes proportionally longer. At least 2 are needed, because uncertainty is
                  measured from the disagreement between passes; it feeds the "Model uncertainty" map layer and the safety check that asks a person when
                  the average uncertainty is above 0.15.</>} />
            </>}
            {d.hazard === "wildfire" && (
              <Slider label="Minimum burn index (dNBR) to mark a pixel" min={0.05} max={0.5} step={0.01} value={e.dnbr} defaultValue={D.dnbr}
                onChange={(v) => dispatch({ type: "expert", patch: { dnbr: v } })}
                help={<>dNBR is the drop in the Normalized Burn Ratio between the 'before' and 'after' optical images. The ratio compares near-infrared
                  light, which healthy plants reflect strongly, with short-wave infrared light, which burned ground reflects strongly. A pixel that had
                  vegetation before is marked as burned when its dNBR is at least this value. 0.10 is the start of "low" severity on the standard USGS
                  scale (low 0.10-0.27, moderate-low 0.27-0.44, moderate-high 0.44-0.66, high above 0.66). Raise it to keep only clearer burns, for example
                  to avoid false alarms from harvested fields or drying grass.</>} />
            )}
          </SettingsGroup>
        )}

        <SettingsGroup title="How squares are ranked">
          <p className="small ink-2">
            Each square's score is <strong>100 × H<sup>a</sup> × E<sup>1−a</sup></strong>. <strong>H</strong> (change found) combines two factors and
            <strong> E</strong> (people and places) combines three. Each factor is a number from 0 to 1, and its weight says how much it counts within its
            group; only the relative size of the weights inside a group matters (0.55 and 0.45 give the same result as 1.1 and 0.9). A weight of 0 ignores
            that factor, and each group needs at least one weight above 0. Score bands: Critical 70 or more, High 50 or more, Moderate 30 or more.
            The life-safety rule (a hospital, clinic, fire or ambulance station, or shelter inside the changed part raises a square to High) does not
            depend on these weights.
          </p>
          <h5 style={{ margin: "4px 0 0" }}>H - change found</h5>
          <Slider label="Share of the square that changed" min={0} max={1} step={0.05} value={w.extent} defaultValue={D.weights.extent} onChange={(v) => setW("extent", v)}
            help="Counts fully once half of the square or more shows change." />
          <Slider label="Strength of the change" min={0} max={1} step={0.05} value={w.intensity} defaultValue={D.weights.intensity} onChange={(v) => setW("intensity", v)}
            help="The average flood probability of the changed pixels (for wildfires: the burn-severity class)." />
          <h5 style={{ margin: "4px 0 0" }}>E - people and places</h5>
          <Slider label="People living in the changed part" min={0} max={1} step={0.05} value={w.population} defaultValue={D.weights.population} onChange={(v) => setW("population", v)}
            help="Population estimate on a logarithmic scale; a density of 5,000 people per km² counts fully. Where no population data exists, built-up land is used instead." />
          <Slider label="Important places" min={0} max={1} step={0.05} value={w.critical_facilities} defaultValue={D.weights.critical_facilities} onChange={(v) => setW("critical_facilities", v)}
            help="Hospitals, emergency services, shelters, schools, power and water works inside the changed part or within 500 m. Hospitals count most; places only nearby count half." />
          <Slider label="Roads crossing the changed part" min={0} max={1} step={0.05} value={w.access} defaultValue={D.weights.access} onChange={(v) => setW("access", v)}
            help="Length of mapped main roads in the changed part; 2 km of road per km² counts fully." />
          <Slider label="Balance between H and E (the exponent a)" min={0.2} max={0.8} step={0.05} value={w.hazard_exponent} defaultValue={D.weights.hazard_exponent}
            onChange={(v) => setW("hazard_exponent", v)}
            help="0.5 treats them equally. A higher value makes the score depend more on how much change was found; a lower value makes it depend more on who and what is there. Because the two parts are multiplied, a square with no change, or with no people and places, always scores 0." />
          {problem && <Callout tone="danger" role="alert" title="This combination can't be ranked">{problem}</Callout>}
        </SettingsGroup>

        {e.touched && <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => dispatch({ type: "prefill", patch: { expert: DEFAULT_EXPERT } })}>Back to the default settings</button>}
      </div>
    </Disclosure>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack" style={{ gap: 16 }} aria-label={title}>
      <h4 style={{ fontSize: "1.05rem", margin: 0, paddingBottom: 6, borderBottom: "1px solid var(--line)" }}>{title}</h4>
      {children}
    </section>
  );
}

function Slider({ label, unit = "", min, max, step, value, defaultValue, onChange, help, note }: {
  label: string; unit?: string; min: number; max: number; step: number; value: number; defaultValue: number;
  onChange: (v: number) => void; help: ReactNode; note?: string;
}) {
  const id = `sl-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="slider-row">
      <div className="sr-label">
        <label className="label" htmlFor={id}>{label}</label>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(ev) => onChange(Number(ev.target.value))} aria-describedby={`${id}-help`} />
      <span className="sr-value">{value}{unit && <span className="caption muted">{unit}</span>}</span>
      <p className="caption ink-2" id={`${id}-help`} style={{ gridColumn: "1 / -1", margin: 0, lineHeight: 1.55 }}>
        {help} <span className="muted">Default: {defaultValue}{unit}.</span>
      </p>
      {note && <p className="caption" style={{ gridColumn: "1 / -1", margin: 0, color: "var(--warn)" }}>{note}</p>}
    </div>
  );
}
