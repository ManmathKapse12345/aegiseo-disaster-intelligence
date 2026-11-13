// Builds the eight project-component PDFs required by the DiP submission guidelines.
// Each component reuses the matching section of the IEEE paper (paper/paper.html, so the two never disagree)
// and adds material that does not fit in four pages (diagrams, code structure, dataset links, dashboards).
//   node build_components.cjs            (run after build_paper.cjs, which writes paper/_paper.filled.html)
//   PREFIX=... node build_components.cjs (file-name prefix; default from paper/authors.json)
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.resolve(__dirname, "../../../frontend/node_modules/playwright"));

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "paper/authors.json"), "utf8"));
const PREFIX = process.env.PREFIX || cfg.fileprefix;
const OUT = path.resolve(__dirname, "../submission", `${PREFIX}_components`);
const TITLE = "AegisEO: An Agentic Radar&ndash;Optical Satellite Image Processing Pipeline for Disaster Change Detection and Response Prioritisation";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const fig = (src, cap, w = "100%") => `<figure><img src="${src}" style="width:${w}"><figcaption>${cap}</figcaption></figure>`;
const shot = (f, cap) => fig(`../../screenshots/${f}`, cap);

const CODE_TABLE = `
<h2>Source code structure</h2>
<p class="ni">The complete source code is in the <b>04_Implementation_Source_Code</b> folder of the Google Drive submission, as original files (no ZIP). Main parts:</p>
<table><thead><tr><th>Folder</th><th style="text-align:left">Contents</th></tr></thead><tbody>
<tr><td>backend/aegis/agents</td><td style="text-align:left">Agent orchestrator, specialist agents, 20 tools, 18 guardrails, memory</td></tr>
<tr><td>backend/aegis/ml</td><td style="text-align:left">U-Net models, gated fusion, training, evaluation, calibration, augmentation</td></tr>
<tr><td>backend/aegis/analysis</td><td style="text-align:left">Spectral indices, SAR processing (Lee filter, log-ratio), hazard detectors, exposure, priority scoring</td></tr>
<tr><td>backend/aegis/geo</td><td style="text-align:left">Raster grid, reprojection and resampling, morphology, vectorisation</td></tr>
<tr><td>backend/aegis/sources</td><td style="text-align:left">Satellite archive search and download, population, OpenStreetMap, live feeds</td></tr>
<tr><td>backend/aegis/api</td><td style="text-align:left">FastAPI routes (35 endpoints) and request/response schemas</td></tr>
<tr><td>backend/aegis/reports</td><td style="text-align:left">PDF, CSV and GeoJSON export</td></tr>
<tr><td>backend/tests</td><td style="text-align:left">93 backend tests (pytest)</td></tr>
<tr><td>frontend/src</td><td style="text-align:left">React + TypeScript web interface (wizard, map workspace, review queue)</td></tr>
<tr><td>frontend/e2e</td><td style="text-align:left">Playwright end-to-end tests (desktop and phone)</td></tr>
<tr><td>models/</td><td style="text-align:left">Trained model weights (.pt) and evaluation results</td></tr>
<tr><td>deploy/, docker-compose.yml</td><td style="text-align:left">Docker, cloud server and tunnel deployment</td></tr>
</tbody></table>
<h2>How to run</h2>
<pre>cd backend
python -m venv .venv &amp;&amp; .venv\\Scripts\\activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements-dev.txt &amp;&amp; pip install -e . --no-deps
uvicorn aegis.main:app --port 8000

cd frontend
npm install &amp;&amp; npm run dev          # open http://localhost:5173

# or everything with Docker:
docker compose up --build           # open http://localhost:8080

# tests
cd backend  &amp;&amp; pytest                # 92 passed, 1 skipped (live test needs --network)
cd frontend &amp;&amp; npm test              # 32 passed
cd backend  &amp;&amp; python -m aegis.benchmark   # agent benchmark, 12/12 cases, 8/8 probes</pre>
<p class="ni">Test results above were re-run on 12 November 2026 on the submitted code.</p>`;

