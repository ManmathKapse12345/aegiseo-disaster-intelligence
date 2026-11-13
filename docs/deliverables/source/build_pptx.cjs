// Builds docs/deliverables/AegisEO_Presentation.pptx (structured deck: theme, layouts, sections, speaker notes).
//   cd docs/deliverables/source && npm install && node render_diagrams.cjs && node build_pptx.cjs
// Images: genuine screenshots (../screenshots) and the documentation's diagrams (build/diagrams, from render_diagrams.cjs).
const path = require("path");
const fs = require("fs");
const pptxgen = require("pptxgenjs");

const OUT = path.resolve(__dirname, "../AegisEO_Presentation.pptx");
const SHOT = (f) => path.resolve(__dirname, "../screenshots", f);
const DIAG = (f) => path.resolve(__dirname, "build/diagrams", f);

// Pixel size of a PNG or JPEG, read from its header (no image library needed).
function sizeOf(file) {
  const b = fs.readFileSync(file);
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  throw new Error("cannot read the size of " + file);
}

const THEME = {
  name: "AegisEO",
  headFontFace: "Cambria",
  bodyFontFace: "Calibri",
  colors: {
    dk1: "0F1B2D", lt1: "FFFFFF", dk2: "0B3B4A", lt2: "EEF4F6",
    accent1: "0E7490", accent2: "0EA5E9", accent3: "6366F1", accent4: "B45309", accent5: "B91C1C", accent6: "15803D",
    hlink: "0E7490", folHlink: "6366F1",
  },
};
const HEX = { line: "D3DFE5", muted: "5B6B7F", shadow: "0F1B2D", grid: "E2E8EE", onDark: "CFE5EA", tealTint: "E3F1F4" };

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5 in
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
pres.title = "AegisEO - project presentation";
pres.subject = "Agentic multi-sensor disaster change detection and response prioritisation";
pres.author = "AegisEO project";
const C = pres.SchemeColor;

const W = 13.333, MX = 0.6, CW = W - 2 * MX, TOP = 1.5, BOT = 6.85;

// ------------------------------------------------------------------ layouts
pres.defineSlideMaster({
  title: "AegisEO Title",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 1.55, w: 6.6, h: 1.25, fontSize: 48, bold: true, color: C.background1, valign: "bottom", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 2.95, w: 6.4, h: 2.4, fontSize: 20, color: HEX.onDark, valign: "top", margin: 0 }, text: "" } },
  ],
});
pres.defineSlideMaster({
  title: "AegisEO Section",
  background: { color: C.text2 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: 0.7, y: 2.35, w: 11.9, h: 1.1, fontSize: 40, bold: true, color: C.background1, valign: "bottom", align: "left", margin: 0 }, text: "" } },
    { placeholder: { options: { name: "body", type: "body", x: 0.7, y: 3.6, w: 11.0, h: 1.4, fontSize: 20, color: HEX.onDark, valign: "top", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: 12.1, y: 6.95, w: 0.63, h: 0.3, fontSize: 10, color: HEX.onDark, align: "right" },
});
pres.defineSlideMaster({
  title: "AegisEO Content",
  background: { color: C.background1 },
  objects: [
    { placeholder: { options: { name: "title", type: "title", x: MX, y: 0.38, w: CW, h: 0.85, fontSize: 36, bold: true, color: C.text1, valign: "middle", align: "left", margin: 0 }, text: "" } },
    { text: { text: "AegisEO · project presentation", options: { x: MX, y: 6.98, w: 6, h: 0.3, fontSize: 10, color: HEX.muted, margin: 0 } } },
  ],
  slideNumber: { x: 12.1, y: 6.98, w: 0.63, h: 0.3, fontSize: 10, color: HEX.muted, align: "right" },
});

// ------------------------------------------------------------------ helpers
let objN = 0;
const name = (kind) => `${kind}-${++objN}`;

function txt(slide, content, o) {
  slide.addText(content, { isTextBox: true, fontSize: 14, color: C.text1, margin: 0, valign: "top", paraSpaceAfter: 0, objectName: name("text"), ...o });
}
function card(slide, x, y, w, h, fill = C.background2, line = HEX.line) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: line, width: 0.75 }, objectName: name("card") });
}
function circle(slide, label, x, y, d = 0.44, fill = C.accent1, fontSize = 15) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: name("badge") });
  slide.addText(String(label), { isTextBox: true, x, y, w: d, h: d, align: "center", valign: "middle", fontSize, bold: true, color: C.background1, margin: 0, objectName: name("badge-label") });
}
function chip(slide, label, x, y, w, fill, color = C.background1, h = 0.34, fontSize = 12) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: h / 2, fill: { color: fill }, line: { color: fill, width: 0 }, objectName: name("chip") });
  slide.addText(label, { isTextBox: true, x, y, w, h, align: "center", valign: "middle", fontSize, bold: true, color, margin: 0, objectName: name("chip-label") });
}
// Place an image inside a box (contain), with a white rounded frame and soft shadow. Returns the image rectangle.
function framed(slide, file, bx, by, bw, bh, alt, { align = "center", valign = "top", frame = true } = {}) {
  const [pw, ph] = sizeOf(file);
  const r = pw / ph;
  let w = bw, h = bw / r;
  if (h > bh) { h = bh; w = bh * r; }
  const x = align === "left" ? bx : align === "right" ? bx + bw - w : bx + (bw - w) / 2;
  const y = valign === "top" ? by : valign === "bottom" ? by + bh - h : by + (bh - h) / 2;
  if (frame) {
    slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: x - 0.06, y: y - 0.06, w: w + 0.12, h: h + 0.12, rectRadius: 0.08, fill: { color: C.background1 }, line: { color: HEX.line, width: 0.75 },
      shadow: { type: "outer", color: HEX.shadow, opacity: 0.16, blur: 8, offset: 2, angle: 90 }, objectName: name("frame"),
    });
  }
  slide.addImage({ path: file, x, y, w, h, altText: alt, objectName: name("image") });
  return { x, y, w, h };
}
function content(sectionTitle, title) {
  const s = pres.addSlide({ masterName: "AegisEO Content", sectionTitle });
  s.addText(title, { placeholder: "title" });
  return s;
}

// ================================================================== slides
const S_INTRO = "Introduction", S_USE = "Using AegisEO", S_HOW = "How it works", S_SAFE = "Safety and human review",
  S_EVID = "Evidence and honesty", S_ROUND = "This round and next steps";

// ---------------------------------------------------------------- 1 Title
pres.addSection({ title: S_INTRO });
{
  const s = pres.addSlide({ masterName: "AegisEO Title", sectionTitle: S_INTRO });
  s.addText("AegisEO", { placeholder: "title" });
  s.addText([
    { text: "Agentic multi-sensor disaster change detection and response prioritisation", options: { breakLine: true } },
    { text: " ", options: { fontSize: 10, breakLine: true } },
    { text: "Project presentation · 8 November 2026", options: { fontSize: 15 } },
  ], { placeholder: "body" });
  framed(s, SHOT("25-result-workspace.jpg"), 7.55, 1.55, 5.2, 4.4, "AegisEO result page for the 2022 Sindh floods: a map with ranked priority squares beside a list of squares with their reasons.", { valign: "middle" });
  txt(s, "Real result: 2022 floods, Dadu district, Sindh, Pakistan", { x: 7.55, y: 5.9, w: 5.2, h: 0.35, fontSize: 12, color: HEX.onDark, align: "right" });
  s.addNotes(`Good morning. My project is AegisEO, a web application that turns free satellite images into a ranked, explained map of where a flood, wildfire or landslide changed the land, who and what is there, and where to look first.

The screenshot on the right is a real result, not a mock-up: it is the check of the 2022 monsoon floods around Dadu in Sindh, Pakistan, with each coloured square ranked by priority.

The one idea to keep in mind through the whole talk: the software prepares, and a person decides. Doubtful results wait for a person, and no warning ever leaves the system without a named person's approval.

Plan of the talk: first the problem; then how a user runs a check; then how it works inside (satellite images, the flood model, ranking and the agent); then the safety checks and human review; then the evidence that it works, including tests and five real disasters; and finally what I changed in this round, the limitations, and future work. About 25 minutes, then questions.`);
}

