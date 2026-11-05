# UI design system

AegisEO is built for two audiences at once: people who have never used a satellite tool, and
specialists who need every number and its evidence. The interface is **simple on the surface and
complete underneath**: plain words and one clear next step first, full technical detail one click
away. Light theme only (a product requirement: bright and calm, never dark or gloomy).

Tokens live in `frontend/src/styles/tokens.css`, components in `frontend/src/styles/global.css`,
the vocabulary in `frontend/src/lib/meta.tsx` and the plain-language text engine in
`frontend/src/lib/plain.ts` (unit tested in `plain.test.ts`).

## Principles

1. **Say what it is, then what to do.** Every page opens with a plain heading and one sentence;
   the next action is always visible (and repeated right where the user just acted).
2. **Guide, don't quiz.** "Check a place" is a four-step wizard (Where, What, When, Start) with a
   guide panel that explains the current step, recaps every choice with a *Change* link and says
   what happens next. Choices are pre-filled from case studies and live alerts; validation
   messages say how to fix the problem.
3. **Plain words, true words.** Copy is written for a curious 12-year-old but never changes the
   meaning: each phrase in `meta.tsx` / `plain.ts` was checked against the backend code that
   produces the value. Exposure is never called impact ("people living there - not people hurt").
4. **Progressive disclosure.** Technical detail (method, model version, guardrail codes, the full
   agent trace, expert settings) sits behind `<details>` disclosures, never in the way.
5. **Only working controls.** Settings appear only when the chosen method uses them (e.g. the
   flood probability threshold is hidden for wildfires, which use a dNBR threshold instead).
6. **Evidence and uncertainty stay visible.** Confidence is explained in words, safety-check notes
   are listed with reasons, and confidence never silently lowers a priority.
7. **Practice data is unmistakable.** Violet "Practice data" chips and banners on every view;
   practice warnings can never be sent.
8. **Never colour alone.** Priority and status always carry a word (and usually an icon).

## Plain-language vocabulary

| Internal term | Shown to people as |
|---|---|
| Analysis | A *check*; finished checks are *results* |
| AOI / bounding box | *Area* (with a size picture: "like a square about 15 km on each side") |
| Hazard | *Kind of disaster* (Flood, Wildfire, Landslide) |
| Pre / post-event window | *'Before' / 'after' photo search* |
| Sentinel-1 SAR / Sentinel-2 optical | *Radar photo* / *camera photo* |
| Response cell | *Priority square* |
| Exposure / potentially exposed | *People living there (an estimate - not people hurt)* |
| Critical facilities | *Important places* (hospitals, schools, emergency services...) |
| Settlements | *Villages and towns* (drawn separately from important places) |
| Escalation / HITL review task | *Needs a person to check*; *unsure finding* |
| Alert | *Draft warning* (only sent after a person approves it) |
| Guardrail | *Safety check* (plain title + why, with the code in the technical detail) |
| Synthetic / simulated | *Practice data* / *practice run* |
| IoU | *Overlap* (explained where it is shown) |

## Visual language: "calm atlas"

| Role | Value |
|---|---|
| Background (paper) / surface | `#f7f5f0` / `#ffffff`, hairline borders `#e6e1d6` |
| Ink (primary / secondary / muted) | `#15213b` / `#3c4860` / `#5c677a` (all >= 4.5:1 on paper and surface) |
| Primary action | ink-navy buttons; teal accent `#0f6b66` for links, progress and selection |
| Hazards | flood `#1f6fd1`, wildfire `#d9480f`, landslide `#8a5a2b` (each with a soft tint) |
| Display type | Newsreader (variable, optical sizes) for headings - an editorial, trustworthy voice |
| UI type | Inter (variable); body 17 px / 1.6, never below 14 px; fluid headings 36-56 px |
| Shapes | 8-28 px radii, pill buttons (min 46 px tall, 38 px small), soft shadows only on hover |
| Signature | faint contour lines behind the home and about pages; real Sentinel imagery as the main visual |

Imagery is always real and credited: the home and about pages use four panels rendered from a
completed analysis of the 2022 Sindh floods by `backend/scripts/make_explainer_images.py`
(before photo, after photo, detected water, priority squares). Illustrations (radar vs camera,
"a person stays in charge") are inline SVG in the same line style.

## Layout and navigation

* Five task-based destinations: **Home, Check a place, Results, To review, About**. A top bar on
  wide screens; a bottom tab bar on phones (with the review count badge).
* Old addresses redirect (`/analyze`, `/analyses/:id`, `/model`, `/sources`, `/methodology`).
* Result page: the short answer and key numbers first, then a sticky map beside a panel with four
  tabs (Where to help first, People & places, How we know, Needs your OK). On wide screens the
  panel scrolls on its own beside the map.
* Pages other than Home load on demand, so the 285 kB (gzip) map library is not part of the first
  visit.

## Data colours (validated)

Validated with the data-visualisation palette checker (OKLab Delta E x 100, light surface):

* **Factor contributions** (stacked bars, 5 series) use categorical slots in fixed order:
  `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`, `#e87ba4` - worst adjacent CVD Delta E 9.1,
  normal-vision 19.6 (pass); three light hues are below 3:1 contrast, so values are always
  printed as text and every chart has a table view.
* **Sensor conditions** (grouped bars, 4 series): the first four slots - pass.
* **Response priority** is a severity scale, not a series: Critical `#c62828`, High `#ef6c00`,
  Moderate `#e9b308`, Low `#2a9d8f` (teal, so "low" reads as calm rather than "safe").
  All-pairs CVD Delta E >= 11.1 and normal-vision >= 15.8 (pass). The same palette is used by the
  map, the explainer images and the PDF report; text on tinted chips uses darker inks for contrast.
* **Map ramps**: flood probability single-hue blue (light -> dark); burn severity the
  conventional dNBR heat ramp with a legend; SAR change diverging blue <-> red with a neutral
  centre; uncertainty yellow -> red.

## Charts

Hand-written SVG (no chart library): bars <= 24 px with 4 px rounded data ends, 2 px surface
gaps in stacks, hairline solid grids, selective direct labels (e.g. the rainfall peak), legends
for >= 2 series, hover and keyboard-focus tooltips, and a "Show table" alternative so no value is
tooltip-only.

## Motion

Short, purposeful transitions: page fade-up, wizard steps slide in the direction of travel,
progress stages pulse while running, cards lift on hover, the home image sweeps from "before" to
"after". `prefers-reduced-motion` disables CSS animation and the SVG (SMIL) animations, which are
gated in code because CSS cannot stop them.

## Accessibility

Semantic landmarks (named navigation, main, complementary guide), skip link, focus moved to the
content on navigation and to the step heading in the wizard, visible focus rings, keyboard-operable
tabs (arrow keys, Home/End), sliders, map (arrow keys / + -) and the before/after divider, a
focus-trapped dialog, `aria-live` status for wizard validation and toasts, plain error messages
with a fix, and no horizontal scrolling at phone width (verified by the Playwright mobile test).
