import {
  ArrowRight, BrainCircuit, Building2, CheckCircle2, Database, Download, Eye, FileText, Gauge, GitBranch, ListOrdered, Map as MapIcon,
  MessageSquareWarning, Microscope, Minus, ScanSearch, ShieldCheck, Target, Users, Wrench,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useModel } from "@/api/hooks";
import { ExplainerStrip } from "@/components/ExplainerStrip";
import { CameraIllustration, Contours, PersonInChargeIllustration, RadarIllustration } from "@/components/illustrations";
import { Disclosure, Loading } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";
import { GLOSSARY } from "@/lib/meta";
import { accuracyHeadline } from "./accuracyData";

const TOC: [string, string][] = [
  ["what", "What it is"], ["problem", "Why it exists"], ["how", "How it works"], ["images", "Radar and optical images"], ["get", "What you get"],
  ["people", "People stay in charge"], ["accuracy", "How accurate"], ["limits", "What it can't do"], ["words", "Words explained"],
];

export function About() {
  useDocumentTitle("About");
  return (
    <div className="page page-enter" style={{ position: "relative" }}>
      <Contours />
      <section className="about-hero" id="what">
        <div>
          <div className="eyebrow">About AegisEO</div>
          <h1 style={{ marginTop: 14, fontSize: "var(--fs-display)", lineHeight: 1.04 }}>Satellite images that show <em>where help is needed.</em></h1>
          <p className="lead" style={{ marginTop: 20 }}>
            AegisEO is a website that compares satellite images taken before and after a flood, wildfire or landslide. It maps what changed,
            estimates who and what is in the changed area, and suggests which places to check first. A person makes every decision.
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
            <p>Roads may be blocked, phones may be down, and the affected area can be bigger than a city. People on the ground can only see a small part of it.</p>
            <p>Earth-observation satellites take images of all the world's land every few days, and the images of the European Sentinel satellites are free. But turning them into a clear map of what changed usually takes specialists and time.</p>
            <p><strong style={{ color: "var(--ink)" }}>AegisEO does that routine work in minutes and shows its reasons</strong>, so the people responding can spend their time checking and deciding instead of searching.</p>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section-head"><div><h2>How it works</h2><p>Four steps, shown with a real example.</p></div></div>
        <ExplainerStrip />
        <div className="feature-grid" style={{ marginTop: 32 }}>
          <Feature icon={<ScanSearch size={22} />} title="1. You choose a place and a date">Pick a past disaster, a current alert, or any place on the map. AegisEO suggests the date ranges in which to search for images.</Feature>
          <Feature icon={<Eye size={22} />} title="2. It finds suitable images">It searches the free archives of the European Sentinel-1 and Sentinel-2 satellites and picks the most suitable images from just before and just after the event.</Feature>
          <Feature icon={<BrainCircuit size={22} />} title="3. It detects what changed">For floods, a neural network trained on 11 real flood events marks new water. Burned land is measured with the standard dNBR burn index, and possible landslides with a combination of indicators.</Feature>
          <Feature icon={<Users size={22} />} title="4. It checks who is there">It adds population estimates and OpenStreetMap data on hospitals, schools and roads, then gives every square of the area (usually 1 km across) a priority.</Feature>
          <Feature icon={<ShieldCheck size={22} />} title="5. It checks its own work">18 automatic safety checks look for clouds, missing images, unusual scenes and disagreement between methods. When a check needs human judgement, AegisEO asks a person.</Feature>
          <Feature icon={<FileText size={22} />} title="6. You get the answer">A short answer, a map, a ranked list with reasons, and a report you can download and share.</Feature>
        </div>
      </section>

      <section className="section" id="images">
        <div className="section-head"><div><h2>Two types of satellite image: optical and radar</h2>
          <p>AegisEO uses images from two European satellite missions, Sentinel-2 (optical) and Sentinel-1 (radar), because each type records information the other cannot.</p></div></div>
        <div className="grid g-2" style={{ gap: 24 }}>
          <div className="sensor-card">
            <CameraIllustration />
            <h3 style={{ marginTop: 18 }}>Optical images (Sentinel-2)</h3>
            <p className="ink-2" style={{ marginTop: 6 }}>Record sunlight reflected by the ground in 13 bands: the visible colours, like a normal camera, plus near- and short-wave infrared light that our eyes can't see. Infrared shows vegetation and water very clearly.</p>
            <ul className="pros">
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Sharp and easy to interpret (10 m pixels)</li>
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Measure burned land and vegetation loss</li>
              <li><Minus size={18} color="var(--danger)" aria-hidden />Cannot see through clouds or smoke, and need daylight</li>
            </ul>
          </div>
          <div className="sensor-card">
            <RadarIllustration />
            <h3 style={{ marginTop: 18 }}>Radar images (Sentinel-1)</h3>
            <p className="ink-2" style={{ marginTop: 6 }}>A synthetic-aperture radar (SAR) sends its own microwave pulses to the ground and measures the echo. Calm water reflects the pulses away from the satellite, so it appears dark.</p>
            <ul className="pros">
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Work through clouds, by day and by night</li>
              <li><CheckCircle2 size={18} color="var(--ok)" aria-hidden />Suited to floods, which often happen in cloudy weather</li>
              <li><Minus size={18} color="var(--danger)" aria-hidden />Under-detect water between buildings and under trees</li>
            </ul>
          </div>
        </div>
        <p className="ink-2" style={{ marginTop: 20, maxWidth: "70ch" }}>
          AegisEO's flood model reads both image types together. For every pixel it learned how much to rely on each type, so where clouds hide the optical image, the radar image decides.
        </p>
      </section>

      <section className="section" id="get">
        <div className="section-head"><div><h2>What you get</h2><p>Simple at first glance, with every detail available when you want it.</p></div></div>
        <div className="feature-grid">
          <Feature icon={<Target size={22} />} title="The short answer">One clear sentence: how much was hit, how many people live there, and where to look first.</Feature>
          <Feature icon={<MapIcon size={22} />} title="An interactive map">Move a slider between the image from before and the image from after, turn layers on and off, and expand the map to fill the window.</Feature>
          <Feature icon={<ListOrdered size={22} />} title="Where to help first">Every square ranked, with the reasons written out - people, hospitals, schools, roads.</Feature>
          <Feature icon={<Building2 size={22} />} title="People and places">An estimate of who lives in the changed area, and which important places are inside it or within 500 m.</Feature>
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
              <li><ShieldCheck size={20} color="var(--accent)" aria-hidden /><span className="ink-2"><strong style={{ color: "var(--ink)" }}>Weak evidence goes to a person.</strong> When the evidence is weak, AegisEO does not hide it or guess: it creates a finding for a person to double-check.</span></li>
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
            ["Small things are invisible.", "Each pixel covers 10 to 20 metres (20 m by default). Small landslides, single houses or narrow streets can't be seen."],
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
        <div><h2>How accurate is it?</h2><p>The flood model was tested on flood images that experts had mapped by hand and that it had never seen during training.</p></div>
        <Link to="/about/accuracy" className="btn btn-ghost">All test results <ArrowRight size={16} className="arrow" aria-hidden /></Link>
      </div>
      {m.isLoading && <Loading />}
      {m.isError && <p className="small muted">The test results can't be loaded right now.</p>}
      {m.data && !h && <p className="small muted">No test results are available on this server yet.</p>}
      {h && (
        <div className="stat-band">
          <div><div className="sb-value">{h.overlap}%</div><div className="sb-label">overlap with the flood maps experts drew by hand ({h.chips} test images).</div></div>
          <div><div className="sb-value">{h.noOptical}%</div><div className="sb-label">overlap when no optical image is available (radar images only), as under thick cloud.</div></div>
          <div><div className="sb-value">{h.calibration}</div><div className="sb-label">average gap between the confidence it reports and how often it is right (expected calibration error).</div></div>
        </div>
      )}
      <p className="caption muted" style={{ marginTop: 12 }}>"Overlap" is the shared area divided by everything either map marked; 100% would be a perfect match. Numbers come from this server's own test file.</p>
    </>
  );
}

const LOOP = [
  { icon: Eye, name: "Observe", text: "Check the request, search the Sentinel-1 and Sentinel-2 archives, measure cloud over the exact area and load the images plus terrain, water and land-cover maps." },
  { icon: Microscope, name: "Perceive", text: "A two-branch neural network maps water before and after (or burn severity for fires, combined indicators for landslides), with calibrated probabilities and uncertainty." },
  { icon: Database, name: "Record facts", text: "Results become typed facts with units and links to their evidence. Later steps may only cite these facts." },
  { icon: BrainCircuit, name: "Remember", text: "Earlier checks of the same area, and people's corrections, are recalled. Method guidance is looked up and cited." },
  { icon: GitBranch, name: "Plan", text: "Rule-based choices, all recorded: matching radar orbits, cloud-free dates, longer searches, radar-led runs under heavy cloud." },
  { icon: Wrench, name: "Act", text: "Read-only tools fetch roads, buildings, population, rain and fire data; calculation tools assess exposure and rank squares; drafts are written for review." },
  { icon: ShieldCheck, name: "Safety checks", text: "18 checks block bad input, flag weak evidence and send unsure or high-impact findings to people. Anything sent outside needs a named person." },
  { icon: Target, name: "Outcome", text: "An honest status (done, done with notes, needs a person, no usable images…), map layers, checked draft warnings and PDF / CSV / GeoJSON reports." },
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
