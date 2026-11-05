import {
  ArrowRight, BrainCircuit, Building2, CheckCircle2, Database, Download, Eye, FileText, Gauge, GitBranch, ListOrdered, Map as MapIcon,
  MessageSquareWarning, Microscope, Minus, ScanSearch, Search, ShieldCheck, Target, Users, Wrench,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useKnowledge, useKnowledgeSearch, useModel } from "@/api/hooks";
import { ExplainerStrip } from "@/components/ExplainerStrip";
import { CameraIllustration, Contours, PersonInChargeIllustration, RadarIllustration } from "@/components/illustrations";
import { Disclosure, Loading } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";
import { GLOSSARY } from "@/lib/meta";
import { accuracyHeadline } from "./accuracyData";

const TOC: [string, string][] = [
  ["what", "What it is"], ["problem", "Why it exists"], ["how", "How it works"], ["eyes", "Two kinds of satellite"], ["get", "What you get"],
  ["people", "People stay in charge"], ["accuracy", "How accurate"], ["limits", "What it can't do"], ["words", "Words explained"], ["ask", "Ask a question"],
];

export function About() {
  useDocumentTitle("About");
  return (
    <div className="page page-enter" style={{ position: "relative" }}>
      <Contours />
      <section className="about-hero" id="what">
        <div>
          <div className="eyebrow">About AegisEO</div>
          <h1 style={{ marginTop: 14, fontSize: "var(--fs-display)", lineHeight: 1.04 }}>Satellite photos that show <em>where help is needed.</em></h1>
          <p className="lead" style={{ marginTop: 20 }}>
            AegisEO is a website that looks at satellite photos taken before and after a flood, wildfire or landslide. It finds what changed,
            works out who and what is in the hit area, and suggests which places to check first. Then it asks a person to make the decisions.
          </p>
          <nav className="about-toc" aria-label="On this page">{TOC.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        </div>
        <figure style={{ margin: 0 }}>
          <div className="scan-figure" style={{ aspectRatio: "4 / 3.6" }}>
            <img src="/images/explain-sindh-2022-priorities.jpg" alt="A real result: coloured squares over a flooded area show where to look first." width={720} height={803} />
          </div>
          <figcaption className="caption muted" style={{ marginTop: 10 }}>A real result from the 2022 floods in Pakistan. Red and orange squares are where to look first.</figcaption>
        </figure>
      </section>

      <section className="section" id="problem">
        <div className="split">
          <p className="big-quote">After a disaster, the first question is always the same: <em>where do we go first?</em></p>
          <div className="prose ink-2">
            <p>Roads may be blocked, phones may be down, and the hit area can be bigger than a city. People on the ground can only see a small part of it.</p>
            <p>Satellites photograph the whole Earth every few days, and many of those photos are free. But turning them into a clear map of the damage usually takes specialists and time.</p>
            <p><strong style={{ color: "var(--ink)" }}>AegisEO does that routine work in minutes, and shows its reasons</strong> - so the people responding can spend their time checking and deciding, not searching.</p>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-head"><div><h2>How it works</h2><p>Four steps, shown with a real example.</p></div></div>
        <ExplainerStrip />
        <div className="feature-grid" style={{ marginTop: 32 }}>
          <Feature icon={<ScanSearch size={22} />} title="1. You choose a place and a date">Pick a past disaster, a current alert, or any place on the map. AegisEO fills in sensible dates.</Feature>
          <Feature icon={<Eye size={22} />} title="2. It finds the right photos">It searches free European Sentinel satellite archives and picks the clearest photos from just before and just after.</Feature>
          <Feature icon={<BrainCircuit size={22} />} title="3. It spots what changed">A computer model trained on real floods marks new water. Burned land and landslide scars are found with proven measurements.</Feature>
          <Feature icon={<Users size={22} />} title="4. It checks who is there">It adds population estimates and maps of hospitals, schools and roads, then ranks small squares of the area (usually 1 km across) by need.</Feature>
          <Feature icon={<ShieldCheck size={22} />} title="5. It checks its own work">About 18 safety checks look for clouds, missing photos and disagreement. When unsure, it says so and asks a person.</Feature>
          <Feature icon={<FileText size={22} />} title="6. You get the answer">A short answer, a map, a ranked list with reasons, and a report you can download and share.</Feature>
        </div>
      </section>

      <section className="section" id="eyes">
        <div className="section-head"><div><h2>Two kinds of satellite "eyes"</h2><p>AegisEO uses both, because each one sees what the other can't.</p></div></div>
        <div className="grid g-2" style={{ gap: 24 }}>
          <div className="sensor-card">
            <CameraIllustration />
            <h3 style={{ marginTop: 18 }}>Camera (Sentinel-2)</h3>
            <p className="ink-2" style={{ marginTop: 6 }}>Takes colour photos, like a normal camera - plus colours our eyes can't see, which show plants and water very clearly.</p>
            <ul className="pros">
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Sharp, easy-to-read pictures</li>
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Great for burned land and plant loss</li>
              <li><Minus size={18} color="var(--danger)" aria-hidden />Can't see through clouds or at night</li>
            </ul>
          </div>
          <div className="sensor-card">
            <RadarIllustration />
            <h3 style={{ marginTop: 18 }}>Radar (Sentinel-1)</h3>
            <p className="ink-2" style={{ marginTop: 6 }}>Sends out its own radio waves and listens for the echo. Calm water bounces the waves away, so it looks dark.</p>
            <ul className="pros">
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Sees through clouds, day and night</li>
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Ideal for floods, which often come with bad weather</li>
              <li><Minus size={18} color="var(--danger)" aria-hidden />Struggles with water between buildings or under trees</li>
            </ul>
          </div>
        </div>
        <p className="ink-2" style={{ marginTop: 20, maxWidth: "70ch" }}>
          AegisEO's flood model looks at both at once and has learned, spot by spot, how much to trust each one - so when clouds cover the camera photo, radar takes over.
        </p>
      </section>

      <section className="section" id="get">
        <div className="section-head"><div><h2>What you get</h2><p>Simple at first glance, with every detail available when you want it.</p></div></div>
        <div className="feature-grid">
          <Feature icon={<Target size={22} />} title="The short answer">One clear sentence: how much was hit, how many people live there, and where to look first.</Feature>
          <Feature icon={<MapIcon size={22} />} title="An interactive map">Slide between the photo before and after, and turn layers on and off.</Feature>
          <Feature icon={<ListOrdered size={22} />} title="Where to help first">Every square ranked, with the reasons written out - people, hospitals, schools, roads.</Feature>
          <Feature icon={<Building2 size={22} />} title="People and places">Who lives in the hit area, and which important places are inside it or nearby.</Feature>
          <Feature icon={<MessageSquareWarning size={22} />} title="Draft warnings">Short, careful messages about urgent places - only sent if a person approves them.</Feature>
          <Feature icon={<Download size={22} />} title="Reports and data">A PDF report to share, a spreadsheet, and map files for specialist software.</Feature>
        </div>
      </section>

      <section className="section" id="people">
        <div className="split">
          <div>
            <h2>People stay in charge</h2>
            <ul className="pros" style={{ marginTop: 16 }}>
              <li><ShieldCheck size={20} color="var(--accent)" aria-hidden /><span className="ink-2"><strong style={{ color: "var(--ink)" }}>It suggests, people decide.</strong> Rankings help decide where to look first. They never send anyone anywhere.</span></li>
              <li><ShieldCheck size={20} color="var(--accent)" aria-hidden /><span className="ink-2"><strong style={{ color: "var(--ink)" }}>Unsure means ask.</strong> When the evidence is weak, AegisEO doesn't hide it or guess - it asks a person to check.</span></li>
              <li><ShieldCheck size={20} color="var(--accent)" aria-hidden /><span className="ink-2"><strong style={{ color: "var(--ink)" }}>Every number is checked.</strong> Each number in a warning must match a measured value, or the text is held back.</span></li>
              <li><ShieldCheck size={20} color="var(--accent)" aria-hidden /><span className="ink-2"><strong style={{ color: "var(--ink)" }}>"In the area" isn't "hurt".</strong> People living in a flooded area may be fine. AegisEO never claims injuries or damage it can't see.</span></li>
            </ul>
          </div>
          <div className="card card-pad"><PersonInChargeIllustration /></div>
        </div>
      </section>

      <section className="section" id="accuracy"><AccuracyTeaser /></section>

      <section className="section" id="limits">
        <div className="section-head"><div><h2>What it can't do</h2><p>Knowing the limits is part of using it well.</p></div></div>
        <div className="grid g-2" style={{ gap: "8px 40px" }}>
          {[
            ["It doesn't measure harm.", "It shows where water, burned land or landslide scars are - not how deep the water is or whether anyone was hurt."],
            ["Fast floods can be missed.", "If the water drains away before a satellite passes over, there is nothing left to see. This happened with the 2023 flash flood in Derna, Libya."],
            ["Towns and forests are harder.", "Radar has trouble seeing water between buildings or under trees, so flooding there can be under-counted."],
            ["Small things are invisible.", "Each picture element covers 10 to 20 metres. Small landslides, single houses or narrow streets can't be seen."],
            ["Maps of people are estimates.", "Population numbers come from 2015-2020 estimates, and some hospitals or schools may be missing from OpenStreetMap."],
            ["Unusual places can confuse it.", "The flood model learned from 11 real floods. Deserts, snow or very dense cities may confuse it - and when that happens, it warns you."],
          ].map(([t, d]) => (
            <div key={t} style={{ padding: "16px 0", borderTop: "1px solid var(--line)" }}>
              <h4 style={{ fontSize: "1.1875rem" }}>{t}</h4>
              <p className="ink-2 small" style={{ marginTop: 4 }}>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section" id="words">
        <div className="section-head"><div><h2>Words explained</h2><p>The few terms you'll meet on this website.</p></div></div>
        <dl className="glossary">
          {GLOSSARY.map((g) => <div key={g.term}><dt>{g.term}</dt><dd>{g.def}</dd></div>)}
        </dl>
      </section>

      <section className="section" id="ask"><Ask /></section>

      <section className="section">
        <h2 style={{ marginBottom: 16 }}>For specialists</h2>
        <Disclosure summary="The step-by-step loop the system follows on every check"><Loop /></Disclosure>
        <Disclosure summary="Where the data comes from, and whether each source is working right now">
          <p className="small ink-2">Satellite archives, population maps, OpenStreetMap, live alert feeds and more - with their licences and limits. <Link to="/about/data">See all data sources</Link>.</p>
        </Disclosure>
        <Disclosure summary="Data credits">
          <ul className="small ink-2">
            <li>Contains modified Copernicus Sentinel data (Sentinel-1 RTC, Sentinel-2 L2A) via Microsoft Planetary Computer.</li>
            <li>Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA.</li>
            <li>JRC Global Surface Water (Pekel et al., 2016); ESA WorldCover 2021 (CC BY 4.0).</li>
            <li>© OpenStreetMap contributors (ODbL); place search by OpenStreetMap Nominatim; High Resolution Settlement Layer, Meta & CIESIN (CC BY 4.0); WorldPop (CC BY 4.0).</li>
            <li>GDACS (EC JRC / UN OCHA), USGS earthquake feeds, NASA FIRMS, Open-Meteo / ECMWF ERA5.</li>
            <li>Background maps: OpenFreeMap (OpenMapTiles, OpenStreetMap data) and Sentinel-2 cloudless 2020 by EOX IT Services GmbH.</li>
            <li>The flood model was trained on Sen1Floods11 (Bonafilia et al., 2020).</li>
          </ul>
        </Disclosure>
      </section>

      <section className="section card card-pad-lg center" style={{ background: "var(--ink)", color: "#fff", borderColor: "var(--ink)" }}>
        <h2 style={{ color: "#fff" }}>Ready to try it?</h2>
        <p style={{ color: "rgba(255,255,255,.82)", marginTop: 10 }}>It takes three quick questions. AegisEO guides you through each one.</p>
        <div className="row-wrap" style={{ justifyContent: "center", marginTop: 24, gap: 12 }}>
          <Link to="/check" className="btn btn-lg" style={{ background: "#fff", color: "var(--ink)", borderColor: "#fff" }}>Check a place <ArrowRight size={18} className="arrow" aria-hidden /></Link>
          <Link to="/check?scenario=synthetic-flood" className="btn btn-lg" style={{ background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.4)" }}>Try a practice run</Link>
        </div>
      </section>
    </div>
  );
}

function Feature({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="feature lift">
      <div className="f-icon" aria-hidden>{icon}</div>
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  );
}

function AccuracyTeaser() {
  const m = useModel();
  const h = accuracyHeadline(m.data);
  return (
    <>
      <div className="section-head">
        <div><h2>How accurate is it?</h2><p>The flood model was tested on flood photos that experts had mapped by hand, which it had never seen before.</p></div>
        <Link to="/about/accuracy" className="btn btn-ghost">All test results <ArrowRight size={16} className="arrow" aria-hidden /></Link>
      </div>
      {m.isLoading && <Loading />}
      {m.isError && <p className="small muted">The test results can't be loaded right now.</p>}
      {m.data && !h && <p className="small muted">No test results are available on this server yet.</p>}
      {h && (
        <div className="stat-band">
          <div><div className="sb-value">{h.overlap}%</div><div className="sb-label">overlap with the flood maps experts drew by hand ({h.chips} test images).</div></div>
          <div><div className="sb-value">{h.noOptical}%</div><div className="sb-label">overlap even when clouds hide every camera photo, using radar alone.</div></div>
          <div><div className="sb-value">{h.calibration}</div><div className="sb-label">average gap between how sure it says it is and how often it's right - its confidence is honest.</div></div>
        </div>
      )}
      <p className="caption muted" style={{ marginTop: 12 }}>"Overlap" is the shared area divided by everything either map marked; 100% would be a perfect match. Numbers come from this server's own test file.</p>
    </>
  );
}

function Ask() {
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const search = useKnowledgeSearch(q);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setQ(text.trim());
  };
  return (
    <>
      <div className="section-head"><div><h2>Have a question?</h2><p>Search the guidance AegisEO itself uses and cites in its reports.</p></div></div>
      <form onSubmit={submit} role="search" style={{ maxWidth: 680 }}>
        <div className="input-group">
          <Search size={18} aria-hidden />
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: why can radar miss flooded towns?" aria-label="Ask a question" />
          <button className="btn btn-primary btn-sm" type="submit" disabled={text.trim().length < 2}>Search</button>
        </div>
      </form>
      <div className="stack" style={{ marginTop: 20, maxWidth: 820 }}>
        {search.isLoading && <Loading label="Searching" />}
        {search.data?.length === 0 && <p className="small muted">Nothing matched. Try other words, like "cloud", "radar" or "population".</p>}
        {search.data?.map((p) => (
          <article key={p.ref} className="card card-pad">
            <div className="caption muted">{p.doc_title}</div>
            <h4 style={{ marginTop: 2 }}>{p.section}</h4>
            <p className="small ink-2" style={{ marginTop: 8 }}>{p.text}</p>
          </article>
        ))}
      </div>
      <KnowledgeList />
    </>
  );
}

function KnowledgeList() {
  const kb = useKnowledge();
  if (!kb.data?.length) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <Disclosure summary={`What the guidance covers (${kb.data.length} documents)`}>
        <div className="grid g-3" style={{ gap: 16 }}>
          {kb.data.map((d) => (
            <div key={d.doc_id}>
              <strong className="small">{d.title}</strong>
              <ul className="caption ink-2" style={{ marginTop: 4 }}>{d.sections.map((s) => <li key={s.ref}>{s.section}</li>)}</ul>
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  );
}

const LOOP = [
  { icon: Eye, name: "Observe", text: "Check the request, search the Sentinel-1 and Sentinel-2 archives, measure cloud over the exact area and load the photos plus terrain, water and land-cover maps." },
  { icon: Microscope, name: "Perceive", text: "A two-branch neural network maps water before and after (or burn severity for fires, combined indicators for landslides), with calibrated probabilities and uncertainty." },
  { icon: Database, name: "Record facts", text: "Results become typed facts with units and links to their evidence. Later steps may only cite these facts." },
  { icon: BrainCircuit, name: "Remember", text: "Earlier checks of the same area, and people's corrections, are recalled. Method guidance is looked up and cited." },
  { icon: GitBranch, name: "Plan", text: "Rule-based choices, all recorded: matching radar orbits, cloud-free dates, longer searches, radar-led runs under heavy cloud." },
  { icon: Wrench, name: "Act", text: "Read-only tools fetch roads, buildings, population, rain and fire data; calculation tools assess exposure and rank squares; drafts are written for review." },
  { icon: ShieldCheck, name: "Safety checks", text: "18 checks block bad input, flag weak evidence and send unsure or high-impact findings to people. Anything sent outside needs a named person." },
  { icon: Target, name: "Outcome", text: "An honest status (done, needs a person, not enough photos…), map layers, checked draft warnings and PDF / CSV / GeoJSON reports." },
  { icon: Gauge, name: "Learn", text: "Tool success, escalations, overrides and run time are measured; people's decisions update warnings, priorities and later checks." },
];

function Loop() {
  return (
    <ol className="stack" style={{ listStyle: "none", padding: 0, gap: 14 }}>
      {LOOP.map((s, i) => (
        <li key={s.name} className="row" style={{ alignItems: "flex-start", gap: 14, margin: 0 }}>
          <span className="hz-dot" style={{ background: "var(--accent-soft)", color: "var(--accent)", flex: "none" }}><s.icon size={18} aria-hidden /></span>
          <div><strong>{i + 1}. {s.name}</strong><p className="small ink-2">{s.text}</p></div>
        </li>
      ))}
    </ol>
  );
}