// ---------------------------------------------------------------- 2 Problem
{
  const s = content(S_INTRO, "After a disaster, three questions");
  const qs = [
    ["Where did the land change?", "Flooded fields, burned hills, landslide scars."],
    ["Who and what is there?", "People, hospitals, schools, roads in or near the change."],
    ["Where should we look first?", "A ranking with reasons that a team can act on."],
  ];
  qs.forEach(([q, d], i) => {
    const y = TOP + 0.25 + i * 1.6;
    circle(s, i + 1, MX, y + 0.02, 0.52, C.accent1, 18);
    txt(s, q, { x: MX + 0.75, y, w: 5.0, h: 0.5, fontSize: 22, bold: true });
    txt(s, d, { x: MX + 0.75, y: y + 0.55, w: 5.0, h: 0.7, fontSize: 16, color: HEX.muted });
  });
  card(s, 6.85, TOP, 5.88, BOT - TOP - 0.15, C.background2);
  txt(s, "Why it is hard", { x: 7.2, y: TOP + 0.3, w: 5.2, h: 0.45, fontSize: 20, bold: true, color: C.accent1 });
  const hard = [
    ["Clouds hide the ground", "Optical satellites record reflected sunlight, which clouds block, and floods come with bad weather."],
    ["Radar is hard to read", "Radar sees through cloud, but its images are noisy and easy to misread."],
    ["A map is not a decision", "It must be combined with people and places, ranked, and given a level of trust."],
  ];
  hard.forEach(([h, d], i) => {
    const y = TOP + 0.95 + i * 1.45;
    txt(s, h, { x: 7.2, y, w: 5.2, h: 0.4, fontSize: 17, bold: true });
    txt(s, d, { x: 7.2, y: y + 0.42, w: 5.2, h: 0.8, fontSize: 15, color: C.text1 });
  });
  s.addNotes(`In the first days after a large flood, wildfire or landslide, every responding organisation asks the same three questions: where did the land actually change, who and what is there, and where should we look first.

Free satellite images can answer the first question for any place on Earth, but three things make it hard.

First, clouds. Optical satellites like Sentinel-2 record reflected sunlight, which clouds block, and floods happen in bad weather.

Second, radar. Sentinel-1 sends its own microwave pulses and sees through cloud, day and night, but radar images are noisy and contain effects that mislead untrained readers.

Third, a map of water is not a decision. To be useful it has to be combined with population and facilities, ranked, and accompanied by an honest statement of how far it can be trusted.

A specialist can do all this by hand, but it takes hours to days. AegisEO automates the routine part and makes its reasoning visible.`);
}

// ---------------------------------------------------------------- 3 Pipeline
{
  const s = content(S_INTRO, "What AegisEO does");
  txt(s, "Free satellite images go in; a ranked, explained map, draft warnings and a full record come out, with every consequential decision left to a person.", { x: MX, y: 1.3, w: CW, h: 0.6, fontSize: 16, color: HEX.muted });
  framed(s, DIAG("pipeline.png"), MX, 2.05, CW, 4.75, "Diagram of the AegisEO pipeline from image search to detection, exposure, ranking, safety checks, review and reports.", { frame: false });
  s.addNotes(`This diagram is the whole system on one page.

A person chooses a place, the type of disaster and the date. AegisEO then searches the free archive of the European Sentinel-1 radar and Sentinel-2 optical satellites, picks the best images from before and after the event, and downloads only the part covering the area.

It detects the change: new water for floods with a trained neural network, burned land for wildfires with a standard burn index, and possible landslide scars with a screening method.

It estimates exposure: the people, hospitals, schools and roads inside or near the changed area. I always say "potentially exposed", never "affected", because a population map tells us where people live, not whether they were harmed.

It divides the area into priority squares, usually 1 km, scores each from 0 to 100 and writes the reasons out.

Throughout, 18 automatic safety checks test the request, the images, the result and the written text, and send anything doubtful to a person. Warnings are only drafted; a named person approves or rejects them. Finally it produces the map, a PDF report and data files, plus a complete record of every step.`);
}

// ---------------------------------------------------------------- 4 Wizard
pres.addSection({ title: S_USE });
{
  const s = content(S_USE, "A check in four steps");
  const items = [
    ["04-step1-past.jpg", "1", "Where", "A past disaster, a live alert, or any place found by name; the size of the area is checked as you draw."],
    ["12-step3-when.jpg", "2-3", "What and when", "Flood, wildfire or landslide, and the date; AegisEO suggests search periods and lists the real satellite passes."],
    ["15-step4-start.jpg", "4", "Start", "A summary, optional detection and ranking settings with their defaults, and the Start button."],
  ];
  const gw = 3.85, gap = (CW - 3 * gw) / 2;
  items.forEach(([f, n, t, d], i) => {
    const x = MX + i * (gw + gap);
    framed(s, SHOT(f), x, TOP + 0.05, gw, 2.45, `Wizard step ${n}: ${t}`);
    if (n.length > 1) chip(s, n, x, 4.25, 0.66, C.accent1, C.background1, 0.44, 14); else circle(s, n, x, 4.25, 0.44, C.accent1, 15);
    txt(s, t, { x: x + 0.75, y: 4.29, w: gw - 0.75, h: 0.4, fontSize: 18, bold: true });
    txt(s, d, { x, y: 4.85, w: gw, h: 1.7, fontSize: 15 });
  });
  s.addNotes(`A check is a four-step guided wizard designed for people without remote-sensing training.

Step one, Where: the user picks a past disaster from the case studies, a current alert from GDACS, or any place found by name or coordinates, and adjusts a frame on the map. The size badge says immediately whether the area can be checked; the map can be expanded to the full window, which was one of the improvements in this round.

Steps two and three, What and When: the type of disaster and the date. AegisEO suggests a "before" period of 45 days and an "after" period of 12 days, and a button lists the real satellite passes in the archive without starting a check. A short explanation, rewritten in this round, says how often each satellite passes: radar every 6 to 12 days, optical about every 5 days but only useful without cloud.

Step four, Start: a summary, and optional "Detection and ranking settings", which I renamed from "Expert settings" and documented setting by setting. Most checks leave them alone.

While it runs, a progress page shows five plain steps; a first check of an area takes about 3 to 10 minutes, mostly downloading, and a repeat takes seconds.`);
}

// ---------------------------------------------------------------- 5 Result
{
  const s = content(S_USE, "The result: a short answer and a ranked map");
  framed(s, SHOT("25-result-workspace.jpg"), MX, TOP + 0.05, 7.9, 5.2, "Result page with the map of new water and ranked squares, and the list of squares with reasons.", { align: "left" });
  const pts = [
    ["Short answer", "New water, people potentially exposed, the most urgent priority, confidence."],
    ["Map", "Detected change over the real images, with probability, uncertainty and 'Radar or optical?' layers."],
    ["Where to help first", "Squares ranked 0-100, each with its reasons and how stable the rank is."],
    ["To review", "Findings and draft warnings that wait for a person."],
  ];
  pts.forEach(([h, d], i) => {
    const y = TOP + 0.1 + i * 1.28;
    circle(s, i + 1, 8.95, y, 0.44);
    txt(s, h, { x: 9.55, y: y + 0.02, w: 3.18, h: 0.4, fontSize: 17, bold: true });
    txt(s, d, { x: 9.55, y: y + 0.43, w: 3.18, h: 0.8, fontSize: 14 });
  });
  s.addNotes(`This is the result page of the Sindh 2022 check, a real run.

At the top, not visible here, is a short answer in plain words: 78 square kilometres of new water, about 7,300 people potentially exposed, the highest priority, and a confidence level, followed by any notes from the safety checks.

The map shows the detected new water over the real satellite images. Layers show the probability of every pixel, the model's uncertainty, and a "Radar or optical?" layer that shows which sensor the model relied on.

On the right, "Where to help first" lists the squares by score. Each square opens to show its reasons, for example "89% of this 1 km square looks flooded" and "about 443 people normally live in the flooded part", plus the result of a sensitivity analysis: how much its rank changes if the weights are varied.

The other tabs are "People and places", "How we know" with every image used and every safety check, and "To review" with the findings and draft warnings that wait for a person. Reports can be downloaded as PDF, CSV, GeoJSON and GeoTIFF.`);
}

