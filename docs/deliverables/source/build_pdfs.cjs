// Builds the AegisEO PDFs from the HTML fragments in doc/ and viva/.
//   node build_pdfs.cjs            (both)      node build_pdfs.cjs documentation | viva
// Needs: Playwright (from frontend/node_modules) and a Python with PyMuPDF + pypdf (PYTHON env var, default C:/Python314/python.exe).
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { chromium } = require(path.resolve(__dirname, "../../../frontend/node_modules/playwright"));

const SRC = __dirname;
const BUILD = path.join(SRC, "build");
const OUT = path.resolve(SRC, "..");
const PY = process.env.PYTHON || "C:/Python314/python.exe";
const DOCS = {
  documentation: { dir: "doc", out: "AegisEO_Project_Report.pdf", title: "AegisEO - Project Report",
    footer: "AegisEO · Project report" },
  viva: { dir: "viva", out: "AegisEO_Viva_Questions_and_Answers.pdf", title: "AegisEO - Viva Questions and Answers",
    footer: "AegisEO · Viva questions and answers" },
};

// Contents: every h1 of a section and every h2 of a chapter gets an id and a hidden page marker (pass 1); pass 2 fills
// page numbers. The same headings become the PDF bookmarks (Chromium's own bookmarks join wrapped lines without spaces).
const HEADS = ".chapter h1, .chapter h2, .no-toc > h1";
const TOC_SCRIPT = `
<script>
(function () {
  const pages = window.__PAGES || null;
  const heads = [...document.querySelectorAll(${JSON.stringify(HEADS)})];
  const toc = document.getElementById("toc");
  heads.forEach((h, i) => {
    const id = "H" + String(i).padStart(3, "0");
    h.id = h.id || id;
    h.dataset.mid = id;
    if (!pages) { const m = document.createElement("span"); m.className = "marker"; m.textContent = "@@" + id + "@@"; h.prepend(m); }
    if (toc && !h.closest(".no-toc")) {
      const row = document.createElement("div");
      row.className = "row " + (h.tagName === "H1" ? "l1" : "l2");
      const label = h.tagName === "H1" ? (h.querySelector(".num") ? h.querySelector(".num").textContent + " - " : "") + [...h.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim() : h.textContent.replace(/@@H\\d+@@/, "").trim();
      const pg = pages ? (pages[id] || "") : "00";
      row.innerHTML = '<a href="#' + h.id + '">' + label + '</a><span class="dots"></span><span class="pg">' + pg + "</span>";
      toc.appendChild(row);
    }
  });
})();
</script>`;

function shell(title, content, pages) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="../doc.css"><script src="../diagrams.js"></script></head>
<body>${pages ? `<script>window.__PAGES=${JSON.stringify(pages)}</script>` : ""}${content}${TOC_SCRIPT}</body></html>`;
}

// Runs in the page after pass 2: level, clean title and marker id of every heading, in document order.
function collectOutline(selector) {
  return [...document.querySelectorAll(selector)].map((h) => {
    const num = h.querySelector(".num");
    const text = [...h.childNodes]
      .filter((n) => n.nodeType === 3 || (n.nodeType === 1 && !n.classList.contains("num") && !n.classList.contains("marker")))
      .map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
    return { id: h.dataset.mid, level: h.tagName === "H1" ? 1 : 2, title: num ? `${num.textContent.trim()}: ${text}` : text };
  });
}

async function renderPdf(browser, htmlFile, pdfFile, footer, collect = false) {
  const page = await browser.newPage();
  await page.goto("file:///" + htmlFile.replace(/\\/g, "/"), { waitUntil: "load" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
  });
  const bad = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute("src")));
  if (bad.length) throw new Error("missing images: " + bad.join(", "));
  const missingDiagrams = await page.evaluate(() => [...document.querySelectorAll("[data-diagram]")].filter((d) => !d.querySelector("svg")).map((d) => d.dataset.diagram));
  if (missingDiagrams.length) throw new Error("diagrams not rendered: " + missingDiagrams.join(", "));
  await page.pdf({
    path: pdfFile, format: "A4", printBackground: true, outline: false, tagged: true,
    margin: { top: "17mm", bottom: "19mm", left: "17mm", right: "17mm" },
    displayHeaderFooter: !!footer,
    headerTemplate: "<div></div>",
    footerTemplate: footer ? `<div style="width:100%;font-family:'Segoe UI',Arial,sans-serif;font-size:7.4pt;color:#7d776c;padding:0 17mm;display:flex;justify-content:space-between;">
      <span>${footer}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>` : "<div></div>",
  });
  const outline = collect ? await page.evaluate(collectOutline, HEADS) : null;
  await page.close();
  return outline;
}

async function build(browser, key) {
  const d = DOCS[key];
  const dir = path.join(SRC, d.dir);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html")).sort();
  const coverFile = files.find((f) => f.startsWith("00-"));
  const body = files.filter((f) => f !== coverFile).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  fs.mkdirSync(BUILD, { recursive: true });

  const coverHtml = path.join(BUILD, `${key}-cover.html`);
  fs.writeFileSync(coverHtml, shell(d.title, fs.readFileSync(path.join(dir, coverFile), "utf8"), null).replace(TOC_SCRIPT, ""));
  await renderPdf(browser, coverHtml, path.join(BUILD, `${key}-cover.pdf`), null);

  // pass 1: find the page of every heading
  const pass1 = path.join(BUILD, `${key}-pass1.html`);
  fs.writeFileSync(pass1, shell(d.title, body, null));
  await renderPdf(browser, pass1, path.join(BUILD, `${key}-pass1.pdf`), d.footer);
  const pages = JSON.parse(execFileSync(PY, [path.join(SRC, "pdf_tools.py"), "pages", path.join(BUILD, `${key}-pass1.pdf`)]).toString());

  // pass 2: same layout, page numbers filled in, markers removed
  const pass2 = path.join(BUILD, `${key}.html`);
  fs.writeFileSync(pass2, shell(d.title, body, pages));
  const heads = await renderPdf(browser, pass2, path.join(BUILD, `${key}-body.pdf`), d.footer, true);
  const missing = heads.filter((h) => !pages[h.id]);
  if (missing.length) throw new Error("headings without a page: " + missing.map((h) => h.title).join(" | "));
  const outlineFile = path.join(BUILD, `${key}-outline.json`);
  fs.writeFileSync(outlineFile, JSON.stringify(heads.map((h) => [h.level, h.title, pages[h.id]])));

  const out = path.join(OUT, d.out);
  console.log(execFileSync(PY, [path.join(SRC, "pdf_tools.py"), "merge", path.join(BUILD, `${key}-cover.pdf`), path.join(BUILD, `${key}-body.pdf`), out,
    d.title, "AegisEO: agentic multi-sensor disaster change detection and response prioritisation", outlineFile]).toString().trim());
}

(async () => {
  const which = process.argv[2] ? [process.argv[2]] : Object.keys(DOCS);
  const browser = await chromium.launch();
  for (const k of which) await build(browser, k);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
