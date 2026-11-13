// Builds the four-page IEEE conference paper: paper/paper.html + paper/authors.json -> ../submission/<prefix>_IEEE_Paper.pdf
//   node build_paper.cjs
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.resolve(__dirname, "../../../frontend/node_modules/playwright"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

(async () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "paper/authors.json"), "utf8"));
  const authors = cfg.authors.map((a) => {
    const lines = [a.line1, a.line2, a.line3, a.line4].filter(Boolean).map((l, i) => (i === 0 ? `<i>${esc(l)}</i>` : esc(l)));
    return `<div class="author"><div class="n">${esc(a.name)}</div>${lines.join("<br>")}</div>`;
  }).join("") + (cfg.guide ? `<div class="author"><div class="n">${esc(cfg.guide.name)}</div><i>${esc(cfg.guide.line1 || "Project Guide")}</i><br>${esc(cfg.guide.line2 || "")}</div>` : "");
  const html = fs.readFileSync(path.join(__dirname, "paper/paper.html"), "utf8").replace("{{AUTHORS}}", authors);
  const tmp = path.join(__dirname, "paper/_paper.filled.html");
  fs.writeFileSync(tmp, html);

  const outDir = path.resolve(__dirname, "../submission");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${process.env.PREFIX || cfg.fileprefix}_IEEE_Paper.pdf`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file:///" + tmp.replace(/\\/g, "/"), { waitUntil: "load" });
  await page.pdf({ path: out, format: "Letter", preferCSSPageSize: true, printBackground: true });
  await page.screenshot({ path: path.join(__dirname, "build/paper-preview.png"), fullPage: true });
  await browser.close();
  const pages = (fs.readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`${out}  pages=${pages}  size=${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
})();