// ---------------------------------------------------------------- 6 Evidence
{
  const s = content(S_USE, "Every number can be checked");
  framed(s, SHOT("28-result-compare.jpg"), MX, TOP + 0.05, 5.95, 3.75, "Compare before and after: a slider over the real optical images of 27 June and 31 August 2022.");
  framed(s, SHOT("32-result-safety-checks.jpg"), MX + 6.18, TOP + 0.05, 5.95, 3.75, "The safety-check results of the check, with notes and the item that needs a person.");
  txt(s, [
    { text: "Compare before / after. ", options: { bold: true } },
    { text: "A slider over the real optical images (27 June and 31 August 2022), with the detected water on top." },
  ], { x: MX, y: 5.45, w: 5.95, h: 1.2, fontSize: 15 });
  txt(s, [
    { text: "How we know. ", options: { bold: true } },
    { text: "Every image with a link to its catalogue record, every safety check with its value and threshold, and the full step-by-step record." },
  ], { x: MX + 6.18, y: 5.45, w: 5.95, h: 1.2, fontSize: 15 });
  s.addNotes(`A system like this is only useful if a person can check it, so every result carries its evidence.

On the left, "Compare before / after" puts a slider over the real Sentinel-2 images of 27 June and 31 August 2022. The analyst can see with their own eyes that the fields east of the town were dry before and under water after.

On the right is part of "How we know". It lists every image used, each with a link to its record in the Planetary Computer catalogue so anyone can verify it independently, and the result of every safety check with its measured value and threshold. Here, for example, check G11 asks a person to look because the "before" image is unusual compared with the training data; I will come back to that.

Below this there is a full step-by-step record of the agent: its plan, every tool call with its duration, and every decision with the rule that caused it.

The expandable map, also visible here, keeps zoom and layers when it fills the window; that was one of this round's improvements.`);
}

// ---------------------------------------------------------------- 7 Sensors
pres.addSection({ title: S_HOW });
{
  const s = content(S_HOW, "Two types of satellite image");
  const cols = [
    ["Optical: Sentinel-2", C.accent1, ["Records reflected sunlight in 13 bands (AegisEO uses six: blue, green, red, near infrared, two shortwave infrared).", "10-20 m pixels; passes about every 5 days.", "Clear and familiar, but useless under cloud."]],
    ["Radar: Sentinel-1", C.accent3, ["Sends its own microwave pulses (about 5.5 cm) and measures the echo.", "Works through cloud, day and night; passes every 6-12 days.", "Calm water reflects the pulse away and looks dark; noisy and harder to read."]],
  ];
  cols.forEach(([h, col, lines], i) => {
    const x = MX + i * 3.15;
    card(s, x, TOP, 2.95, 3.85, C.background2);
    txt(s, h, { x: x + 0.25, y: TOP + 0.22, w: 2.5, h: 0.4, fontSize: 18, bold: true, color: col });
    txt(s, lines.map((l, j) => ({ text: l, options: { bullet: { indent: 14 }, breakLine: j < lines.length - 1, paraSpaceAfter: 8 } })), { x: x + 0.2, y: TOP + 0.8, w: 2.6, h: 2.95, fontSize: 14 });
  });
  card(s, MX, 5.6, 6.1, 1.1, HEX.tealTint, HEX.tealTint);
  txt(s, [
    { text: "Used together: ", options: { bold: true, color: C.accent1 } },
    { text: "radar always observes the ground; optical is clearer wherever the sky is clear." },
  ], { x: MX + 0.25, y: 5.6, w: 5.6, h: 1.1, fontSize: 15, valign: "middle" });
  framed(s, SHOT("46-about-images.jpg"), 7.0, TOP + 0.05, 5.73, 3.6, "About page section explaining the two types of satellite image.");
  txt(s, "The website explains both image types in plain words, without metaphors (rewritten in this round).", { x: 7.0, y: 5.35, w: 5.73, h: 0.8, fontSize: 14, color: HEX.muted });
  s.addNotes(`AegisEO combines two kinds of satellite image, and the difference matters for everything that follows.

Sentinel-2 is optical: it records reflected sunlight in 13 spectral bands. AegisEO uses six of them, from blue to shortwave infrared. The pixels are 10 to 20 metres and the satellites pass about every five days. The images are clear and familiar, but useless under cloud.

Sentinel-1 is a radar, a synthetic aperture radar. It sends its own microwave pulses, about 5.5 centimetres long, and measures the echo, called backscatter. Microwaves pass through cloud, so it works in any weather, day and night. Calm water acts like a mirror and reflects the pulse away from the satellite, so water looks dark. But radar images are noisy, and water among buildings or trees can even look brighter.

So the two sensors complement each other: optical is clear when the sky is clear, radar always sees something. Both are from the EU's Copernicus programme and free.

The screenshot shows how the website explains this to non-specialists. In this round I removed metaphors such as "satellite eyes" and wrote the explanations in plain, complete sentences.`);
}

// ---------------------------------------------------------------- 8 Image choice
{
  const s = content(S_HOW, "Choosing the images");
  framed(s, DIAG("revisit.png"), MX, TOP - 0.05, CW, 3.9, "Timeline diagram of satellite passes before and after an event and the search periods.", { frame: false });
  const rules = [
    ["P1", "Earliest radar pass after the event"],
    ["P2", "Clearest optical image, cloud measured over the area"],
    ["P3", "Empty search: extend by 7 days, at most twice"],
    ["P4", "'Before' radar from the same orbit track"],
  ];
  const rw = (CW - 3 * 0.3) / 4;
  rules.forEach(([r, d], i) => {
    const x = MX + i * (rw + 0.3);
    card(s, x, 5.55, rw, 1.15, C.background2);
    chip(s, r, x + 0.2, 5.72, 0.6, C.accent1);
    txt(s, d, { x: x + 0.95, y: 5.68, w: rw - 1.1, h: 0.9, fontSize: 14 });
  });
  s.addNotes(`A satellite passes over the same place only every few days, so the first question for every check is which images to use. AegisEO answers it with written rules, and each decision is recorded with its rule number.

Only passes that cover at least half of the area are considered.

Rule P1: take the earliest radar pass after the event. It is closest in time, and radar is not affected by cloud.

Rule P2: for optical images, measure the cloud over the exact area using the scene-classification layer, and choose the clearest image with a small penalty for every day of delay.

Rule P3: if a search period contains no usable image, extend it by 7 days, at most twice and never past today. If there is still no "after" image, the check stops honestly with "No usable images" rather than producing a map.

Rule P4: the "before" radar image must come from the same orbit track and direction, because radar brightness depends on the viewing angle.

The timeline shows why the "after" image can come days after the event. A longer search does not make the radar image later: AegisEO always takes the earliest pass. This explanation replaced an older tip that was confusing for beginners.`);
}