const DATA_LINKS = `
<h2>Dataset and source links</h2>
<table><thead><tr><th>Dataset</th><th style="text-align:left">Where to get it</th></tr></thead><tbody>
<tr><td>Sen1Floods11 v1.1 (training/test)</td><td style="text-align:left">github.com/cloudtostreet/Sen1Floods11; storage.googleapis.com/sen1floods11/v1.1</td></tr>
<tr><td>Sentinel-1 RTC radar</td><td style="text-align:left">planetarycomputer.microsoft.com/dataset/sentinel-1-rtc</td></tr>
<tr><td>Sentinel-2 L2A optical</td><td style="text-align:left">planetarycomputer.microsoft.com/dataset/sentinel-2-l2a</td></tr>
<tr><td>Copernicus DEM GLO-30</td><td style="text-align:left">planetarycomputer.microsoft.com/dataset/cop-dem-glo-30</td></tr>
<tr><td>JRC Global Surface Water</td><td style="text-align:left">global-surface-water.appspot.com</td></tr>
<tr><td>ESA WorldCover</td><td style="text-align:left">esa-worldcover.org</td></tr>
<tr><td>HRSL population</td><td style="text-align:left">dataforgood.facebook.com/dfg/tools/high-resolution-population-density-maps</td></tr>
<tr><td>WorldPop</td><td style="text-align:left">worldpop.org</td></tr>
<tr><td>OpenStreetMap</td><td style="text-align:left">openstreetmap.org (Overpass API); place search via nominatim.org</td></tr>
<tr><td>GDACS / USGS / NASA FIRMS</td><td style="text-align:left">gdacs.org; earthquake.usgs.gov/earthquakes/feed; firms.modaps.eosdis.nasa.gov</td></tr>
<tr><td>Rainfall (ERA5)</td><td style="text-align:left">open-meteo.com</td></tr>
</tbody></table>
<p class="ni">Sen1Floods11 hand-labelled split used: 446 chips from 11 flood events (252 training, validation, 90 test, 15 Bolivia held out). All sources are free and public; no private data is used.</p>`;

const COMPONENTS = [
  { file: "01_Problem_Statement", name: "Problem Statement", secs: ["I."] },
  { file: "02_State_of_the_Art", name: "State of the Art (SOTA)", secs: ["II."] },
  { file: "03_Methodology_Flowchart_Pseudocode", name: "Methodology (Flowchart and Pseudocode)", secs: ["IV."],
    extra: fig("../build/diagrams/fusion.png", "Gated sensor-fusion model: separate radar and optical encoders, a validity-masked gate at every scale, a shared decoder, the radar specialist for radar-only pixels and Monte-Carlo dropout for uncertainty.") },
  { file: "04_Implementation_Source_Code", name: "Implementation / Source Code", secs: ["V."],
    extra: fig("../build/diagrams/architecture.png", "System architecture: browser interface, FastAPI server with the agent orchestrator and tool executor, storage, and the free public data services.") + CODE_TABLE },
  { file: "05_Dataset_and_Data_Sources", name: "Dataset / Data Sources", secs: ["III."], extra: DATA_LINKS },
  { file: "06_Novelty_USP_Digital_Image_Processing", name: "Novelty / USP (Digital Image Processing)", secs: ["VII."] },
  { file: "07_Results_and_Dashboards", name: "Results / Dashboards", secs: ["VI."],
    extra: `<h2>Dashboards</h2>` + [
      ["01-home-hero.jpg", "Home page."],
      ["11-step2-what.jpg", "Check wizard: choosing the disaster type."],
      ["25-result-workspace.jpg", "Result map workspace with detected change and priority squares."],
      ["28-result-compare.jpg", "Before/after comparison of satellite images."],
      ["30-result-people.jpg", "People and important places potentially exposed."],
      ["32-result-safety-checks.jpg", "Safety checks (guardrails) recorded for the analysis."],
      ["34-result-trace-decisions.jpg", "Decision trace of the agent."],
      ["38-wildfire-map.jpg", "Wildfire (Palisades 2025) burn-severity map."],
      ["43-review-page.jpg", "Human review queue."],
      ["49-accuracy-chart.jpg", "Model accuracy page in the application."],
      ["52-phone-result.jpg", "Result on a phone-sized screen."],
    ].map(([f, c]) => shot(f, c)).join("") },
  { file: "08_References", name: "References", secs: ["References"] },
];

