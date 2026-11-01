# UI design system

A bright, calm, light-only interface (by product requirement: no dark or gloomy theme) built
for analysts and non-specialists alike. Tokens live in `frontend/src/styles/tokens.css`.

## Principles

1. **Evidence first** - every number has a definition (info tips), a source and, where it is an
   estimate, the word "estimate" or "potentially".
2. **Uncertainty is visible** - confidence chips, uncertainty meters and "verify before acting"
   banners; confidence never silently lowers a priority.
3. **Simulated data is unmistakable** - violet "Simulated data" chips and banners on every view.
4. **Progressive disclosure** - a three-step wizard with sensible defaults; advanced parameters
   and the full agent trace are one click away, not in the way.
5. **Never colour alone** - priority and status always carry an icon and a text label.

## Tokens

| Role | Value |
|---|---|
| Background / surface | `#f4f7fa` / `#ffffff` |
| Ink (primary / secondary / muted) | `#0f1b2d` / `#3c4a5e` / `#66758a` |
| Brand | ocean teal `#0e7490` with a teal -> sky -> indigo gradient for the logo and progress |
| Typography | Plus Jakarta Sans (headings), Inter (UI and numbers), self-hosted via @fontsource |
| Radii / elevation | 6-20 px radii; three soft shadows |

## Data colours (validated)

Validated with the data-visualisation palette checker (OKLab Delta E x 100, light surface `#fcfcfb`):

* **Factor contributions** (stacked bars, 5 series) use categorical slots in fixed order:
  `#2a78d6`, `#eb6834`, `#1baf7a`, `#eda100`, `#e87ba4` - worst adjacent CVD Delta E 9.1,
  normal-vision 19.6 (pass); three light hues are below 3:1 contrast, so values are always
  printed as text and every chart has a table view.
* **Sensor conditions** (grouped bars, 4 series): the first four slots - pass.
* **Response priority** is a severity scale, not a series: Critical `#c62828`, High `#ef6c00`,
  Moderate `#e9b308`, Low `#2a9d8f` (teal, so "low" reads as calm rather than "safe").
  All-pairs CVD Delta E >= 11.1 and normal-vision >= 15.8 (pass); the yellow sits above the
  categorical lightness band like the reference warning colour, mitigated by the mandatory
  icon + label.
* **Map ramps**: flood probability single-hue blue (light -> dark); burn severity the
  conventional dNBR heat ramp with a legend; SAR change diverging blue <-> red with a neutral
  centre; uncertainty yellow -> red.

## Charts

Hand-written SVG (no chart library): bars <= 24 px with 4 px rounded data ends, 2 px surface
gaps in stacks, hairline solid grids, selective direct labels (e.g. the rainfall peak), legends
for >= 2 series, hover and keyboard-focus tooltips, and a "Show table" alternative so no value is
tooltip-only. The priority distribution is a tall segmented bar whose in-block labels render
only when they fit.

## Accessibility

Semantic landmarks (named primary navigation, main, regions), skip link, visible focus rings,
keyboard-operable tabs, sliders and the before/after divider, `aria-label`s on icon buttons and
charts, live regions for toasts, reduced-motion support, and no horizontal scrolling at 390 px
(verified by the Playwright mobile test).