// ---------------------------------------------------------------- 9 Flood model
{
  const s = content(S_HOW, "The flood model: two branches and a gate");
  framed(s, DIAG("fusion.png"), MX, TOP + 0.05, 8.25, 4.2, "Diagram of the gated-fusion U-Net with separate radar and optical encoders joined by gates.", { frame: false, align: "left" });
  const pts = [
    ["Two encoders", "Radar and optical are read separately."],
    ["A gate per pixel", "Learns how much to rely on radar, at four scales."],
    ["A hard rule", "Cloud-covered optical pixels are never used."],
    ["Trained for gaps", "30% of examples without optical, clouds up to 100%."],
  ];
  pts.forEach(([h, d], i) => {
    const y = TOP + 0.05 + i * 1.1;
    circle(s, i + 1, 9.15, y, 0.42);
    txt(s, h, { x: 9.72, y: y + 0.01, w: 3.0, h: 0.4, fontSize: 16, bold: true });
    txt(s, d, { x: 9.72, y: y + 0.4, w: 3.0, h: 0.6, fontSize: 14 });
  });
  card(s, MX, 5.85, CW, 0.85, C.background2);
  txt(s, [
    { text: "g_eff = v_sar × (g × v_opt + (1 − v_opt))", options: { bold: true, color: C.accent1 } },
    { text: "    where v = 1 for a valid observation: no optical → radar only; no radar → optical only.", options: { color: C.text1 } },
  ], { x: MX + 0.3, y: 6.05, w: CW - 0.6, h: 0.5, fontSize: 15, valign: "middle" });
  s.addNotes(`The flood detector is a neural network called a U-Net, which labels every pixel; here it outputs the probability that a pixel is water.

The simple approach is to stack all radar and optical bands as one input, which is called early fusion. Its weakness is that cloudy optical values look like any other input.

AegisEO's model has two separate encoders, one for radar and one for optical, and at each of four scales a small learned gate decides, pixel by pixel, how much to rely on radar.

On top of that there is a hard rule written into the formula at the bottom. v-sar and v-opt are 1 where the sensor has a valid observation and 0 under cloud or outside the image. Where optical is invalid, the effective gate is 1, so only radar is used; where radar is invalid, it is 0. The network cannot use a cloudy pixel, by construction, and a unit test checks it.

The model was developed with Sen1Floods11, 446 expert-labelled image chips from 11 flood events, of which 252 were used for training, with strong sensor dropout: in 30% of training examples the optical image was removed entirely and clouds covered up to 100%. Where only radar sees the ground, a separate radar-only model is blended in. This combination was chosen on validation data.`);
}

// ---------------------------------------------------------------- 10 Accuracy chart
{
  const s = content(S_HOW, "How accurate is the flood model?");
  const labels = ["AegisEO (deployed hybrid)", "Gated fusion v1", "Early fusion U-Net", "Radar-only U-Net", "Otsu threshold, radar VV", "Optical-only U-Net", "MNDWI index, optical"];
  const values = [0.739, 0.699, 0.691, 0.653, 0.431, 0.419, 0.378];
  s.addChart(pres.charts.BAR, [{ name: "IoU at 50% cloud", labels, values }], {
    x: MX, y: TOP - 0.05, w: 7.55, h: 5.3, barDir: "bar", catAxisOrientation: "maxMin",
    chartColors: [THEME.colors.accent1], showValue: true, dataLabelPosition: "outEnd", dataLabelFormatCode: "0.000",
    dataLabelFontSize: 12, dataLabelColor: THEME.colors.dk1, dataLabelFontFace: "+mn-lt",
    catAxisLabelFontSize: 12, catAxisLabelColor: THEME.colors.dk1, catAxisLabelFontFace: "+mn-lt",
    valAxisMinVal: 0, valAxisMaxVal: 1, valAxisMajorUnit: 0.2, valAxisLabelFontSize: 11, valAxisLabelColor: HEX.muted, valAxisLabelFontFace: "+mn-lt",
    valAxisLabelFormatCode: "0.0", valGridLine: { color: HEX.grid, size: 0.5 }, catGridLine: { style: "none" },
    showLegend: false, showTitle: true, title: "Agreement with expert maps (IoU) with 50% of the optical image under cloud",
    titleFontSize: 13, titleColor: THEME.colors.dk1, titleFontFace: "+mn-lt", barGapWidthPct: 45,
  });
  const stats = [
    ["0.844", "IoU on 90 unseen test chips (precision 0.932, recall 0.899)"],
    ["0.828", "IoU on a flood event never seen in training (Bolivia)"],
    ["0.653", "IoU with no optical image at all"],
    ["0.006", "calibration error: the probabilities mean what they say"],
  ];
  stats.forEach(([v, l], i) => {
    const x = 8.5 + (i % 2) * 2.17, y = TOP + Math.floor(i / 2) * 2.55;
    card(s, x, y, 2.05, 2.35, C.background2);
    txt(s, v, { x: x + 0.15, y: y + 0.2, w: 1.75, h: 0.75, fontSize: 34, bold: true, color: C.accent1 });
    txt(s, l, { x: x + 0.15, y: y + 1.0, w: 1.8, h: 1.25, fontSize: 13 });
  });
  s.addNotes(`How good is the model? It was evaluated on images it never saw: the 90 test chips of Sen1Floods11 and the 15 chips of the Bolivia flood, an event kept out of training completely.

The measure is IoU, intersection over union: the area both the model and the experts marked as water, divided by the area either marked. 1.0 is perfect.

On the test chips the deployed model reaches 0.844, with precision 0.932 and recall 0.899, and 0.828 on Bolivia, so it generalises to a new place.

The chart shows the condition that motivated the design: half of the optical image covered by simulated cloud. The deployed hybrid keeps 0.739. The optical-only network falls to 0.419, and the classical optical index to 0.378. Classical radar thresholding gets 0.431. With no optical image at all, the model still reaches 0.653, which is exactly why AegisEO lowers its confidence in that situation.

Finally, calibration: an expected calibration error of 0.006 means that when the model says 70%, it is right about 70% of the time, so the probability and uncertainty maps can be taken at face value.

All numbers come from the project's evaluation file, generated by the evaluation script; the model was selected on validation data, so these test numbers are fair.`);
}

// ---------------------------------------------------------------- 11 Ranking
{
  const s = content(S_HOW, "From pixels to priorities");
  framed(s, DIAG("priority.png"), MX, TOP + 0.05, 8.6, 3.75, "Diagram of the priority score combining hazard and exposure factors.", { frame: false, align: "left" });
  card(s, MX, 5.45, 8.6, 1.25, C.background2);
  txt(s, [
    { text: "Score = 100 × H", options: { bold: true, color: C.accent1 } },
    { text: "a", options: { bold: true, color: C.accent1, superscript: true } },
    { text: " × E", options: { bold: true, color: C.accent1 } },
    { text: "1−a", options: { bold: true, color: C.accent1, superscript: true } },
    { text: "   H: how much changed and how strongly.  E: people, important places, roads.  Both are needed for a high score.", options: { color: C.text1 } },
  ], { x: MX + 0.3, y: 5.62, w: 8.0, h: 0.95, fontSize: 15, valign: "middle" });
  const cats = [["Critical", "from 70", C.accent5], ["High", "from 50", C.accent4], ["Moderate", "from 30", C.accent2], ["Low", "below 30", HEX.muted]];
  txt(s, "Categories", { x: 9.6, y: TOP + 0.05, w: 3.1, h: 0.4, fontSize: 17, bold: true });
  cats.forEach(([c, r, col], i) => {
    chip(s, c, 9.6, TOP + 0.6 + i * 0.5, 1.35, col, C.background1, 0.36, 13);
    txt(s, r, { x: 11.1, y: TOP + 0.62 + i * 0.5, w: 1.6, h: 0.34, fontSize: 14, valign: "middle" });
  });
  txt(s, [
    { text: "Life-safety rule: ", options: { bold: true } },
    { text: "a flooded hospital, clinic, fire or ambulance station or shelter lifts its square to at least High.", options: { breakLine: true } },
    { text: " ", options: { fontSize: 6, breakLine: true } },
    { text: "Sensitivity: ", options: { bold: true } },
    { text: "the ranking is recomputed 200 times with varied weights to show how stable each square is." },
  ], { x: 9.6, y: 4.25, w: 3.13, h: 2.55, fontSize: 14 });
  s.addNotes(`The map tells us where the land changed; the ranking tells a team where to look first.

The area is divided into squares, usually 1 kilometre, and each gets a score from 0 to 100. The hazard part H combines how much of the square changed and how strong the change is. The exposure part E combines people from population maps, important places such as hospitals and schools from OpenStreetMap, and main roads.

The score multiplies them: 100 times H to the power a, times E to the power one minus a, with a equal to 0.5 by default. Multiplying means a square needs both change and exposure to score high; with a sum, a crowded square with no change at all could rank high.

Categories are Critical from 70, High from 50, Moderate from 30, otherwise Low.

Two safeguards. The life-safety rule: if a hospital, clinic, fire or ambulance station or shelter lies inside the detected change and the detection is reasonably confident, the square is at least High, whatever the average says. And the sensitivity analysis recomputes the ranking 200 times with randomly varied weights and reports how stable each square's rank and category are. The weights are documented judgements, visible and adjustable in the settings, and this analysis shows how much the result depends on them.`);
}