const CSS = `
@page { size: A4; margin: 18mm 18mm 18mm 18mm; }
body { font-family: "Times New Roman", Times, serif; font-size: 11.5pt; line-height: 1.4; color: #000; background: #fff; margin: 0; text-align: justify; }
.head { border-bottom: 1.5pt solid #000; padding-bottom: 8pt; margin-bottom: 12pt; text-align: center; }
.head .proj { font-size: 13pt; font-weight: bold; line-height: 1.25; }
.head .comp { font-size: 18pt; margin: 8pt 0 6pt; }
.head .team { font-size: 10pt; line-height: 1.35; }
h2 { font-size: 12.5pt; font-variant: small-caps; margin: 14pt 0 5pt; break-after: avoid; }
h3 { font-size: 11.5pt; font-style: italic; font-weight: normal; margin: 9pt 0 3pt; break-after: avoid; }
p { margin: 0 0 6pt; } p.ni, p { text-indent: 0; }
.eq { text-align: center; font-style: italic; }
figure { margin: 10pt 0; break-inside: avoid; text-align: center; }
figure img { max-width: 100%; border: 0.5pt solid #ccc; }
figcaption { font-size: 9.5pt; margin-top: 4pt; text-align: center; }
table { border-collapse: collapse; width: 100%; font-size: 10pt; margin: 6pt 0 10pt; break-inside: avoid; }
caption { font-variant: small-caps; margin-bottom: 4pt; }
th, td { padding: 2.5pt 5pt; text-align: center; vertical-align: top; }
td:first-child, th:first-child { text-align: left; }
thead tr { border-top: 1pt solid #000; border-bottom: 0.5pt solid #000; } tbody tr:last-child { border-bottom: 1pt solid #000; }
tr.best td { font-weight: bold; }
.algo { border-top: 1pt solid #000; border-bottom: 1pt solid #000; font-size: 10pt; margin: 10pt 0; padding: 3pt 0; break-inside: avoid; text-align: left; }
.algo .h { border-bottom: 0.5pt solid #000; padding-bottom: 3pt; margin-bottom: 3pt; } .algo ol { margin: 0; padding-left: 22pt; } .algo .k { font-weight: bold; } .algo .ind { padding-left: 14pt; }
ul.tight { padding-left: 16pt; } ul.tight li { margin-bottom: 3pt; }
ol.refs { list-style: none; counter-reset: r; padding-left: 26pt; text-align: left; font-size: 10.5pt; }
ol.refs li { counter-increment: r; position: relative; margin-bottom: 5pt; } ol.refs li::before { content: "[" counter(r) "]"; position: absolute; left: -26pt; }
pre { font-family: Consolas, monospace; font-size: 8.8pt; background: #f4f4f4; border: 0.5pt solid #ccc; padding: 6pt; white-space: pre-wrap; text-align: left; }
.wide img { width: 100%; }
`;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const filled = path.join(__dirname, "paper/_paper.filled.html");
  if (!fs.existsSync(filled)) throw new Error("run build_paper.cjs first");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file:///" + filled.replace(/\\/g, "/"));
  // Section HTML keyed by heading text: every node after an h2 up to the next h2.
  const sections = await page.evaluate(() => {
    const out = {};
    const cols = document.querySelector(".cols");
    let key = null;
    for (const n of cols.children) {
      if (n.tagName === "H2") { key = n.textContent.trim(); out[key] = n.outerHTML; continue; }
      if (key) out[key] += n.outerHTML;
    }
    return out;
  });
  const team = cfg.authors.map((a) => `${esc(a.name)} (${esc((a.line4 || "").replace(/^Roll No\.\s*/, "Roll No. "))})`).join(" &middot; ");
  const inst = [cfg.authors[0].line1, cfg.authors[0].line2, cfg.authors[0].line3].filter(Boolean).map(esc).join(", ");
  for (const [i, c] of COMPONENTS.entries()) {
    const body = c.secs.map((s) => {
      const k = Object.keys(sections).find((h) => h.startsWith(s));
      if (!k) throw new Error("section not found: " + s);
      return sections[k];
    }).join("") + (c.extra || "");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${c.name}</title><style>${CSS}</style></head><body>
<div class="head"><div class="proj">${TITLE}</div><div class="comp">Component ${i + 1} of 8: ${c.name}</div>
<div class="team">${team}<br>${inst}</div></div>${body}</body></html>`;
    const tmp = path.join(__dirname, "paper", `_comp_${c.file}.html`);
    fs.writeFileSync(tmp, html);
    await page.goto("file:///" + tmp.replace(/\\/g, "/"), { waitUntil: "load" });
    const out = path.join(OUT, `${PREFIX}_${c.file}.pdf`);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="font-size:8pt;width:100%;text-align:center;font-family:Times New Roman">AegisEO &middot; ${c.name} &middot; page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` });
    fs.unlinkSync(tmp);
    const pages = (fs.readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    console.log(`${(fs.statSync(out).size / 1048576).toFixed(2)} MB  ${pages} p  ${path.basename(out)}`);
  }
  await browser.close();
})();
