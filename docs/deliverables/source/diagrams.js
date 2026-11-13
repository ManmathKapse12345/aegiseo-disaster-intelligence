/*
 * AegisEO documentation diagrams.
 *
 * A tiny SVG renderer shared by the project documentation (PDF), the viva document and the slide images, so every
 * picture of the system is drawn from one description. Every box and arrow describes real code; the file or rule it
 * stands for is named in the comment above each diagram.
 *
 * Usage in a page:  <div class="diagram" data-diagram="architecture"></div>  (rendered on DOMContentLoaded)
 */
(function () {
  const C = {
    ink: "#15213b", ink2: "#3c4860", ink3: "#5c677a", line: "#b9b2a3", paper: "#f7f5f0", white: "#ffffff",
    accent: "#0f6b66", accentSoft: "#e2f1ee", flood: "#1f6fd1", floodSoft: "#e8f0fb",
    warn: "#b45309", warnSoft: "#fdf1e3", danger: "#b42318", dangerSoft: "#fdecea", ok: "#1e7a3e", okSoft: "#e6f4ea",
    violet: "#6d28d9", violetSoft: "#f1ebfd", amber: "#c98a00",
  };
  const KIND = {
    ui: [C.floodSoft, C.flood], api: ["#eef0f6", C.ink], core: [C.white, C.ink2], agent: [C.accentSoft, C.accent],
    ext: ["#fbfaf7", C.ink3], store: ["#f1efe8", C.ink2], human: [C.warnSoft, C.warn], ok: [C.okSoft, C.ok],
    warn: [C.warnSoft, C.warn], danger: [C.dangerSoft, C.danger], note: ["#fffdf6", C.line], muted: ["#f5f5f3", "#9c968c"],
    practice: [C.violetSoft, C.violet], dark: [C.ink, C.ink],
  };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const FONT = "Inter, 'Segoe UI', Arial, sans-serif";

  function textBlock(cx, cy, title, sub, color, align, x0) {
    const tl = title ? String(title).split("\n") : [];
    const sl = sub ? String(sub).split("\n") : [];
    const lhT = 15.5, lhS = 13;
    const total = tl.length * lhT + sl.length * lhS;
    let y = cy - total / 2 + 11.5;
    const anchor = align === "left" ? "start" : "middle";
    const x = align === "left" ? x0 : cx;
    let out = "";
    for (const t of tl) { out += `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="13" font-weight="650" fill="${color}">${esc(t)}</text>`; y += lhT; }
    for (const t of sl) { out += `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="10.8" fill="${color === C.white ? "#dfe5f0" : C.ink3}">${esc(t)}</text>`; y += lhS; }
    return out;
  }

  function node(n) {
    const [fill, stroke] = KIND[n.k || "core"];
    const dash = n.dash ? ` stroke-dasharray="5 4"` : "";
    let s = "";
    if (n.k === "store") {
      const e = 9;
      s += `<path d="M${n.x} ${n.y + e} v${n.h - 2 * e} a${n.w / 2} ${e} 0 0 0 ${n.w} 0 v${-(n.h - 2 * e)}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;
      s += `<ellipse cx="${n.x + n.w / 2}" cy="${n.y + e}" rx="${n.w / 2}" ry="${e}" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;
      s += textBlock(n.x + n.w / 2, n.y + n.h / 2 + 5, n.t, n.s, C.ink, n.align, n.x + 12);
      return s;
    }
    const r = n.r ?? 10;
    s += `<rect x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${n.bw ?? 1.4}"${dash}/>`;
    if (n.badge) {
      s += `<circle cx="${n.x + 16}" cy="${n.y + 16}" r="11" fill="${stroke}"/>`;
      s += `<text x="${n.x + 16}" y="${n.y + 20}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${esc(n.badge)}</text>`;
    }
    s += textBlock(n.x + n.w / 2, n.y + n.h / 2, n.t, n.s, n.k === "dark" ? C.white : C.ink, n.align, n.x + 12);
    return s;
  }

  function anchor(n, side) {
    switch (side) {
      case "r": return [n.x + n.w, n.y + n.h / 2];
      case "l": return [n.x, n.y + n.h / 2];
      case "t": return [n.x + n.w / 2, n.y];
      case "b": return [n.x + n.w / 2, n.y + n.h];
      default: return [n.x + n.w / 2, n.y + n.h / 2];
    }
  }
  function autoSides(a, b) {
    const dx = (b.x + b.w / 2) - (a.x + a.w / 2), dy = (b.y + b.h / 2) - (a.y + a.h / 2);
    if (Math.abs(dx) * 0.6 > Math.abs(dy)) return dx > 0 ? ["r", "l"] : ["l", "r"];
    return dy > 0 ? ["b", "t"] : ["t", "b"];
  }

  function edge(e, nodes, uid) {
    const a = nodes[e.a], b = nodes[e.b];
    const [as0, bs0] = autoSides(a, b);
    const p1 = e.from || anchor(a, e.as || as0), p2 = e.to || anchor(b, e.bs || bs0);
    let pts = [p1];
    if (e.via) pts = pts.concat(e.via);
    else {
      const as = e.as || as0, bs = e.bs || bs0;
      const horiz = as === "r" || as === "l";
      if (horiz && Math.abs(p1[1] - p2[1]) > 1 && (bs === "l" || bs === "r")) {
        const xm = e.xm ?? (p1[0] + p2[0]) / 2; pts.push([xm, p1[1]], [xm, p2[1]]);
      } else if (!horiz && Math.abs(p1[0] - p2[0]) > 1 && (bs === "t" || bs === "b")) {
        const ym = e.ym ?? (p1[1] + p2[1]) / 2; pts.push([p1[0], ym], [p2[0], ym]);
      } else if (horiz && (bs === "t" || bs === "b")) pts.push([p2[0], p1[1]]);
      else if (!horiz && (bs === "l" || bs === "r")) pts.push([p1[0], p2[1]]);
    }
    pts.push(p2);
    const color = e.c || C.ink2;
    const d = "M" + pts.map((p) => p.join(" ")).join(" L");
    let s = `<path d="${d}" fill="none" stroke="${color}" stroke-width="${e.w ?? 1.5}"${e.d ? ' stroke-dasharray="6 4"' : ""} marker-end="url(#ah-${uid}-${e.d ? "m" : "n"})"${e.both ? ` marker-start="url(#as-${uid})"` : ""}/>`;
    if (e.l) {
      let lx, ly;
      if (e.lp) [lx, ly] = e.lp;
      else {
        const i = Math.floor((pts.length - 1) / 2);
        lx = (pts[i][0] + pts[i + 1][0]) / 2; ly = (pts[i][1] + pts[i + 1][1]) / 2;
      }
      const lines = e.l.split("\n");
      const w = Math.max(...lines.map((t) => t.length)) * 5.9 + 10, h = lines.length * 12.5 + 5;
      s += `<rect x="${lx - w / 2}" y="${ly - h / 2}" width="${w}" height="${h}" rx="4" fill="${C.white}" opacity="0.94"/>`;
      lines.forEach((t, k) => { s += `<text x="${lx}" y="${ly - h / 2 + 13 + k * 12.5}" text-anchor="middle" font-size="10.3" font-style="italic" fill="${C.ink2}">${esc(t)}</text>`; });
    }
    return s;
  }

  function group(g) {
    const stroke = g.c || "#a49d8f";
    let s = `<rect x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="14" fill="${g.fill || "none"}" stroke="${stroke}" stroke-width="1.2" stroke-dasharray="${g.solid ? "0" : "4 4"}"/>`;
    if (g.l) s += `<text x="${g.x + 14}" y="${g.y + 20}" font-size="11.5" font-weight="700" letter-spacing="0.03em" fill="${C.ink3}">${esc(g.l.toUpperCase())}</text>`;
    return s;
  }

  function freeText(t) {
    return String(t.t).split("\n").map((line, i) => `<text x="${t.x}" y="${t.y + i * (t.lh || 14)}" text-anchor="${t.a || "start"}" font-size="${t.size || 11}" font-weight="${t.weight || 400}" font-style="${t.italic ? "italic" : "normal"}" fill="${t.c || C.ink2}">${esc(line)}</text>`).join("");
  }

  let uidCounter = 0;
  function render(spec) {
    const uid = `d${++uidCounter}`;
    const nodes = {};
    (spec.nodes || []).forEach((n) => { nodes[n.id] = n; });
    (spec.groups || []).forEach((g) => { if (g.id) nodes[g.id] = g; });
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.w} ${spec.h}" font-family="${FONT}" role="img" aria-label="${esc(spec.title || "")}">`;
    s += `<defs>
      <marker id="ah-${uid}-n" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="${C.ink2}"/></marker>
      <marker id="ah-${uid}-m" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#8a8478"/></marker>
      <marker id="as-${uid}" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M10 0 L0 5 L10 10z" fill="${C.ink2}"/></marker>
    </defs>`;
    s += `<rect width="${spec.w}" height="${spec.h}" fill="${C.white}"/>`;
    (spec.groups || []).forEach((g) => { s += group(g); });
    (spec.edges || []).forEach((e) => { s += edge(e, nodes, uid); });
    (spec.nodes || []).forEach((n) => { s += node(n); });
    (spec.texts || []).forEach((t) => { s += freeText(t); });
    if (spec.extra) s += spec.extra(C);
    return s + "</svg>";
  }

  // ------------------------------------------------------------------ sequence diagrams
  function sequence(spec) {
    const uid = `d${++uidCounter}`;
    const n = spec.parts.length, left = 86, right = spec.w - 70, step = (right - left) / (n - 1);
    const X = Object.fromEntries(spec.parts.map((p, i) => [p.id, left + i * step]));
    let y = 88;
    const rows = [];
    for (const m of spec.msgs) { rows.push({ ...m, y }); y += m.gap || 40; }
    const H = y + 20;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${spec.w} ${H}" font-family="${FONT}" role="img" aria-label="${esc(spec.title || "")}">`;
    s += `<defs><marker id="sq-${uid}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="${C.ink2}"/></marker></defs>`;
    s += `<rect width="${spec.w}" height="${H}" fill="#fff"/>`;
    for (const p of spec.parts) {
      const x = X[p.id];
      const [fill, stroke] = KIND[p.k || "core"];
      s += `<line x1="${x}" y1="58" x2="${x}" y2="${H - 10}" stroke="#c9c1ae" stroke-dasharray="4 4"/>`;
      s += `<rect x="${x - 62}" y="12" width="124" height="44" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/>`;
      s += textBlock(x, 34, p.t, p.s, C.ink, "center", x);
    }
    for (const m of rows) {
      if (m.note) {
        const x1 = X[m.from], x2 = X[m.to || m.from];
        const xa = Math.min(x1, x2) - 50, w = Math.abs(x2 - x1) + 100;
        s += `<rect x="${xa}" y="${m.y - 14}" width="${w}" height="24" rx="6" fill="${C.warnSoft}" stroke="${C.warn}" stroke-width="1"/>`;
        s += `<text x="${xa + w / 2}" y="${m.y + 2}" text-anchor="middle" font-size="10.5" fill="${C.ink}">${esc(m.note)}</text>`;
        continue;
      }
      const x1 = X[m.from], x2 = X[m.to];
      if (m.from === m.to) {
        s += `<path d="M${x1} ${m.y} h40 v16 h-38" fill="none" stroke="${C.ink2}" stroke-width="1.4" marker-end="url(#sq-${uid})"/>`;
        s += `<text x="${x1 + 48}" y="${m.y + 4}" font-size="10.6" fill="${C.ink}">${esc(m.t)}</text>`;
        continue;
      }
      s += `<line x1="${x1}" y1="${m.y}" x2="${x2}" y2="${m.y}" stroke="${C.ink2}" stroke-width="1.4"${m.d ? ' stroke-dasharray="6 4"' : ""} marker-end="url(#sq-${uid})"/>`;
      const lx = (x1 + x2) / 2;
      const lines = m.t.split("\n");
      lines.forEach((t, k) => {
        const ty = m.y - 7 - (lines.length - 1 - k) * 12;
        const tw = t.length * 5.7 + 10;
        s += `<rect x="${lx - tw / 2}" y="${ty - 10.5}" width="${tw}" height="14" rx="3" fill="#fff" opacity="0.95"/>`;
        s += `<text x="${lx}" y="${ty}" text-anchor="middle" font-size="10.6" fill="${C.ink}">${esc(t)}</text>`;
      });
      if (m.num) s += `<circle cx="24" cy="${m.y}" r="9" fill="${C.accent}"/><text x="24" y="${m.y + 3.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">${m.num}</text>`;
    }
    return s + "</svg>";
  }

  // ------------------------------------------------------------------ revisit timeline (real archive dates, Sindh 2022)
  function revisit() {
    // Dates recorded by the agent's search_imagery tool calls for the Sindh 2022 case study (data/aegis.db, run 4be689e1)
    // and confirmed by the live archive check in the wizard on 8 Nov 2026.
    const W = 1000, H = 344;
    const panels = [
      { x: 178, w: 452, from: "2022-06-01", to: "2022-07-05", title: "'BEFORE' SEARCH  1 Jun - 5 Jul 2022" },
      { x: 690, w: 278, from: "2022-08-26", to: "2022-09-10", title: "'AFTER' SEARCH  26 Aug - 10 Sep 2022" },
    ];
    const rows = [
      { y: 95, label: "Radar, orbit track 42", color: C.accent, dates: ["2022-06-04", "2022-06-16", "2022-06-28", "2022-08-27", "2022-09-08"], used: ["2022-06-28", "2022-08-27"] },
      { y: 150, label: "Radar, second track", color: "#4b8f8a", dates: ["2022-06-07", "2022-06-19", "2022-07-01", "2022-08-30"], used: [] },
      { y: 205, label: "Optical, Sentinel-2A and 2B", color: C.flood, dates: ["2022-06-02", "2022-06-05", "2022-06-07", "2022-06-10", "2022-06-12", "2022-06-17", "2022-06-20", "2022-06-22", "2022-06-27", "2022-06-30", "2022-07-02", "2022-07-05", "2022-08-26", "2022-08-29", "2022-08-31", "2022-09-03", "2022-09-05", "2022-09-08", "2022-09-10"], used: ["2022-06-27", "2022-08-31"] },
    ];
    const t = (d) => Date.parse(d + "T00:00:00Z");
    const xOf = (d) => { for (const p of panels) { if (t(d) >= t(p.from) && t(d) <= t(p.to)) return p.x + (t(d) - t(p.from)) / (t(p.to) - t(p.from)) * p.w; } return null; };
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="${FONT}" role="img" aria-label="Real satellite passes over the Sindh case-study area in 2022">`;
    s += `<rect width="${W}" height="${H}" fill="#fff"/>`;
    for (const p of panels) {
      s += `<rect x="${p.x - 8}" y="44" width="${p.w + 16}" height="200" rx="10" fill="${C.paper}" stroke="#ddd6c8"/>`;
      s += `<text x="${p.x}" y="34" font-size="11.5" font-weight="700" fill="${C.ink3}">${p.title}</text>`;
      // weekly ticks
      for (let d = t(p.from); d <= t(p.to); d += 86400000) {
        const dt = new Date(d); const day = dt.getUTCDate();
        const x = p.x + (d - t(p.from)) / (t(p.to) - t(p.from)) * p.w;
        if (day % 5 === 0 || day === 1) s += `<line x1="${x}" y1="238" x2="${x}" y2="244" stroke="#b5ae9f"/>`;
        if (day === 1 || day === 10 || day === 20 || d === t(p.from)) {
          s += `<line x1="${x}" y1="234" x2="${x}" y2="244" stroke="#7d776c"/>`;
          s += `<text x="${x}" y="258" text-anchor="middle" font-size="10" fill="${C.ink3}">${day} ${dt.toLocaleString("en", { month: "short", timeZone: "UTC" })}</text>`;
        }
      }
    }
    // event line
    const ex = xOf("2022-08-26");
    s += `<line x1="${ex}" y1="44" x2="${ex}" y2="244" stroke="${C.danger}" stroke-width="2"/><text x="${ex + 4}" y="58" font-size="10.5" font-weight="700" fill="${C.danger}">event date</text>`;
    for (const r of rows) {
      s += `<text x="12" y="${r.y + 4}" font-size="10.8" font-weight="650" fill="${C.ink}">${esc(r.label.split(",")[0])}</text>`;
      if (r.label.includes(",")) s += `<text x="12" y="${r.y + 18}" font-size="10" fill="${C.ink3}">${esc(r.label.split(",")[1].trim())}</text>`;
      for (const p of panels) s += `<line x1="${p.x}" y1="${r.y}" x2="${p.x + p.w}" y2="${r.y}" stroke="#e3ddd0"/>`;
      for (const d of r.dates) {
        const x = xOf(d); if (x == null) continue;
        const used = r.used.includes(d);
        s += `<circle cx="${x}" cy="${r.y}" r="${used ? 7.5 : 5.2}" fill="${r.color}" stroke="${used ? C.ink : "#fff"}" stroke-width="${used ? 2.4 : 1.2}"/>`;
      }
    }
    // 12-day annotations on track 42
    const a1 = xOf("2022-06-04"), a2 = xOf("2022-06-16"), a3 = xOf("2022-06-28");
    s += `<path d="M${a1} 78 Q${(a1 + a2) / 2} 64 ${a2} 78" fill="none" stroke="${C.accent}" stroke-width="1.2"/><text x="${(a1 + a2) / 2}" y="66" text-anchor="middle" font-size="10" fill="${C.accent}">12 days</text>`;
    s += `<path d="M${a2} 78 Q${(a2 + a3) / 2} 64 ${a3} 78" fill="none" stroke="${C.accent}" stroke-width="1.2"/><text x="${(a2 + a3) / 2}" y="66" text-anchor="middle" font-size="10" fill="${C.accent}">12 days</text>`;
    const b1 = xOf("2022-08-27"), b2 = xOf("2022-09-08");
    s += `<path d="M${b1} 78 Q${(b1 + b2) / 2} 64 ${b2} 78" fill="none" stroke="${C.accent}" stroke-width="1.2"/><text x="${(b1 + b2) / 2}" y="66" text-anchor="middle" font-size="10" fill="${C.accent}">12 days</text>`;
    // legend
    s += `<circle cx="80" cy="292" r="7.5" fill="${C.accent}" stroke="${C.ink}" stroke-width="2.4"/><text x="94" y="296" font-size="10.8" fill="${C.ink}">image AegisEO used (radar: same track 42 before and after; optical: clearest)</text>`;
    s += `<circle cx="560" cy="292" r="5.2" fill="#9aa5b8"/><text x="572" y="296" font-size="10.8" fill="${C.ink}">other image found in the archive</text>`;
    s += `<text x="80" y="318" font-size="10.3" fill="${C.ink3}">Only Sentinel-1A was operating in 2022, so each radar track repeated every 12 days; two overlapping tracks gave a radar image every 3 to 9 days.</text>`;
    s += `<text x="80" y="333" font-size="10.3" fill="${C.ink3}">Optical images (tile cloud below 80%) existed every 2 to 3 days, because Sentinel-2A and 2B pass on different days and orbits overlap here.</text>`;
    return s + "</svg>";
  }

  // ==================================================================== the diagrams
  const D = {};

  // System components and how they talk - backend/aegis/main.py, api/, jobs.py, agents/, sources/, net/http.py; frontend/src
  D.architecture = { w: 1000, h: 660, title: "AegisEO system architecture",
    groups: [
      { x: 16, y: 16, w: 220, h: 628, l: "In the browser" },
      { id: "server", x: 296, y: 16, w: 428, h: 470, l: "AegisEO server (one Python process)" },
      { id: "storage", x: 296, y: 512, w: 428, h: 132, l: "Storage on the server" },
      { id: "ext", x: 748, y: 16, w: 236, h: 628, l: "Free public data services" },
      { id: "opt", x: 758, y: 474, w: 216, h: 160, l: "Optional, off here", c: "#c9c1ae" },
    ],
    nodes: [
      { id: "ui", x: 30, y: 44, w: 192, h: 152, k: "ui", t: "Web interface", s: "React + TypeScript + MapLibre\nHome · Check a place\nResults · To review · About\ndownloads: PDF, CSV, GeoJSON\nfrontend/src" },
      { id: "person", x: 30, y: 262, w: 192, h: 100, k: "human", t: "Person using AegisEO", s: "chooses place, disaster\nand dates; double-checks\nfindings; approves or\nrejects draft warnings" },
      { id: "api", x: 314, y: 72, w: 180, h: 96, k: "api", t: "REST API (FastAPI)", s: "validates input · roles\nrate limit · ~38 endpoints" },
      { id: "jobs", x: 314, y: 196, w: 180, h: 80, k: "core", t: "Job manager", s: "background threads\n(2 checks at a time)" },
      { id: "orch", x: 518, y: 56, w: 186, h: 110, k: "agent", t: "Agent orchestrator", s: "goal · 10-step plan · state\n18 safety checks · findings\ndraft warnings" },
      { id: "tools", x: 518, y: 196, w: 186, h: 84, k: "agent", t: "Tool executor", s: "20 tools · allow-list\nside-effect policy · budget" },
      { id: "ml", x: 314, y: 304, w: 180, h: 84, k: "core", t: "Detection and ranking", s: "PyTorch flood model\nindices · exposure · scores" },
      { id: "http", x: 518, y: 310, w: 186, h: 84, k: "core", t: "Resilient HTTP client", s: "timeouts · retries · circuit\nbreaker · cache · offline mode" },
      { id: "kb", x: 314, y: 408, w: 180, h: 62, k: "muted", t: "Method knowledge base", s: "6 documents · TF-IDF search" },
      { id: "db", x: 314, y: 540, w: 180, h: 92, k: "store", t: "Database", s: "SQLite (default) or\nPostgreSQL + PostGIS\n13 tables" },
      { id: "files", x: 518, y: 540, w: 186, h: 92, k: "store", t: "Artefact files", s: "map layers (PNG) · GeoTIFF\nPDF · CSV · GeoJSON" },
      { id: "pc", x: 766, y: 50, w: 200, h: 104, k: "ext", t: "Microsoft Planetary Computer", s: "Sentinel-1 radar · Sentinel-2\noptical · height (DEM) · water\nand land-cover maps (STAC)" },
      { id: "pop", x: 766, y: 166, w: 200, h: 62, k: "ext", t: "Population maps", s: "HRSL (AWS) · WorldPop API" },
      { id: "osm", x: 766, y: 240, w: 200, h: 62, k: "ext", t: "OpenStreetMap", s: "Overpass · Nominatim search" },
      { id: "feeds", x: 766, y: 314, w: 200, h: 62, k: "ext", t: "Live feeds", s: "GDACS · USGS · NASA FIRMS" },
      { id: "meteo", x: 766, y: 388, w: 200, h: 56, k: "ext", t: "Rain archive", s: "Open-Meteo (ERA5)" },
      { id: "llm", x: 772, y: 502, w: 188, h: 52, k: "muted", dash: true, t: "Claude API", s: "optional summary wording" },
      { id: "hook", x: 772, y: 568, w: 188, h: 52, k: "muted", dash: true, t: "Webhook", s: "receives approved warnings" },
    ],
    edges: [
      { a: "person", b: "ui", as: "t", bs: "b", l: "uses" },
      { a: "ui", b: "api", from: [222, 120], to: [314, 120], both: true, l: "JSON over\nHTTP", lp: [266, 120] },
      { a: "api", b: "jobs", as: "b", bs: "t" },
      { a: "jobs", b: "orch", from: [494, 222], via: [[510, 222], [510, 100]], to: [518, 100] },
      { a: "orch", b: "tools", as: "b", bs: "t" },
      { a: "tools", b: "ml", from: [518, 262], via: [[502, 262], [502, 346]], to: [494, 346] },
      { a: "tools", b: "http", as: "b", bs: "t" },
      { a: "http", b: "ext", from: [704, 352], to: [748, 352], l: "HTTPS", lp: [726, 338] },
      { a: "http", b: "opt", from: [611, 394], via: [[611, 448], [740, 448], [740, 540]], to: [758, 540], d: true, l: "only if configured", lp: [668, 448] },
      { a: "server", b: "storage", from: [510, 486], to: [510, 512] },
    ],
    texts: [{ x: 522, y: 504, t: "every step, result and decision is saved", size: 10.3, italic: true, c: "#5c677a" }],
  };

  // What a person does, page by page - frontend/src/pages
  D.journey = { w: 1000, h: 300, title: "The user's journey through AegisEO",
    nodes: [
      { id: "home", x: 6, y: 30, w: 124, h: 118, k: "ui", badge: "1", t: "Home", s: "choose what\nto do" },
      { id: "where", x: 148, y: 30, w: 124, h: 118, k: "ui", badge: "2", t: "Where", s: "past disaster,\nlive alert or\nany place" },
      { id: "what", x: 290, y: 30, w: 124, h: 118, k: "ui", badge: "3", t: "What", s: "flood, wildfire\nor landslide" },
      { id: "when", x: 432, y: 30, w: 124, h: 118, k: "ui", badge: "4", t: "When", s: "event date sets\n'before' and\n'after' searches" },
      { id: "start", x: 574, y: 30, w: 124, h: 118, k: "ui", badge: "5", t: "Start", s: "summary and\noptional settings" },
      { id: "run", x: 716, y: 30, w: 124, h: 118, k: "agent", badge: "6", t: "Progress", s: "5 stages on the\nserver; you can\nleave the page" },
      { id: "result", x: 858, y: 30, w: 136, h: 118, k: "ok", badge: "7", t: "Result", s: "short answer,\nmap, 4 tabs" },
      { id: "review", x: 574, y: 196, w: 196, h: 86, k: "human", badge: "8", t: "To review", s: "double-check findings,\napprove or reject warnings" },
      { id: "dl", x: 806, y: 196, w: 188, h: 86, k: "muted", badge: "9", t: "Download", s: "PDF · CSV · GeoJSON\nGeoTIFF" },
    ],
    edges: [
      { a: "home", b: "where" }, { a: "where", b: "what" }, { a: "what", b: "when" }, { a: "when", b: "start" }, { a: "start", b: "run" }, { a: "run", b: "result" },
      { a: "result", b: "review", from: [900, 148], via: [[900, 172], [672, 172]], to: [672, 196] },
      { a: "result", b: "dl", from: [940, 148], to: [940, 196] },
    ],
    texts: [{ x: 6, y: 186, t: "Steps 2-5 are the \"Check a place\" wizard. A guide panel\nbeside it explains each step and recaps every choice.\nPractice runs skip steps 3 and 4 (fixed scene).", size: 11, lh: 15 }],
  };

  // The agent's 10-step plan and where the safety checks sit - agents/orchestrator.py _plan(), run()
  D.pipeline = { w: 1000, h: 470, title: "The agent's plan for every check",
    nodes: [
      { id: "s1", x: 20, y: 80, w: 168, h: 92, k: "agent", badge: "1", t: "Validate", s: "area, dates, disaster\nchecks G01-G03" },
      { id: "s2", x: 216, y: 80, w: 168, h: 92, k: "agent", badge: "2", t: "Recall", s: "earlier checks of this\narea and corrections" },
      { id: "s3", x: 412, y: 80, w: 168, h: 92, k: "agent", badge: "3", t: "Acquire", s: "search, choose and\ndownload images + maps" },
      { id: "s4", x: 608, y: 80, w: 168, h: 92, k: "agent", badge: "4", t: "Data checks", s: "clouds, orbits, gaps\nchecks G04-G09" },
      { id: "s5", x: 804, y: 80, w: 176, h: 92, k: "agent", badge: "5", t: "Perceive", s: "detect change\n(model + indices)" },
      { id: "s6", x: 804, y: 250, w: 176, h: 92, k: "agent", badge: "6", t: "Result checks", s: "uncertainty, extent,\nunusual scene G10-G15" },
      { id: "s7", x: 608, y: 250, w: 168, h: 92, k: "agent", badge: "7", t: "Impact", s: "people, important\nplaces, roads, land" },
      { id: "s8", x: 412, y: 250, w: 168, h: 92, k: "agent", badge: "8", t: "Prioritise", s: "score every square,\nsensitivity test" },
      { id: "s9", x: 216, y: 250, w: 168, h: 92, k: "agent", badge: "9", t: "Report", s: "draft warnings (G16,\nG17) and findings" },
      { id: "s10", x: 20, y: 250, w: 168, h: 92, k: "agent", badge: "10", t: "Deliver", s: "map layers, PDF,\nCSV and GeoJSON" },
      { id: "rej", x: 20, y: 6, w: 168, h: 46, k: "danger", t: "Rejected", s: "invalid request" },
      { id: "insuf", x: 608, y: 6, w: 168, h: 46, k: "danger", t: "No usable images", s: "insufficient_data" },
      { id: "out", x: 20, y: 390, w: 960, h: 62, k: "ok", t: "Outcome: Done · Done, with notes · Needs a person to check", s: "(or Something went wrong · Stopped · Interrupted) - the status is never a silent success" },
    ],
    edges: [
      { a: "s1", b: "s2" }, { a: "s2", b: "s3" }, { a: "s3", b: "s4" }, { a: "s4", b: "s5" }, { a: "s5", b: "s6", as: "b", bs: "t" },
      { a: "s6", b: "s7" }, { a: "s7", b: "s8" }, { a: "s8", b: "s9" }, { a: "s9", b: "s10" }, { a: "s10", b: "out", as: "b", bs: "t", from: [104, 342], to: [104, 390] },
      { a: "s1", b: "rej", as: "t", bs: "b", c: "#b42318", l: "block", lp: [140, 66] },
      { a: "s4", b: "insuf", as: "t", bs: "b", c: "#b42318", l: "block (G04)", lp: [730, 66] },
    ],
  };

  // Safety-check outcomes and what each one causes - agents/guardrails.py, orchestrator._guard/_escalate
  D.outcomes = { w: 1000, h: 400, title: "What a safety check can result in",
    nodes: [
      { id: "g", x: 16, y: 150, w: 190, h: 100, k: "agent", t: "18 safety checks", s: "run automatically during\nevery check (G01-G18)" },
      { id: "pass", x: 300, y: 14, w: 210, h: 74, k: "ok", t: "Passed", s: "condition satisfied" },
      { id: "warn", x: 300, y: 112, w: 210, h: 74, k: "note", t: "Note (warn)", s: "recorded, no action needed" },
      { id: "esc", x: 300, y: 210, w: 210, h: 74, k: "human", t: "Needs a person (escalate)", s: "human judgement required" },
      { id: "block", x: 300, y: 308, w: 210, h: 74, k: "danger", t: "Stopped (block)", s: "something unsafe is refused" },
      { id: "r1", x: 600, y: 14, w: 384, h: 74, k: "core", align: "left", t: "Counted in the record", s: "visible under How we know > Safety checks" },
      { id: "r2", x: 600, y: 112, w: 384, h: 74, k: "core", align: "left", t: "Shown as a safety-check note on the result", s: "status at least \"Done, with notes\" (completed_with_warnings)" },
      { id: "r3", x: 600, y: 210, w: 384, h: 74, k: "core", align: "left", t: "A finding to double-check is created (To review)", s: "status \"Needs a person to check\" (needs_review)" },
      { id: "r4", x: 600, y: 308, w: 384, h: 74, k: "core", align: "left", t: "What is stopped depends on the check", s: "request rejected (G01-G03) · no usable images (G04)\nwarning text withheld (G16, G17) · not sent (G18)" },
    ],
    edges: [
      { a: "g", b: "pass", as: "r", bs: "l", xm: 252 }, { a: "g", b: "warn", as: "r", bs: "l", xm: 252 }, { a: "g", b: "esc", as: "r", bs: "l", xm: 252 }, { a: "g", b: "block", as: "r", bs: "l", xm: 252 },
      { a: "pass", b: "r1" }, { a: "warn", b: "r2" }, { a: "esc", b: "r3" }, { a: "block", b: "r4" },
    ],
  };

  // Findings to double-check (review tasks) - orchestrator._escalate(), actions.decide_review()
  D.review = { w: 1000, h: 416, title: "How a finding to double-check is created and resolved",
    nodes: [
      { id: "src1", x: 16, y: 40, w: 230, h: 86, k: "agent", t: "A safety check escalates", s: "G08 no radar under cloud · G10 · G11\nG12 · G13 · G15 (kind quality_check)" },
      { id: "src2", x: 16, y: 150, w: 230, h: 86, k: "agent", t: "Weak evidence on a top square", s: "Critical or High square with Low\nconfidence (kind verify_detection)" },
      { id: "open", x: 300, y: 94, w: 170, h: 86, k: "human", t: "Finding: open", s: "listed under To review;\ncheck = needs_review" },
      { id: "c", x: 540, y: 14, w: 200, h: 62, k: "ok", t: "Looks right", s: "confirm" },
      { id: "f", x: 540, y: 90, w: 200, h: 62, k: "danger", t: "It's wrong", s: "false_positive" },
      { id: "a", x: 540, y: 166, w: 200, h: 62, k: "note", t: "Noted", s: "acknowledge" },
      { id: "r", x: 540, y: 242, w: 200, h: 62, k: "ui", t: "Run it again", s: "request_rerun" },
      { id: "e1", x: 776, y: 14, w: 208, h: 62, k: "core", align: "left", t: "Results stay as they are", s: "decision and name saved" },
      { id: "e2", x: 776, y: 90, w: 208, h: 62, k: "core", align: "left", t: "Square set to Low;", s: "its waiting warnings rejected" },
      { id: "e3", x: 776, y: 166, w: 208, h: 62, k: "core", align: "left", t: "Marked as seen", s: "nothing else changes" },
      { id: "e4", x: 776, y: 242, w: 208, h: 62, k: "core", align: "left", t: "A fresh copy starts", s: "same place, dates, settings" },
      { id: "res", x: 300, y: 330, w: 440, h: 74, k: "ok", t: "Every decision resolves the finding", s: "audit log records who, when and the note\nlast open finding resolved → check becomes completed_with_warnings" },
      { id: "mem", x: 776, y: 330, w: 208, h: 70, k: "muted", t: "Remembered", s: "later checks of an overlapping\narea list the correction" },
    ],
    edges: [
      { a: "src1", b: "open", as: "r", bs: "l" }, { a: "src2", b: "open", as: "r", bs: "l" },
      { a: "open", b: "c", as: "r", bs: "l", xm: 505 }, { a: "open", b: "f", as: "r", bs: "l", xm: 505 }, { a: "open", b: "a", as: "r", bs: "l", xm: 505 }, { a: "open", b: "r", as: "r", bs: "l", xm: 505 },
      { a: "c", b: "e1" }, { a: "f", b: "e2" }, { a: "a", b: "e3" }, { a: "r", b: "e4" },
      { a: "r", b: "res", from: [640, 304], to: [640, 330] },
      { a: "res", b: "mem" },
    ],
  };

  // Draft warnings (alerts) - agents/narrative.build_alerts, ReportingAgent, actions.decide_alert, guardrails.check_publication
  D.alerts = { w: 1000, h: 440, title: "The life of a draft warning",
    nodes: [
      { id: "make", x: 16, y: 40, w: 220, h: 96, k: "agent", t: "Drafted after every check", s: "1 summary of the whole area\n+ 1 per Critical/High square\n(at most 5 squares)" },
      { id: "chk", x: 16, y: 170, w: 220, h: 96, k: "agent", t: "Text checks", s: "G16: every number and date\nmatches the measurements\nG17: careful, non-directive words" },
      { id: "held", x: 16, y: 300, w: 220, h: 70, k: "danger", t: "Text withheld", s: "replaced by a short notice" },
      { id: "wait", x: 300, y: 170, w: 190, h: 96, k: "human", t: "Waiting for approval", s: "pending_review\n(To review > Draft warnings)" },
      { id: "rej", x: 300, y: 330, w: 190, h: 70, k: "muted", t: "Rejected", s: "never sent · note saved" },
      { id: "g18", x: 550, y: 170, w: 190, h: 96, k: "agent", t: "G18 publication check", s: "named approver?\npractice data?\nvalid status?" },
      { id: "prac", x: 790, y: 20, w: 194, h: 76, k: "practice", t: "Approved, never sent", s: "practice data (G18 blocks)" },
      { id: "int", x: 790, y: 120, w: 194, h: 76, k: "ok", t: "Approved, kept in AegisEO", s: "no webhook set up (this PC)" },
      { id: "pub", x: 790, y: 220, w: 194, h: 76, k: "ok", t: "Approved and sent", s: "webhook POST succeeded\n(status published)" },
      { id: "fail", x: 790, y: 320, w: 194, h: 76, k: "warn", t: "Approved, sending failed", s: "error recorded on the warning" },
    ],
    edges: [
      { a: "make", b: "chk", as: "b", bs: "t" },
      { a: "chk", b: "held", as: "b", bs: "t", c: "#b42318", l: "fails" },
      { a: "chk", b: "wait", l: "passes" },
      { a: "held", b: "wait", from: [236, 335], via: [[268, 335], [268, 240]], to: [300, 240] },
      { a: "wait", b: "rej", as: "b", bs: "t", l: "Reject" },
      { a: "wait", b: "g18", l: "Approve" },
      { a: "g18", b: "prac", as: "r", bs: "l", xm: 765 }, { a: "g18", b: "int", as: "r", bs: "l", xm: 765 }, { a: "g18", b: "pub", as: "r", bs: "l", xm: 765 }, { a: "g18", b: "fail", as: "r", bs: "l", xm: 765 },
    ],
    texts: [{ x: 300, y: 428, t: "A finding marked \"It's wrong\" also rejects that square's waiting warnings automatically.", size: 10.8, italic: true }],
  };

  // Flood detection - analysis/hazards.py detect_flood(), ml/inference.py
  D.flood = { w: 1000, h: 520, title: "How a flood is detected",
    nodes: [
      { id: "post", x: 16, y: 30, w: 200, h: 70, k: "ui", t: "'After' images", s: "radar (VV, VH) + optical" },
      { id: "pre", x: 16, y: 130, w: 200, h: 70, k: "ui", t: "'Before' images", s: "radar + optical" },
      { id: "jrc", x: 16, y: 230, w: 200, h: 70, k: "ext", t: "Long-term water record", s: "JRC occurrence 1984-2021" },
      { id: "m1", x: 262, y: 30, w: 200, h: 70, k: "agent", t: "Flood model", s: "P(water after), uncertainty" },
      { id: "m2", x: 262, y: 130, w: 200, h: 70, k: "agent", t: "Same model", s: "P(water before)" },
      { id: "pf", x: 508, y: 80, w: 220, h: 80, k: "dark", t: "P(new water) =", s: "P(after) × (1 − P(before))" },
      { id: "perm", x: 508, y: 196, w: 220, h: 62, k: "core", t: "Remove permanent water", s: "JRC occurrence ≥ 80%" },
      { id: "terr", x: 508, y: 282, w: 220, h: 62, k: "core", t: "Remove impossible terrain", s: "> 15 m above drainage or > 8° slope" },
      { id: "thr", x: 508, y: 368, w: 220, h: 62, k: "core", t: "Threshold", s: "probability ≥ 0.5 (setting)" },
      { id: "mmu", x: 508, y: 454, w: 220, h: 56, k: "core", t: "Drop patches < 0.5 ha", s: "noise removal (setting)" },
      { id: "out", x: 780, y: 454, w: 204, h: 56, k: "ok", t: "Flooded area", s: "polygons, km², per pixel maps" },
      { id: "cor", x: 780, y: 196, w: 204, h: 104, k: "note", t: "Independent cross-check", s: "radar drop ≤ −3 dB (Lee-filtered)\nor optical MNDWI > 0 after\nand ≤ 0 before → agreement %" },
      { id: "g13", x: 780, y: 330, w: 204, h: 80, k: "human", t: "Safety check G13", s: "uncertainty > 0.15 or\nagreement < 55% → a person" },
    ],
    edges: [
      { a: "post", b: "m1" }, { a: "pre", b: "m2" },
      { a: "jrc", b: "pf", from: [216, 265], via: [[485, 265], [485, 145]], to: [508, 145], l: "if no 'before' image:\noccurrence used instead", lp: [350, 252] },
      { a: "m1", b: "pf", as: "r", bs: "l", xm: 485 }, { a: "m2", b: "pf", as: "r", bs: "l", xm: 485 },
      { a: "pf", b: "perm", as: "b", bs: "t" }, { a: "perm", b: "terr", as: "b", bs: "t" }, { a: "terr", b: "thr", as: "b", bs: "t" }, { a: "thr", b: "mmu", as: "b", bs: "t" },
      { a: "mmu", b: "out" },
      { a: "out", b: "cor", from: [882, 454], to: [882, 410], d: true },
      { a: "cor", b: "g13", as: "b", bs: "t" },
    ],
  };

  // Gated fusion network - ml/models.py GatedFusionUNet, ml/inference.py HybridSegmenter
  D.fusion = { w: 1000, h: 470, title: "The gated-fusion flood model",
    nodes: [
      { id: "s1", x: 16, y: 40, w: 210, h: 90, k: "ui", t: "Radar input", s: "VV, VH, VV−VH (dB)\n+ 'valid data' mask" },
      { id: "s2", x: 16, y: 230, w: 210, h: 90, k: "ui", t: "Optical input", s: "6 bands + NDWI, MNDWI\n+ 'valid data' mask (clouds)" },
      { id: "e1", x: 270, y: 40, w: 170, h: 90, k: "core", t: "Radar encoder", s: "4 scales\n(16-128 channels)" },
      { id: "e2", x: 270, y: 230, w: 170, h: 90, k: "core", t: "Optical encoder", s: "4 scales\n(16-128 channels)" },
      { id: "gate", x: 488, y: 120, w: 210, h: 120, k: "agent", t: "Gate at every scale", s: "g = sigmoid(conv(features,\nvalid masks))\nno optical → radar only\nno radar → optical only" },
      { id: "dec", x: 746, y: 120, w: 238, h: 120, k: "core", t: "Shared U-Net decoder", s: "skip connections · dropout\n→ water probability\n(temperature T = 1.66)" },
      { id: "mc", x: 746, y: 280, w: 238, h: 80, k: "note", t: "Monte-Carlo dropout", s: "6 passes → mean probability\nand spread (uncertainty)" },
      { id: "hyb", x: 488, y: 300, w: 210, h: 120, k: "agent", t: "Radar specialist (hybrid)", s: "where only radar observed a\npixel, a radar-only U-Net's\noutput is blended in" },
      { id: "rel", x: 746, y: 22, w: 238, h: 60, k: "muted", t: "Sensor-reliance map", s: "the gate, shown as a map layer" },
    ],
    edges: [
      { a: "s1", b: "e1" }, { a: "s2", b: "e2" },
      { a: "e1", b: "gate", as: "r", bs: "l", xm: 464 }, { a: "e2", b: "gate", as: "r", bs: "l", xm: 464 },
      { a: "gate", b: "dec" }, { a: "dec", b: "mc", as: "b", bs: "t" },
      { a: "hyb", b: "dec", from: [698, 360], via: [[722, 360], [722, 210]], to: [746, 210] },
      { a: "gate", b: "rel", from: [593, 120], via: [[593, 52]], to: [746, 52], d: true },
    ],
  };

  // Priority score - analysis/prioritize.py
  D.priority = { w: 1000, h: 430, title: "How a priority square is scored",
    nodes: [
      { id: "ext", x: 16, y: 20, w: 230, h: 60, k: "ui", t: "Share of square changed", s: "full at 50% (weight 0.55)" },
      { id: "int", x: 16, y: 96, w: 230, h: 60, k: "ui", t: "Strength of the change", s: "mean probability (weight 0.45)" },
      { id: "pop", x: 16, y: 190, w: 230, h: 60, k: "warn", t: "People in the changed part", s: "log scale, full at 5,000/km² (0.45)" },
      { id: "fac", x: 16, y: 266, w: 230, h: 60, k: "warn", t: "Important places", s: "inside or within 500 m (0.35)" },
      { id: "road", x: 16, y: 342, w: 230, h: 60, k: "warn", t: "Roads in the changed part", s: "full at 2 km per km² (0.20)" },
      { id: "H", x: 300, y: 50, w: 190, h: 76, k: "dark", t: "H = change found", s: "weighted mean (0-1)" },
      { id: "E", x: 300, y: 258, w: 190, h: 76, k: "dark", t: "E = people and places", s: "weighted mean (0-1)" },
      { id: "S", x: 540, y: 150, w: 210, h: 90, k: "agent", t: "Score = 100 × Hᵃ × E¹⁻ᵃ", s: "a = 0.5 by default\nno change or no exposure → 0" },
      { id: "cat", x: 800, y: 20, w: 184, h: 104, k: "core", t: "Category", s: "Critical ≥ 70\nHigh ≥ 50\nModerate ≥ 30\nLow below 30" },
      { id: "floor", x: 800, y: 144, w: 184, h: 86, k: "human", t: "Life-safety rule", s: "hospital, clinic, fire/\nambulance station or\nshelter inside → High" },
      { id: "conf", x: 800, y: 250, w: 184, h: 86, k: "note", t: "Confidence (separate)", s: "never lowers the score;\nLow + Critical/High\n→ finding to double-check" },
      { id: "sens", x: 540, y: 300, w: 210, h: 90, k: "muted", t: "Sensitivity test", s: "weights varied 200 times →\nrank range, category stability" },
    ],
    edges: [
      { a: "ext", b: "H", as: "r", bs: "l", xm: 272 }, { a: "int", b: "H", as: "r", bs: "l", xm: 272 },
      { a: "pop", b: "E", as: "r", bs: "l", xm: 272 }, { a: "fac", b: "E", as: "r", bs: "l", xm: 272 }, { a: "road", b: "E", as: "r", bs: "l", xm: 272 },
      { a: "H", b: "S", as: "r", bs: "l", xm: 515 }, { a: "E", b: "S", as: "r", bs: "l", xm: 515 },
      { a: "S", b: "cat", as: "r", bs: "l", xm: 775 }, { a: "cat", b: "floor", as: "b", bs: "t" }, { a: "floor", b: "conf", as: "b", bs: "t" },
      { a: "S", b: "sens", as: "b", bs: "t", d: true },
    ],
  };

  // From satellite archive to the screen - agents/specialists.py, sources/stac.py, sources/imagery.py, geo/grid.py
  D.dataflow = { w: 1000, h: 400, title: "From the satellite archive to the screen",
    nodes: [
      { id: "aoi", x: 16, y: 30, w: 170, h: 84, k: "ui", t: "Area + dates", s: "box, event date,\n'before'/'after' searches" },
      { id: "grid", x: 210, y: 30, w: 170, h: 84, k: "core", t: "Common grid", s: "UTM zone of the area\n20 m pixels (coarser if big)" },
      { id: "stac", x: 404, y: 30, w: 170, h: 84, k: "ext", t: "Archive search", s: "STAC: Sentinel-1 and\nSentinel-2 passes" },
      { id: "sel", x: 598, y: 30, w: 180, h: 84, k: "agent", t: "Choose images", s: "≥ 50% coverage · earliest\nradar · clearest optical" },
      { id: "read", x: 802, y: 30, w: 182, h: 84, k: "core", t: "Read only the area", s: "signed COG range reads,\nwarped to the grid, cached" },
      { id: "s1", x: 802, y: 150, w: 182, h: 78, k: "core", t: "Radar preparation", s: "dB · RTC gamma0 → sigma0\nsame orbit before/after" },
      { id: "s2", x: 598, y: 150, w: 180, h: 78, k: "core", t: "Optical preparation", s: "reflectance offset · SCL\ncloud mask · AOI cloud %" },
      { id: "ctx", x: 404, y: 150, w: 170, h: 78, k: "ext", t: "Context maps", s: "DEM · JRC water ·\nESA WorldCover" },
      { id: "det", x: 210, y: 150, w: 170, h: 78, k: "agent", t: "Detect change", s: "flood model / dNBR /\nlandslide indicators" },
      { id: "imp", x: 16, y: 150, w: 170, h: 78, k: "agent", t: "Exposure", s: "HRSL + WorldPop ·\nOpenStreetMap" },
      { id: "pri", x: 16, y: 270, w: 170, h: 78, k: "agent", t: "Priorities", s: "squares, reasons,\nsensitivity" },
      { id: "db", x: 210, y: 268, w: 170, h: 84, k: "store", t: "Database + files", s: "results, layers, reports" },
      { id: "api", x: 404, y: 270, w: 170, h: 78, k: "api", t: "API", s: "GeoJSON, PNG layers,\nPDF/CSV/GeoTIFF" },
      { id: "ui", x: 598, y: 270, w: 386, h: 78, k: "ui", t: "Result page and reports", s: "short answer · map with layers · reasons · review items" },
    ],
    edges: [
      { a: "aoi", b: "grid" }, { a: "grid", b: "stac" }, { a: "stac", b: "sel" }, { a: "sel", b: "read" },
      { a: "read", b: "s1", as: "b", bs: "t" }, { a: "s1", b: "s2" }, { a: "s2", b: "ctx" }, { a: "ctx", b: "det" }, { a: "det", b: "imp" },
      { a: "imp", b: "pri", as: "b", bs: "t" }, { a: "pri", b: "db" }, { a: "db", b: "api" }, { a: "api", b: "ui" },
    ],
  };

  // One check, end to end - api/routes_analyses.py, jobs.py, agents/orchestrator.py
  D.sequence = { kind: "sequence", w: 1000, title: "One check from button press to result",
    parts: [
      { id: "ui", t: "Browser", s: "web interface", k: "ui" }, { id: "api", t: "API", s: "FastAPI", k: "api" },
      { id: "jobs", t: "Job manager", s: "thread pool" }, { id: "orch", t: "Orchestrator", s: "agent", k: "agent" },
      { id: "tools", t: "Tools", s: "20 tools", k: "agent" }, { id: "ext", t: "Data services", s: "internet", k: "ext" },
      { id: "db", t: "Database", s: "SQLite / PostGIS", k: "store" },
    ],
    msgs: [
      { from: "ui", to: "api", t: "POST /api/analyses (place, disaster, dates)", num: 1 },
      { from: "api", to: "db", t: "save the check (status: queued)", num: 2 },
      { from: "api", to: "ui", t: "201 Created + id (instant)", d: true, num: 3 },
      { from: "api", to: "jobs", t: "submit(id)", num: 4 },
      { from: "jobs", to: "orch", t: "run(config)", num: 5 },
      { from: "orch", to: "tools", t: "search, choose, load images", num: 6 },
      { from: "tools", to: "ext", t: "STAC search + signed reads", num: 7 },
      { from: "orch", to: "tools", t: "detect, impact, prioritise", num: 8 },
      { from: "orch", to: "db", t: "steps, checks, results, findings, warnings", num: 9 },
      { from: "ui", to: "api", t: "GET /status every 2 s (progress bar)", d: true, num: 10 },
      { from: "orch", to: "db", t: "reports written, then final status", num: 11 },
      { from: "ui", to: "api", t: "GET result, layers, squares, places", num: 12 },
      { from: "ui", to: "api", t: "person's decisions (review, approve)", num: 13 },
      { from: "api", to: "db", t: "decision + audit log entry", num: 14 },
    ],
  };

  D.revisit = { kind: "revisit" };

  function renderAny(name) {
    const spec = D[name];
    if (!spec) return `<p style="color:#b42318">Unknown diagram: ${esc(name)}</p>`;
    if (spec.kind === "sequence") return sequence(spec);
    if (spec.kind === "revisit") return revisit();
    return render(spec);
  }

  window.AEGIS_DIAGRAMS = { names: Object.keys(D), render: renderAny };
  const draw = () => document.querySelectorAll("[data-diagram]").forEach((el) => { el.innerHTML = renderAny(el.dataset.diagram); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw); else draw();
})();