// ---------------------------------------------------------------- 12 Architecture
{
  const s = content(S_HOW, "Architecture and the agent");
  framed(s, DIAG("architecture.png"), MX, TOP - 0.05, 7.6, 5.35, "Architecture diagram: browser application, API server, job manager, agent, data sources and storage.", { frame: false, align: "left" });
  const pts = [
    ["Browser", "React and TypeScript; MapLibre maps; polls a running check every 2 s."],
    ["Server", "FastAPI with strict validation; checks run in two background worker threads."],
    ["Agent", "A 10-step plan, 5 specialists, 20 tools and 8 written rules (P0-P9). No language model decides."],
    ["Storage", "SQLite or PostgreSQL with PostGIS; files per check; saved image windows."],
  ];
  pts.forEach(([h, d], i) => {
    const y = TOP + i * 1.3;
    card(s, 8.55, y, 4.18, 1.15, C.background2);
    txt(s, h, { x: 8.75, y: y + 0.12, w: 3.8, h: 0.35, fontSize: 16, bold: true, color: C.accent1 });
    txt(s, d, { x: 8.75, y: y + 0.47, w: 3.85, h: 0.65, fontSize: 13 });
  });
  s.addNotes(`Technically, AegisEO has three parts.

The browser application is written in React and TypeScript and shows maps with MapLibre, an open-source map library that needs no commercial key. While a check runs, it asks the server for the status every two seconds.

The server is a Python FastAPI application. It validates every request strictly, keeps the database, and runs checks in the background on two worker threads, so the interface stays responsive.

Inside each check runs the agent. "Agent" here means a program that has a goal, makes a plan, carries it out by calling tools, checks each result and adapts, while recording everything. The plan has ten steps; five specialists do the work: data acquisition, perception, impact, prioritisation and reporting. They can act only through 20 registered tools, each classified by its side effect, and their choices follow eight written rules, numbered P0 to P9. There is deliberately no language model making decisions: the same inputs always give the same decisions, and every decision is recorded with its rule.

Storage is SQLite on a single computer or PostgreSQL with PostGIS in the Docker set-up, plus a folder of result files per check and a cache of downloaded image windows, which is why repeat checks take seconds.`);
}

// ---------------------------------------------------------------- 13 Safety checks
pres.addSection({ title: S_SAFE });
{
  const s = content(S_SAFE, "18 safety checks between the steps");
  const stages = [
    ["Request", "G01-G03", ["Supported disaster type", "Area size", "Valid dates"]],
    ["Data", "G04-G09", ["'After' image exists", "'Before' reference", "At most 60 days apart", "Radar orbits match", "Optical cloud", "Newest image's age"]],
    ["Detection", "G10-G15", ["Model available", "Input like training data", "Plausible extent", "Confidence", "Terrain removals", "Landslides: always a person"]],
    ["Text", "G16-G17", ["Every number grounded in evidence", "Cautious, non-directive wording"]],
    ["Action", "G18", ["Named approver", "Never practice data"]],
  ];
  const gw = (CW - 4 * 0.25) / 5;
  stages.forEach(([h, codes, list], i) => {
    const x = MX + i * (gw + 0.25);
    card(s, x, TOP, gw, 3.35, C.background2);
    txt(s, h, { x: x + 0.2, y: TOP + 0.2, w: gw - 0.4, h: 0.4, fontSize: 18, bold: true, color: C.accent1 });
    txt(s, codes, { x: x + 0.2, y: TOP + 0.6, w: gw - 0.4, h: 0.3, fontSize: 13, color: HEX.muted });
    txt(s, list.map((l, j) => ({ text: l, options: { bullet: { indent: 14 }, breakLine: j < list.length - 1, paraSpaceAfter: 4 } })), { x: x + 0.15, y: TOP + 1.0, w: gw - 0.3, h: 2.3, fontSize: 14 });
  });
  const outs = [["Pass", C.accent6, "nothing to report"], ["Note", C.accent4, "the result stands"], ["Finding", C.accent3, "a person must look"], ["Block", C.accent5, "stopped or withheld"]];
  const ow = CW / 4;
  outs.forEach(([o, col, d], i) => {
    const x = MX + i * ow;
    chip(s, o, x, 5.1, 1.1, col, C.background1, 0.38, 13);
    txt(s, d, { x: x + 1.25, y: 5.1, w: ow - 1.35, h: 0.38, fontSize: 14, valign: "middle" });
  });
  card(s, MX, 5.75, CW, 0.95, HEX.tealTint, HEX.tealTint);
  txt(s, [
    { text: "Example, Sindh 2022: ", options: { bold: true, color: C.accent1 } },
    { text: "G11 made a finding (the 'before' image's band B12 was 3.29 standard deviations from the training data), and G06 added a note (the optical images were 65 days apart)." },
  ], { x: MX + 0.25, y: 5.75, w: CW - 0.5, h: 0.95, fontSize: 15, valign: "middle" });
  s.addNotes(`Between the steps of the plan, the agent runs 18 safety checks. Each is a small function with a documented threshold, and each is unit-tested.

Request checks, G01 to G03: is the disaster type supported, is the area within the size limit, are the dates valid.

Data checks, G04 to G09: is there an "after" image, a "before" reference, are they less than 60 days apart, do the radar orbits match, how cloudy is the optical image, and is the newest image more than 10 days old for a recent event.

Detection checks, G10 to G15: is the trained model available, does the input look like the training data, is the detected area implausibly large, more than 60% of the area, is the confidence too low, did the terrain rule remove many detections, and every landslide result always goes to a person.

Text checks: G16 requires every number, date and citation in a drafted text to match recorded evidence, and G17 blocks casualty language and orders such as "evacuate now".

And G18 controls publication.

Each check ends in one of four outcomes, shown at the bottom: pass; a note, where the result stands but the user should read something; a finding, where a person must look; or a block, where the action is stopped or the text withheld.`);
}

// ---------------------------------------------------------------- 14 Human review
{
  const s = content(S_SAFE, "A person decides");
  framed(s, DIAG("review.png"), MX, TOP + 0.05, 9.0, 3.75, "Diagram of findings and draft warnings waiting for a person's decision.", { frame: false, align: "left" });
  framed(s, SHOT("21-draft-warning-decide.jpg"), 10.05, TOP + 0.05, 2.68, 5.25, "A draft warning from a practice run with its evidence and the approve and reject decisions.", { align: "right" });
  const pts = [
    ["Findings: ", "Looks right · It's wrong · Noted · Run it again, with an optional note."],
    ["Draft warnings: ", "approved or rejected by a named person; never sent automatically."],
    ["By construction: ", "the agent cannot run an external tool; only the approval route can, with the approver's name."],
  ];
  txt(s, pts.map(([b, t], i) => [{ text: b, options: { bold: true } }, { text: t, options: { breakLine: i < pts.length - 1, paraSpaceAfter: 6 } }]).flat(), { x: MX, y: 5.4, w: 9.1, h: 1.4, fontSize: 15 });
  s.addNotes(`This is the human-in-the-loop part, and in my view the most important design decision.

Two kinds of item wait for a person. A finding is created when a safety check escalates, or when a Critical or High square has low confidence. The reviewer compares the evidence and chooses: "Looks right", "It's wrong", which lowers the square and rejects its waiting warnings, "Noted", or "Run it again".

Draft warnings are short, evidence-based messages, for example about a hospital inside the flooded area. The screenshot shows one from a practice run, with "Numbers checked", meaning it passed G16. A named person approves or rejects it. If a delivery channel, a webhook, is configured, an approved warning is sent; on this demonstration server there is none, so it is kept in AegisEO, and the button text says so.

This is enforced in code, not just in documentation. The agent's tool executor only permits read-only, compute and draft tools. The only tool that can contact the outside world is not even registered for the agent; only the approval route registers it and passes the approver's name. Then G18 blocks publication of practice data or without an approver. Benchmark probes test exactly this.

One honest detail: with sign-in disabled, as in this local demonstration, the recorded name is a fixed "local-analyst"; for real use, sign-in must be on.`);
}

