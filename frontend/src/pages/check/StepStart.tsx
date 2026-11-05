import { Binoculars, FileText, ListOrdered, ScanSearch, Users } from "lucide-react";
import type { Dispatch } from "react";
import { Callout, Disclosure, InfoTip } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { HAZARDS } from "@/lib/meta";
import { areaPicture } from "@/lib/plain";
import { type Action, DEFAULT_EXPERT, type Draft, areaKm2, displayName } from "./draft";

const NEXT = [
  { icon: Binoculars, title: "Find satellite photos", text: "Radar and camera photos from before and after." },
  { icon: ScanSearch, title: "Spot what changed", text: "A computer model compares them, and a second method double-checks." },
  { icon: Users, title: "Check who and what is there", text: "People, hospitals, schools and roads in the hit area." },
  { icon: ListOrdered, title: "Rank where to look first", text: "Each square gets a priority, with the reasons." },
  { icon: FileText, title: "Ask a person when unsure", text: "Unsure findings and draft warnings wait for your OK." },
];

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
          {km2 != null ? ` (${km2 < 10 ? km2.toFixed(1) : Math.round(km2).toLocaleString("en")} km², ${areaPicture(km2)})` : ""}, comparing photos
          from <mark>{fmtDate(d.windows.pre[0], { day: "numeric", month: "short" })} - {fmtDate(d.windows.pre[1])}</mark> with photos
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
        <p className="small muted">{d.synthetic ? "Usually under a minute." : "Usually 2 to 6 minutes."} You can leave the page - it keeps running, and you'll find it under Results.</p>
        <ol className="run-stages" style={{ marginTop: 12 }}>
          {NEXT.map((s, i) => (
            <li key={s.title} className="pending rise" style={{ animationDelay: `${i * 0.05}s` }}>
              <span className="rs-icon"><s.icon size={18} aria-hidden /></span>
              <div><strong>{s.title}</strong><span>{s.text}</span></div>
            </li>
          ))}
        </ol>
      </div>

      {!d.synthetic && <ExpertSettings d={d} dispatch={dispatch} />}
    </div>
  );
}

function ExpertSettings({ d, dispatch }: { d: Draft; dispatch: Dispatch<Action> }) {
  const e = d.expert;
  const w = e.weights;
  const setW = (k: keyof typeof w, v: number) => dispatch({ type: "expert", patch: { weights: { ...w, [k]: v } } });
  return (
    <Disclosure summary={e.touched ? "Expert settings (changed)" : "Expert settings (optional - most people never need these)"}>
      <div className="stack-lg">
        <Slider label="Detail level" unit=" m per pixel" min={10} max={60} step={10} value={e.resolution} onChange={(v) => dispatch({ type: "expert", patch: { resolution: v } })}
          help="Smaller numbers show more detail but take longer. Very large areas are made coarser automatically." />
        <Slider label="Smallest patch to count" unit=" ha" min={0.1} max={5} step={0.1} value={e.mmu} onChange={(v) => dispatch({ type: "expert", patch: { mmu: v } })}
          help="Patches smaller than this are ignored, to avoid specks of noise. 1 hectare is 100 × 100 m." />
        {d.hazard === "flood" && <>
          <Slider label="How sure before marking a spot" min={0.3} max={0.8} step={0.05} value={e.threshold} onChange={(v) => dispatch({ type: "expert", patch: { threshold: v } })}
            help="Higher means only spots the computer is very sure about are marked: fewer false alarms, but some real flooding may be missed." />
          <Slider label="Uncertainty re-checks" min={1} max={12} step={1} value={e.mc} onChange={(v) => dispatch({ type: "expert", patch: { mc: v } })}
            help="How many times the computer re-checks each spot to measure how unsure it is. More is slower but measures uncertainty better." />
        </>}
        {d.hazard === "wildfire" && (
          <Slider label="Burn strength needed" min={0.05} max={0.5} step={0.01} value={e.dnbr} onChange={(v) => dispatch({ type: "expert", patch: { dnbr: v } })}
            help="How much the plants must have changed to burned ground (dNBR). 0.10 is the standard lowest level of burning (USGS); higher marks only stronger burns." />
        )}
        <div>
          <h5>What matters most when ranking squares</h5>
          <p className="small muted" style={{ marginTop: 4 }}>Score = 100 × damage<sup>a</sup> × exposure<sup>1−a</sup>. The weights below decide what counts as damage and exposure.</p>
        </div>
        {([["extent", "How much of the square is hit"], ["intensity", "How strong the signal is"], ["population", "People living there"],
          ["critical_facilities", "Important places (hospitals, schools…)"], ["access", "Roads affected"]] as const).map(([k, label]) => (
          <Slider key={k} label={label} min={0} max={1} step={0.05} value={w[k]} onChange={(v) => setW(k, v)} />
        ))}
        <Slider label="Balance: damage vs. people and places (a)" min={0.2} max={0.8} step={0.05} value={w.hazard_exponent} onChange={(v) => setW("hazard_exponent", v)}
          help="0.5 treats them equally. Higher puts more weight on how badly an area was hit." />
        {e.touched && <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => dispatch({ type: "prefill", patch: { expert: DEFAULT_EXPERT } })}>Back to the recommended settings</button>}
      </div>
    </Disclosure>
  );
}

function Slider({ label, unit = "", min, max, step, value, onChange, help }: {
  label: string; unit?: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; help?: string;
}) {
  const id = `sl-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="slider-row">
      <div className="sr-label">
        <label className="label" htmlFor={id}>{label} {help && <InfoTip text={help} />}</label>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(ev) => onChange(Number(ev.target.value))} />
      <span className="sr-value">{value}{unit && <span className="caption muted">{unit.replace(" per pixel", "")}</span>}</span>
    </div>
  );
}
