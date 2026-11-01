import { BrainCircuit, Database, Eye, Gauge, GitBranch, Microscope, Search, ShieldCheck, Target, Wrench } from "lucide-react";
import { useState } from "react";
import { useKnowledge, useKnowledgeSearch } from "@/api/hooks";
import { Card, Loading } from "@/components/ui";
import { GLOSSARY } from "@/lib/meta";

const LOOP = [
  { icon: Eye, name: "Observe", text: "Validate the request, then search the Sentinel-1/2 archives, measure cloud over the exact area and load imagery plus terrain, water, land-cover layers." },
  { icon: Microscope, name: "Perceive", text: "A gated-fusion network maps water before and after the event (or dNBR for fires, indicator fusion for landslides) with calibrated probabilities and uncertainty." },
  { icon: Database, name: "Semantic state", text: "Results become typed facts with units and evidence links - affected area, agreement, exposure - the only material later steps may cite." },
  { icon: BrainCircuit, name: "Memory / RAG", text: "Earlier analyses of the area and analyst corrections are recalled; methodology guidance is retrieved and cited in reports." },
  { icon: GitBranch, name: "Reason / plan", text: "An explicit plan with rule-based choices: same-orbit radar pairs, cloud-free optical dates, window extensions, SAR-led re-runs under heavy cloud." },
  { icon: Wrench, name: "Act", text: "Read-only tools fetch infrastructure, population, rainfall and fire data; compute tools assess exposure and rank response cells; drafts are written for review." },
  { icon: ShieldCheck, name: "Guardrails / HITL", text: "18 checks block bad input, flag weak evidence and escalate uncertain or high-impact findings to people. Outward actions need a named approver." },
  { icon: Target, name: "Outcome", text: "A status that tells the truth (completed, needs review, insufficient data...), map layers, grounded alerts and PDF/CSV/GeoJSON reports." },
  { icon: Gauge, name: "Feedback", text: "Tool success, escalations, overrides and latency are recorded; analyst decisions update alerts, priorities and future runs." },
];

export function Methodology() {
  const kb = useKnowledge();
  const [q, setQ] = useState("");
  const search = useKnowledgeSearch(q);
  return (
    <div className="stack fade-in" style={{ gap: 18 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>How AegisEO works</h1><p>An agent that turns satellite observations into response priorities - and knows when to ask a person. This page explains the loop, the methods, the terms and the limits.</p></div>
      </div>
      <Card title="The closed loop" sub="Every run walks through these stages; the Evidence & trace tab of each analysis shows exactly what happened">
        <div className="grid g-3" style={{ gap: 12 }}>
          {LOOP.map((s, i) => (
            <div key={s.name} className="row" style={{ alignItems: "flex-start", gap: 12, padding: 12, borderRadius: "var(--r-md)", background: "var(--surface-2)", border: "1px solid var(--line)" }}>
              <span className="stat" style={{ padding: 0 }}><span className="icon"><s.icon size={16} aria-hidden /></span></span>
              <div><div className="small" style={{ fontWeight: 700 }}>{i + 1}. {s.name}</div><div className="xs" style={{ color: "var(--ink-2)", marginTop: 2 }}>{s.text}</div></div>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid g-2" style={{ gap: 16 }}>
        <Card title="Responsible use">
          <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li><strong>Decision support, not decisions.</strong> Priorities help authorised responders decide where to look first; they never dispatch resources.</li>
            <li><strong>Exposure is not impact.</strong> People inside a detected extent are potentially exposed - not confirmed injured or displaced.</li>
            <li><strong>Uncertainty is surfaced, not hidden.</strong> Low-confidence, high-priority findings are sent for verification instead of being down-ranked.</li>
            <li><strong>Evidence or silence.</strong> Every number in an alert is checked against recorded measurements; unverifiable text is withheld.</li>
            <li><strong>Simulated data is labelled everywhere</strong> and can never be published as an alert.</li>
            <li><strong>Known blind spots:</strong> flooded towns and forests (radar double-bounce), water that receded before the satellite passed, small landslides, missing map data.</li>
          </ul>
        </Card>
        <Card title="Glossary">
          <dl className="stack" style={{ gap: 8, margin: 0 }}>
            {GLOSSARY.map((g) => <div key={g.term}><dt className="small" style={{ fontWeight: 650 }}>{g.term}</dt><dd className="xs" style={{ margin: 0, color: "var(--ink-2)" }}>{g.def}</dd></div>)}
          </dl>
        </Card>
      </div>
      <Card title="Knowledge base" sub="The guidance the agent retrieves (RAG) and cites in its reports">
        <div className="row" style={{ background: "#fff", border: "1px solid var(--line-strong)", borderRadius: 10, paddingLeft: 10, maxWidth: 520, marginBottom: 14 }}>
          <Search size={15} className="muted" aria-hidden />
          <input className="input" style={{ border: 0, boxShadow: "none" }} placeholder="Ask, e.g. 'why can radar miss flooded towns?'" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the knowledge base" />
        </div>
        {q.trim().length >= 2 ? (
          <div className="stack">
            {search.isLoading && <Loading label="Searching" />}
            {search.data?.length === 0 && <p className="small muted">No matching guidance.</p>}
            {search.data?.map((p) => (
              <div key={p.ref} className="cell-card" style={{ cursor: "default" }}>
                <div className="row between xs muted"><span>{p.doc_title}</span><span>relevance {p.score?.toFixed(2)}</span></div>
                <div className="small" style={{ fontWeight: 650, marginTop: 2 }}>{p.section}</div>
                <p className="small" style={{ color: "var(--ink-2)", marginTop: 4 }}>{p.text}</p>
                <code className="xs muted">[KB:{p.ref}]</code>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid g-3" style={{ gap: 12 }}>
            {kb.isLoading && <Loading />}
            {kb.data?.map((d) => (
              <div key={d.doc_id} className="cell-card" style={{ cursor: "default" }}>
                <div className="small" style={{ fontWeight: 700 }}>{d.title}</div>
                <ul className="xs" style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--ink-2)" }}>{d.sections.map((s) => <li key={s.ref}>{s.section}</li>)}</ul>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Data attribution">
        <ul className="xs" style={{ margin: 0, paddingLeft: 18, color: "var(--ink-2)", lineHeight: 1.7 }}>
          <li>Contains modified Copernicus Sentinel data (Sentinel-1 RTC, Sentinel-2 L2A) via Microsoft Planetary Computer.</li>
          <li>Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.</li>
          <li>JRC Global Surface Water (Pekel et al., 2016); ESA WorldCover 2021 (CC BY 4.0).</li>
          <li>(c) OpenStreetMap contributors (ODbL); High Resolution Settlement Layer, Meta & CIESIN (CC BY 4.0); WorldPop (CC BY 4.0).</li>
          <li>GDACS (EC JRC / UN OCHA), USGS earthquake feeds, NASA FIRMS, Open-Meteo / ECMWF ERA5.</li>
          <li>Basemaps: CARTO (OSM data) and Sentinel-2 cloudless 2020 by EOX IT Services GmbH.</li>
          <li>Water model trained on Sen1Floods11 (Bonafilia et al., 2020).</li>
        </ul>
      </Card>
    </div>
  );
}