// ---------------------------------------------------------------- 15 What is real
pres.addSection({ title: S_EVID });
{
  const s = content(S_EVID, "What is real, and what is not");
  const head = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.accent1 } } });
  const rows = [
    [head("Kind"), head("Examples in AegisEO"), head("Shown as")],
    ["Real observations", "Sentinel-1 and -2 images; GDACS, USGS and NASA FIRMS alerts; rainfall; OpenStreetMap", "Dates, image IDs and catalogue links"],
    ["Real but fixed estimates", "Population maps (2015-2020), terrain height, long-term water, land cover (2021)", "\"An estimate\", with source and year"],
    ["Derived by AegisEO", "Probabilities, detected areas, people potentially exposed, scores, texts", "Every number traceable to the record"],
    ["Simulated", "Practice runs and the 12 benchmark scenes", "Violet \"Practice data\"; never publishable"],
  ];
  s.addTable(rows, {
    x: MX, y: TOP, w: 7.65, colW: [1.95, 3.6, 2.1], fontSize: 13, color: THEME.colors.dk1, valign: "middle",
    border: { type: "solid", pt: 0.75, color: HEX.line }, fill: { color: THEME.colors.lt1 }, rowH: [0.45, 0.95, 0.95, 0.95, 0.95], margin: 0.08,
  });
  framed(s, SHOT("50-data-sources.jpg"), 8.55, TOP + 0.05, 4.18, 2.7, "Data sources page listing every source with its live status.", { align: "right" });
  txt(s, "The Data sources page now contacts every service before saying \"Working\" (fixed in this round). Nothing is invented: a failed source is shown as missing and lowers the confidence.", { x: 8.55, y: 4.45, w: 4.18, h: 1.9, fontSize: 14 });
  s.addNotes(`An examiner's most important question about a data project is: is this real? This slide is my answer.

Real observations: the Sentinel images from the public archive, live alerts from GDACS, USGS and NASA FIRMS, rainfall from Open-Meteo, and OpenStreetMap. Each image is listed with its identifier and a link to its catalogue record.

Real but fixed estimates: population maps from 2015 to 2020, terrain height, the long-term water record and land cover from 2021. They are shown as estimates with source and year.

Derived by AegisEO: probabilities, detected areas, people potentially exposed, scores and texts. Every number in every text is checked against the recorded evidence.

Simulated: practice runs and the benchmark scenes. They are labelled in violet everywhere, warning titles start with "SIMULATED", and they can never be published.

In this round I found that the Data sources page was not fully honest: NASA FIRMS was shown as "Working" without ever being contacted, and four status checks could answer from a cache up to 30 days old. Now every status check contacts the service. And nothing is ever invented: if a source fails during a check, that factor is shown as missing and the confidence goes down.`);
}

// ---------------------------------------------------------------- 16 Tests
{
  const s = content(S_EVID, "Tested at every level");
  const stats = [
    ["93", "backend tests, all passing, one against the real image catalogue"],
    ["32", "frontend unit tests: texts, limits and accessibility"],
    ["7", "end-to-end tests in a real browser, desktop and phone"],
    ["12/12", "benchmark scenarios with known answers, including outages"],
    ["8/8", "safety probes: attempts to break the rules"],
    ["19/19", "measured interface checks of this round's changes"],
  ];
  const gw = (CW - 2 * 0.3) / 3, gh = 2.2;
  stats.forEach(([v, l], i) => {
    const x = MX + (i % 3) * (gw + 0.3), y = TOP + Math.floor(i / 3) * (gh + 0.3);
    card(s, x, y, gw, gh, C.background2);
    txt(s, v, { x: x + 0.3, y: y + 0.25, w: gw - 0.6, h: 0.95, fontSize: 48, bold: true, color: C.accent1 });
    txt(s, l, { x: x + 0.3, y: y + 1.3, w: gw - 0.6, h: 0.9, fontSize: 15 });
  });
  txt(s, "All run on 8 November 2026. Python and TypeScript checks are clean and the production build succeeds.", { x: MX, y: 6.42, w: CW, h: 0.35, fontSize: 13, color: HEX.muted });
  s.addNotes(`How do I know it works? I give three separate answers: the code, the model, and the system.

The code: 93 backend tests pass, covering every safety-check threshold, the score formula, scene selection, the HTTP client's retries and cache, and complete checks on practice scenes; one test searches the real image catalogue. 32 frontend unit tests check that the plain-language texts only use numbers from the result and that the wizard blocks exactly what the API would reject. 7 end-to-end tests drive a real browser through the whole journey on desktop and phone sizes.

The model: the accuracy results I showed earlier.

The system: the agent benchmark runs 12 practice scenarios with known answers, including a cloud-covered flood, outages of OpenStreetMap and the population service, mismatched radar orbits, an impossible date and a missing model. All 12 pass, and the agent asked for a person in exactly the three scenarios where it should. The 8 safety probes try to make it send an unapproved warning, use an unregistered tool, exceed its budget, or publish practice data; all are blocked.

For this round's changes, a script measured 19 behaviours in the running application, for example that the expanded map covers exactly the window. Everything was re-run on 8 November.`);
}

// ---------------------------------------------------------------- 17 Real disasters
{
  const s = content(S_EVID, "Five real disasters");
  const head = (t) => ({ text: t, options: { bold: true, color: C.background1, fill: { color: C.accent1 } } });
  const rows = [
    [head("Check"), head("Found"), head("Outcome and reason")],
    ["Sindh floods, 2022", "78.2 km² new water; 7,274 people", "Needs review: unusual dry-soil input (G11)"],
    ["Emilia-Romagna, 2023", "31.6 km²; 4 important places inside", "Completed with a note"],
    ["Palisades Fire, 2025", "53.9 km² burned; 2 Critical squares", "Needs review: 63% of the area burned (G12)"],
    ["Wayanad landslides, 2024", "4.7 km² of candidates", "Needs review: Low confidence; landslide rule (G15)"],
    ["Derna flash flood, 2023", "0.03 km²", "Water gone before the first radar pass; reported honestly"],
  ];
  s.addTable(rows, {
    x: MX, y: TOP, w: 8.1, colW: [2.25, 2.75, 3.1], fontSize: 13, color: THEME.colors.dk1, valign: "middle",
    border: { type: "solid", pt: 0.75, color: HEX.line }, fill: { color: THEME.colors.lt1 }, rowH: [0.45, 0.82, 0.82, 0.82, 0.82, 0.82], margin: 0.08,
  });
  framed(s, SHOT("37-wildfire-result.jpg"), 9.0, TOP + 0.05, 3.73, 2.35, "Result page of the Palisades Fire check.", { align: "right" });
  txt(s, "Palisades Fire, January 2025: the burn scar with Critical squares.", { x: 9.0, y: 4.05, w: 3.73, h: 0.6, fontSize: 13, color: HEX.muted });
  txt(s, "First checks took 5 to 10 minutes, mostly downloading images; repeats took seconds.", { x: 9.0, y: 4.85, w: 3.73, h: 1.2, fontSize: 15 });
  s.addNotes(`The five case studies were run on the real system with real images.

Sindh 2022: 78 square kilometres of new water and about 7,300 people potentially exposed. It needed review because of G11: the dry, bright soil before the monsoon looks unlike anything in the training data. The map looks plausible, but a person should look, and that is exactly what the system asks.

Emilia-Romagna 2023: 32 square kilometres with four important places inside, completed with a note.

Palisades Fire 2025: 54 square kilometres burned and two Critical squares. G12 asked for review because 63% of the area burned, above its 60% plausibility limit. Here the limit was cautious rather than wrong, because the case-study area was drawn tightly around the fire. The checks are designed to fail on the safe side.

Wayanad 2024: landslide candidates with low confidence under monsoon cloud, several reasons for review.

Derna 2023 found almost nothing. The dams failed in the night of 10 to 11 September, the water rushed to the sea, and the first radar image came a day and a half later. AegisEO reported almost nothing instead of inventing a flood. That is a real limitation of satellite flood mapping, and the case study is there to show it.`);
}

