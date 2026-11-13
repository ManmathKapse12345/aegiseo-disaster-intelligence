// Render every diagram in diagrams.html to a PNG (used by the slides) - node render_diagrams.cjs
const path = require("path");
const fs = require("fs");
const { chromium } = require(path.resolve(__dirname, "../../../frontend/node_modules/playwright"));

(async () => {
  const out = path.join(__dirname, "build", "diagrams");
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2.4 });
  await page.goto("file://" + path.join(__dirname, "diagrams.html").replace(/\\/g, "/"));
  await page.evaluate(() => document.fonts.ready);
  const names = await page.evaluate(() => window.AEGIS_DIAGRAMS.names);
  for (const n of names) {
    await page.locator(`#dg-${n} svg`).screenshot({ path: path.join(out, `${n}.png`) });
    console.log("diagram", n);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