// ---------------------------------------------------------------- 18 Improvements A-H
pres.addSection({ title: S_ROUND });
{
  const s = content(S_ROUND, "Improvements made in this round");
  const items = [
    ["A", "Area limit investigated", "Kept at 1,500 km² after measurement; explained in the wizard; read from the server."],
    ["B", "Review and approval explained", "What a finding and a draft warning are, and what happens after each decision."],
    ["C", "Satellite tip rewritten", "Revisit times and search periods explained for beginners, checked against the data."],
    ["D", "Expandable map", "Area picker and result map fill the window on every screen size."],
    ["E", "Original icon restored", "Logo and favicon recovered from the Git history, not redrawn."],
    ["F", "Search box removed", "\"Have a question?\" removed; report citations unchanged."],
    ["G", "Settings renamed", "\"Detection and ranking settings\", each with its effect and default."],
    ["H", "Wording reviewed", "No metaphors; complete sentences; texts checked against the code."],
  ];
  const gw = (CW - 3 * 0.25) / 4, gh = 2.4;
  items.forEach(([l, h, d], i) => {
    const x = MX + (i % 4) * (gw + 0.25), y = TOP + Math.floor(i / 4) * (gh + 0.25);
    card(s, x, y, gw, gh, C.background2);
    circle(s, l, x + 0.2, y + 0.2, 0.44, C.accent1, 15);
    txt(s, h, { x: x + 0.78, y: y + 0.2, w: gw - 0.95, h: 0.6, fontSize: 15, bold: true, valign: "middle" });
    txt(s, d, { x: x + 0.2, y: y + 0.95, w: gw - 0.4, h: 1.35, fontSize: 14 });
  });
  s.addNotes(`This round had eight requested improvements.

A: the 1,500 square kilometre limit. I investigated where it is implemented and what it costs, and ran a 1,450 square kilometre check: it took under four minutes but at 30-metre pixels instead of 20. So the limit is a reasonable, configurable processing budget, not a satellite limit. I kept it, explained it in the wizard, and the interface now reads it from the server through a new endpoint, so it can never contradict the backend.

B: review, findings, warnings and approval are now explained where they appear, including what happens after each decision.

C: the confusing satellite tip was rewritten for beginners and checked against the code and real revisit times.

D: an expandable map that fills the window on any screen and keeps zoom and layers.

E: the original logo and favicon were recovered from the Git history.

F: the "Have a question?" search box was removed; the knowledge base still supplies citations in reports.

G: "Expert settings" became "Detection and ranking settings", with each setting explained with its default.

H: all wording reviewed: no metaphors such as "satellite eyes", complete sentences, and every text checked against what the code does.`);
}

// ---------------------------------------------------------------- 19 Fixes
{
  const s = content(S_ROUND, "Problems found and fixed");
  const items = [
    ["Dishonest status labels", "FIRMS shown as working without a request; cached answers up to 30 days old. Now every status check contacts the service."],
    ["Offline population bug", "Offline mode skipped the saved population layer: 42,776 people instead of 7,248. Cache now checked first."],
    ["Late failure on weights", "All weights of a group set to 0 failed only after the downloads. Now blocked at once (HTTP 422)."],
    ["Broken fresh builds", "A .gitignore rule hid a file the interface needs. Rule anchored to the top-level data folder."],
    ["Hidden map trap", "Animations left a CSS transform that would have trapped the full-window map. Removed."],
    ["Texts versus code", "Wrong figures for image age, alert box size and run time corrected; 5 backend and 2 frontend tests added."],
  ];
  const gw = (CW - 0.3) / 2, gh = 1.62;
  items.forEach(([h, d], i) => {
    const x = MX + (i % 2) * (gw + 0.3), y = TOP + Math.floor(i / 2) * (gh + 0.17);
    card(s, x, y, gw, gh, C.background2);
    circle(s, i + 1, x + 0.2, y + 0.22, 0.42, C.accent3, 14);
    txt(s, h, { x: x + 0.8, y: y + 0.2, w: gw - 1.0, h: 0.45, fontSize: 16, bold: true, valign: "middle" });
    txt(s, d, { x: x + 0.8, y: y + 0.7, w: gw - 1.0, h: 0.85, fontSize: 14 });
  });
  s.addNotes(`Inspecting the code and the running application also found real problems, which I fixed and covered with tests.

One: the Data sources page said "Working" for NASA FIRMS without ever contacting it, and four other checks could answer from a cached copy up to 30 days old. Now every status check really contacts the service.

Two, found while preparing the demonstration fallback: in offline mode, the population function refused its high-resolution layer before looking in its cache, so an offline re-run of Sindh reported 42,776 people instead of 7,248. The source was labelled correctly, but the number was six times less precise. The cache is now checked first, and the same offline re-run gives the identical result in 8 seconds.

Three: a ranking with all hazard weights set to zero was accepted and failed only at the very end, after all downloads. Now the wizard blocks it with an explanation and the API rejects it.

Four: a dot-gitignore rule also matched a data file the interface imports, so a fresh copy of the repository could not build. The rule now applies only to the top-level folder.

Five: a CSS animation detail that would have trapped the full-window map.

Six: several texts contradicted the code, for example the image-age check and the run-time estimate. They now say what the code does.`);
}

// ---------------------------------------------------------------- 20 Limitations
{
  const s = content(S_ROUND, "Limitations, stated plainly");
  card(s, MX, TOP, 5.85, 4.0, C.background2);
  card(s, MX + 6.28, TOP, 5.85, 4.0, C.background2);
  card(s, MX, 5.75, CW, 0.95, HEX.tealTint, HEX.tealTint);
  txt(s, [
    { text: "Example, Derna 2023: ", options: { bold: true, color: C.accent1 } },
    { text: "the dams failed in the night of 10-11 September; the first radar image (12 September, 16:30 UTC) showed almost no standing water, and AegisEO reported 0.03 km² instead of inventing a flood." },
  ], { x: MX + 0.25, y: 5.75, w: CW - 0.5, h: 0.95, fontSize: 15, valign: "middle" });
  const method = ["Only change visible at a satellite pass: fast floods can be missed (Derna).", "Water under trees and between tall buildings is hard to see.", "No flood depth, building damage or casualty estimates.", "Only the flood method is evaluated against expert maps.", "Population (2015-2020) and OpenStreetMap are incomplete."];
  const soft = ["One server with two worker threads; no shared job queue.", "Sign-in off by default: decisions are then recorded as \"local-analyst\".", "Two settings have no effect (run time limit, uncertainty-sample default).", "Training images (Level-1C) differ from the images used (Level-2A); reduced, not removed.", "This round's changes are not yet committed to Git."];
  [["Limits of the method", method], ["Known software issues", soft]].forEach(([h, list], i) => {
    const x = MX + i * 6.28;
    txt(s, h, { x: x + 0.3, y: TOP + 0.25, w: 5.3, h: 0.45, fontSize: 19, bold: true, color: i ? C.accent3 : C.accent1 });
    txt(s, list.map((l, j) => ({ text: l, options: { bullet: { indent: 14 }, breakLine: j < list.length - 1, paraSpaceAfter: 7 } })), { x: x + 0.3, y: TOP + 0.85, w: 5.3, h: 3.05, fontSize: 15 });
  });
  s.addNotes(`I want to be explicit about what AegisEO cannot do, because an honest description of limits is part of a correct description of the system.

Limits of the method. Satellites only see what is there when they pass, so fast-draining flash floods like Derna can be missed. Water under dense trees or between tall buildings is hard to see with 10 to 20 metre pixels. It does not estimate depth, damage or casualties. Only the flood method has a trained and evaluated model; wildfire and landslide use standard index rules checked on case studies. And the population and map data are incomplete and partly old.

Known software issues. It runs on one server with two worker threads; several servers would need a shared job queue. Sign-in is off by default, so in a local demonstration decisions are recorded under the fixed name "local-analyst"; for real use, sign-in must be on. Two settings exist but have no effect on a check: the run time limit and the default number of uncertainty samples. The model was trained on Level-1C optical images but runs on Level-2A; conversion and training-time brightness variation reduce this gap but do not remove it. And the changes of this round still have to be committed.

All of this is listed in the documentation, chapter 14.`);
}

// ---------------------------------------------------------------- 21 Future
{
  const s = content(S_ROUND, "Possible future work");
  chip(s, "Not implemented: proposals only", MX, 1.32, 3.6, C.accent4, C.background1, 0.36, 13);
  const cols = [
    ["Engineering", ["Enforce a time limit per check", "Shared job queue for several servers", "Split large regions automatically", "More delivery channels, still after approval"]],
    ["Methods", ["Evaluate wildfire and landslide methods against expert maps", "A multi-month radar baseline", "Flooded towns and vegetation", "Rough flood depth from terrain"]],
    ["Data and people", ["Building footprints and newer population data", "Learning from reviewers' corrections, with specialist checking", "A study with real emergency responders"]],
  ];
  const gw = (CW - 2 * 0.3) / 3;
  cols.forEach(([h, list], i) => {
    const x = MX + i * (gw + 0.3);
    card(s, x, 1.95, gw, 3.55, C.background2);
    txt(s, h, { x: x + 0.3, y: 2.2, w: gw - 0.6, h: 0.45, fontSize: 19, bold: true, color: C.accent1 });
    txt(s, list.map((l, j) => ({ text: l, options: { bullet: { indent: 14 }, breakLine: j < list.length - 1, paraSpaceAfter: 9 } })), { x: x + 0.3, y: 2.8, w: gw - 0.6, h: 2.6, fontSize: 15 });
  });
  card(s, MX, 5.75, CW, 0.95, HEX.tealTint, HEX.tealTint);
  txt(s, [
    { text: "First, with one more month: ", options: { bold: true, color: C.accent1 } },
    { text: "evaluate the wildfire method against public burn-severity maps, then the multi-month radar baseline. Both address measured weaknesses." },
  ], { x: MX + 0.25, y: 5.75, w: CW - 0.5, h: 0.95, fontSize: 15, valign: "middle" });
  s.addNotes(`Everything on this slide is a proposal. None of it exists in AegisEO today, and none of it is shown in the screenshots.

Engineering: enforce an overall time limit per check; a shared job queue so several servers can share the work; automatic splitting of large regions into tiles with one merged ranking; and more delivery channels for approved warnings, always after approval by a named person, exactly as today.

Methods: evaluate the wildfire and landslide methods against public burn-severity maps and landslide inventories, so that they get the same kind of accuracy table as floods; use several months of radar images as the baseline instead of one "before" image, which would reduce seasonal false alarms; detect flooded towns and vegetation, where radar brightens instead of darkening; and a rough flood depth from the terrain model.

Data and people: building footprints and newer population data for exposure; using reviewers' corrections, after checking by a specialist, to recalibrate the model, never automatic retraining from single clicks; and, most importantly, a study with real emergency responders to find out which explanations work.

If I had one more month, I would start with the wildfire evaluation and the radar baseline, because both address measured weaknesses.`);
}

// ---------------------------------------------------------------- 22 Close
{
  const s = pres.addSlide({ masterName: "AegisEO Section", sectionTitle: S_ROUND });
  s.addText("The software prepares; a person decides", { placeholder: "title" });
  s.addText([
    { text: "Free radar and optical images turned into a ranked, explained map.", options: { bullet: { indent: 14 }, breakLine: true } },
    { text: "Measured accuracy, stated confidence, and evidence for every number.", options: { bullet: { indent: 14 }, breakLine: true } },
    { text: "Safety checks and approvals enforced in code, not only in documentation.", options: { bullet: { indent: 14 } } },
  ], { placeholder: "body" });
  txt(s, "Questions are welcome. Documentation, viva answers and screenshots: docs/deliverables", { x: 0.7, y: 5.75, w: 11.9, h: 0.5, fontSize: 16, color: HEX.onDark });
  s.addNotes(`To conclude, three points.

First, AegisEO turns free radar and optical satellite images into a ranked, explained map of where a disaster changed the land and who is there, in minutes instead of hours or days.

Second, it is honest about what it knows: the flood model is measured on unseen data, every result states its confidence, and every number links back to its evidence.

Third, the most important design decision: the software prepares and a person decides, and that is enforced in code. The agent cannot contact the outside world, a warning needs a named approver, and every decision is recorded.

The full documentation, a viva question-and-answer document and all screenshots are in the docs/deliverables folder of the repository.

Thank you. I am happy to take questions, and I can also show any part of the system live.`);
}

// ------------------------------------------------------------------ write + theme
// pptxgenjs writes the fonts of pres.theme but always Office's default colour palette, so the scheme colours used above
// would show as Office blue and orange. This writes THEME's colours into the theme part and applies two package fixes:
// pptxgenjs writes <c:crossesAt val="autoZero"/> (crossesAt takes a number; the keyword belongs in <c:crosses>), and
// a ZIP entry per folder, which is not a package part. It also refuses a colour that is not six hex digits.
async function finishDeck(file, theme) {
  const JSZip = require(require.resolve("jszip", { paths: [path.dirname(require.resolve("pptxgenjs"))] }));
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const slots = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  for (const k of slots) if (!/^[0-9A-F]{6}$/i.test(theme.colors[k])) throw new Error(`theme colour ${k} must be six hex digits`);
  const scheme = `<a:clrScheme name="${theme.name}">` + slots.map((k) => `<a:${k}><a:srgbClr val="${theme.colors[k].toUpperCase()}"/></a:${k}>`).join("") + "</a:clrScheme>";
  const part = "ppt/theme/theme1.xml";
  const xml = (await zip.file(part).async("string"))
    .replace(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/, () => scheme)
    .replace(/(<a:(?:theme|fontScheme)\b[^>]*?\bname=")[^"]*"/g, (_, head) => `${head}${theme.name}"`);
  if (!xml.includes(scheme)) throw new Error("no colour scheme found in " + part);
  zip.file(part, xml);
  for (const name of Object.keys(zip.files)) {
    if (zip.files[name].dir) { delete zip.files[name]; continue; }
    if (!name.endsWith(".xml") || name === part) continue;
    const x = await zip.file(name).async("string");
    if (/<a:srgbClr val="(?![0-9A-Fa-f]{6}")/.test(x)) throw new Error(`${name}: a colour is not six hex digits (a scheme colour given to a hex-only option)`);
    if (x.includes('<c:crossesAt val="autoZero"/>')) zip.file(name, x.split('<c:crossesAt val="autoZero"/>').join('<c:crosses val="autoZero"/>'));
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

(async () => {
  await pres.writeFile({ fileName: OUT });
  await finishDeck(OUT, THEME);
  console.log("wrote " + OUT);
})().catch((e) => { console.error(e); process.exit(1); });
