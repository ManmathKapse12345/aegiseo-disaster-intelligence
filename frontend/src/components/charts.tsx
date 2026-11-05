/**
 * Hand-written SVG charts following the AegisEO data-viz rules:
 * thin marks (<=24px), 4px rounded data ends, 2px surface gaps, hairline solid grids,
 * text in ink tokens (never the series colour), a legend for >=2 series, selective direct
 * labels, hover + keyboard-focus tooltips, and a table view so no value is tooltip-only.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Category } from "@/api/types";
import { CATEGORIES, PRIORITY_HEX } from "@/lib/meta";
import { fmtDate, fmtInt, fmtNum, fmtPct } from "@/lib/format";

// ------------------------------------------------------------------ tooltip
type Tip = { x: number; y: number; content: ReactNode } | null;

function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const show = (e: { clientX: number; clientY: number } | DOMRect, content: ReactNode) => {
    const x = "clientX" in e ? e.clientX : e.left + e.width / 2;
    const y = "clientY" in e ? e.clientY : e.top;
    setTip({ x, y, content });
  };
  const hide = () => setTip(null);
  const node = tip
    ? createPortal(
        <div className="viz-tooltip" role="tooltip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 220), top: Math.max(8, tip.y - 12) }}>
          {tip.content}
        </div>,
        document.body,
      )
    : null;
  return { show, hide, node };
}

function TipRow({ color, value, label, line = true }: { color?: string; value: ReactNode; label: ReactNode; line?: boolean }) {
  return (
    <div className="tt-row">
      {color && <span className={line ? "line-key" : "key"} style={{ background: color, width: line ? 12 : 9, height: line ? 2 : 9, borderRadius: line ? 1 : 3 }} aria-hidden />}
      <strong>{value}</strong>
      <span className="muted">{label}</span>
    </div>
  );
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function luminance(hex: string): number {
  const c = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const inkOn = (hex: string) => (1.05 / (luminance(hex) + 0.05) >= (luminance(hex) + 0.05) / 0.0625 ? "#ffffff" : "#0f1b2d");

export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

// ------------------------------------------------------------------ tall segmented bar (part-to-whole)
export function PriorityDistribution({ counts, onSelect }: { counts: Partial<Record<Category, number>>; onSelect?: (c: Category) => void }) {
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const total = CATEGORIES.reduce((s, c) => s + (counts[c] ?? 0), 0);
  if (!total) return <div className="muted small">No prioritised cells yet.</div>;
  const parts = CATEGORIES.map((c) => ({ c, n: counts[c] ?? 0 })).filter((p) => p.n > 0);
  const gaps = (parts.length - 1) * 2;
  return (
    <div>
      <div className="segbar" ref={ref} role="img" aria-label={`Priority distribution: ${parts.map((p) => `${p.c} ${p.n}`).join(", ")}`}>
        {parts.map((p) => {
          const share = p.n / total;
          const px = share * Math.max(0, width - gaps);
          const label = `${Math.round(share * 100)}%`;
          const fits = px >= label.length * 7 + 16;
          return (
            <div key={p.c} tabIndex={0} role="button" aria-label={`${p.c}: ${p.n} cells, ${label}`}
              style={{ flex: `${p.n} 1 0`, background: PRIORITY_HEX[p.c], color: inkOn(PRIORITY_HEX[p.c]), cursor: onSelect ? "pointer" : "default" }}
              onPointerMove={(e) => tip.show(e, <><div className="tt-title">{p.c}</div><TipRow value={fmtInt(p.n)} label={`cells - ${label}`} /></>)}
              onPointerLeave={tip.hide} onFocus={(e) => tip.show(e.currentTarget.getBoundingClientRect(), <TipRow value={fmtInt(p.n)} label={`${p.c} - ${label}`} />)}
              onBlur={tip.hide} onClick={() => onSelect?.(p.c)}>
              {fits ? label : ""}
            </div>
          );
        })}
      </div>
      <div className="viz-legend" style={{ marginTop: 8 }}>
        {parts.map((p) => (
          <span key={p.c}><span className="key" style={{ background: PRIORITY_HEX[p.c] }} />{p.c}</span>
        ))}
      </div>
      <table className="sr-only-table" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        <caption>Response cells by priority</caption>
        <tbody>{parts.map((p) => <tr key={p.c}><th>{p.c}</th><td>{p.n}</td></tr>)}</tbody>
      </table>
      {tip.node}
    </div>
  );
}

// ------------------------------------------------------------------ stacked contribution bars
export function ContributionBars({ groups, labels, colors }: {
  groups: { name: string; subscore: number; parts: { key: string; value: number; raw?: number | null }[] }[];
  labels: Record<string, string>;
  colors: Record<string, string>;
}) {
  const tip = useTip();
  const keys = groups.flatMap((g) => g.parts.map((p) => p.key));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {groups.map((g) => (
        <div key={g.name}>
          <div className="row between xs" style={{ marginBottom: 3 }}>
            <span className="muted">{g.name}</span>
            <strong className="tabular">{fmtNum(g.subscore, 0)}/100</strong>
          </div>
          <div style={{ display: "flex", gap: 2, height: 10, background: "var(--surface-3)", borderRadius: 4, overflow: "hidden" }}
            role="img" aria-label={`${g.name} sub-score ${fmtNum(g.subscore, 0)} of 100`}>
            {g.parts.filter((p) => p.value > 0.0005).map((p, i, arr) => (
              <div key={p.key} tabIndex={0}
                style={{ width: `${p.value * 100}%`, background: colors[p.key], borderRadius: i === arr.length - 1 ? "0 4px 4px 0" : 0 }}
                onPointerMove={(e) => tip.show(e, <><div className="tt-title">{labels[p.key]}</div>
                  <TipRow color={colors[p.key]} line={false} value={`+${fmtNum(p.value * 100, 1)}`} label="points" />
                  {p.raw != null && <TipRow value={fmtNum(p.raw, 2)} label="normalised factor (0-1)" />}</>)}
                onPointerLeave={tip.hide}
                onFocus={(e) => tip.show(e.currentTarget.getBoundingClientRect(), <TipRow value={`+${fmtNum(p.value * 100, 1)}`} label={labels[p.key]} />)}
                onBlur={tip.hide} aria-label={`${labels[p.key]}: ${fmtNum(p.value * 100, 1)} points`} />
            ))}
          </div>
        </div>
      ))}
      <div className="viz-legend">
        {keys.map((k) => <span key={k}><span className="key" style={{ background: colors[k] }} />{labels[k]}</span>)}
      </div>
      {tip.node}
    </div>
  );
}

// ------------------------------------------------------------------ column chart (single series)
export function ColumnChart({ data, unit, height = 150, ariaLabel }: { data: { x: string; y: number }[]; unit: string; height?: number; ariaLabel: string }) {
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const max = Math.max(...data.map((d) => d.y), 0);
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1] || 1;
  const m = { l: 34, r: 8, t: 14, b: 22 };
  const W = Math.max(width, 120);
  const iw = W - m.l - m.r;
  const ih = height - m.t - m.b;
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(2, band - 2));
  const peak = data.reduce((a, d, i) => (d.y > (data[a]?.y ?? -1) ? i : a), 0);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 70)));
  return (
    <div ref={ref}>
      {!table ? (
        <svg className="viz" width={W} height={height} role="img" aria-label={ariaLabel}>
          <g className="grid">
            {ticks.map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={m.t + ih - (t / top) * ih} y2={m.t + ih - (t / top) * ih} />)}
          </g>
          <g className="axis">
            {ticks.map((t) => <text key={t} x={m.l - 6} y={m.t + ih - (t / top) * ih + 3.5} textAnchor="end">{fmtNum(t, 0)}</text>)}
            {data.map((d, i) => (i % every === 0 ? <text key={d.x} x={m.l + band * i + band / 2} y={height - 6} textAnchor="middle">{fmtDate(d.x, { day: "numeric", month: "short" })}</text> : null))}
          </g>
          {data.map((d, i) => {
            const h = (d.y / top) * ih;
            const x = m.l + band * i + (band - bw) / 2;
            const y = m.t + ih - h;
            const r = Math.min(4, bw / 2, h);
            return (
              <g key={d.x}>
                <path d={h <= 0 ? "" : `M${x},${m.t + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${m.t + ih} Z`} fill="var(--series-1)" />
                <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent" tabIndex={0}
                  onPointerMove={(e) => tip.show(e, <><div className="tt-title">{fmtDate(d.x)}</div><TipRow color="var(--series-1)" line={false} value={`${fmtNum(d.y, 1)} ${unit}`} label="" /></>)}
                  onPointerLeave={tip.hide} aria-label={`${fmtDate(d.x)}: ${fmtNum(d.y, 1)} ${unit}`} />
              </g>
            );
          })}
          {max > 0 && (
            <text x={m.l + band * peak + band / 2} y={m.t + ih - (data[peak].y / top) * ih - 4} textAnchor="middle" style={{ fill: "var(--ink)", fontWeight: 650 }}>
              {fmtNum(data[peak].y, 0)}
            </text>
          )}
        </svg>
      ) : (
        <SimpleTable head={["Date", unit]} rows={data.map((d) => [fmtDate(d.x), fmtNum(d.y, 1)])} />
      )}
      <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)} style={{ paddingLeft: 0 }}>{table ? "Show chart" : "Show table"}</button>
      {tip.node}
    </div>
  );
}

// ------------------------------------------------------------------ grouped bars (<=4 series)
export function GroupedBars({ groups, series, max = 1, height = 230, valueFmt = (v: number) => fmtNum(v, 3), ariaLabel }: {
  groups: { label: string; values: (number | null)[] }[];
  series: { label: string; color: string }[];
  max?: number;
  height?: number;
  valueFmt?: (v: number) => string;
  ariaLabel: string;
}) {
  const tip = useTip();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const m = { l: 36, r: 8, t: 10, b: 40 };
  const W = Math.max(width, 280);
  const iw = W - m.l - m.r;
  const ih = height - m.t - m.b;
  const band = iw / Math.max(1, groups.length);
  const bw = Math.min(16, (band * 0.8 - 2 * (series.length - 1)) / series.length);
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  return (
    <div ref={ref}>
      <div className="viz-legend" style={{ marginBottom: 6 }}>
        {series.map((s) => <span key={s.label}><span className="key" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      {!table ? (
        <svg className="viz" width={W} height={height} role="img" aria-label={ariaLabel}>
          <g className="grid">{ticks.map((t) => <line key={t} x1={m.l} x2={W - m.r} y1={m.t + ih - (t / top) * ih} y2={m.t + ih - (t / top) * ih} />)}</g>
          <g className="axis">
            {ticks.map((t) => <text key={t} x={m.l - 6} y={m.t + ih - (t / top) * ih + 3.5} textAnchor="end">{fmtNum(t, top <= 1 ? 2 : 0)}</text>)}
          </g>
          {groups.map((g, gi) => {
            const gx = m.l + band * gi + (band - (bw * series.length + 2 * (series.length - 1))) / 2;
            return (
              <g key={g.label}>
                {g.values.map((v, si) => {
                  const x = gx + si * (bw + 2);
                  if (v == null) return <text key={si} x={x + bw / 2} y={m.t + ih - 4} textAnchor="middle" style={{ fontSize: 9, fill: "var(--ink-3)" }}>n/a</text>;
                  const h = (v / top) * ih;
                  const y = m.t + ih - h;
                  const r = Math.min(4, bw / 2, h);
                  return (
                    <path key={si} tabIndex={0} aria-label={`${g.label}, ${series[si].label}: ${valueFmt(v)}`}
                      d={`M${x},${m.t + ih} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${m.t + ih} Z`}
                      fill={series[si].color}
                      onPointerMove={(e) => tip.show(e, <><div className="tt-title">{g.label}</div><TipRow color={series[si].color} line={false} value={valueFmt(v)} label={series[si].label} /></>)}
                      onPointerLeave={tip.hide} />
                  );
                })}
                <text x={m.l + band * gi + band / 2} y={height - m.b + 14} textAnchor="middle" style={{ fontSize: 10.5 }}>
                  {g.label.length > 18 ? g.label.slice(0, 17) + "…" : g.label}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <SimpleTable head={["Method", ...series.map((s) => s.label)]} rows={groups.map((g) => [g.label, ...g.values.map((v) => (v == null ? "n/a" : valueFmt(v)))])} />
      )}
      <button className="btn btn-ghost btn-sm" onClick={() => setTable((t) => !t)} style={{ paddingLeft: 0 }}>{table ? "Show chart" : "Show table"}</button>
      {tip.node}
    </div>
  );
}

// ------------------------------------------------------------------ reliability diagram
export function ReliabilityChart({ series, size = 260 }: {
  series: { label: string; color: string; bins: { lo: number; hi: number; count: number; confidence: number | null; frequency: number | null }[] }[];
  size?: number;
}) {
  const tip = useTip();
  const m = { l: 38, r: 10, t: 10, b: 32 };
  const W = size + m.l + m.r;
  const H = size + m.t + m.b;
  const sx = (v: number) => m.l + v * size;
  const sy = (v: number) => m.t + size - v * size;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div>
      <div className="viz-legend" style={{ marginBottom: 6 }}>
        {series.map((s) => <span key={s.label}><span className="line-key" style={{ background: s.color }} />{s.label}</span>)}
        <span><span className="line-key" style={{ background: "var(--series-muted)" }} />perfect calibration</span>
      </div>
      <svg className="viz" width={W} height={H} role="img" aria-label="Reliability diagram: predicted probability against observed frequency">
        <g className="grid">{ticks.map((t) => <g key={t}><line x1={sx(0)} x2={sx(1)} y1={sy(t)} y2={sy(t)} /><line x1={sx(t)} x2={sx(t)} y1={sy(0)} y2={sy(1)} /></g>)}</g>
        <g className="axis">
          {ticks.map((t) => <text key={`y${t}`} x={m.l - 6} y={sy(t) + 3.5} textAnchor="end">{t}</text>)}
          {ticks.map((t) => <text key={`x${t}`} x={sx(t)} y={H - 16} textAnchor="middle">{t}</text>)}
          <text x={m.l + size / 2} y={H - 2} textAnchor="middle">predicted probability of water</text>
        </g>
        <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--series-muted)" strokeWidth={1.5} />
        {series.map((s) => {
          const pts = s.bins.filter((b) => b.count > 0 && b.confidence != null && b.frequency != null);
          return (
            <g key={s.label}>
              <polyline fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                points={pts.map((b) => `${sx(b.confidence!)},${sy(b.frequency!)}`).join(" ")} />
              {pts.map((b) => (
                <g key={b.lo}>
                  <circle cx={sx(b.confidence!)} cy={sy(b.frequency!)} r={4} fill={s.color} stroke="var(--chart-surface)" strokeWidth={2} />
                  <circle cx={sx(b.confidence!)} cy={sy(b.frequency!)} r={12} fill="transparent" tabIndex={0}
                    aria-label={`${s.label}: predicted ${fmtPct(b.confidence)}, observed ${fmtPct(b.frequency)}`}
                    onPointerMove={(e) => tip.show(e, <><div className="tt-title">{s.label} - bin {b.lo.toFixed(2)}-{b.hi.toFixed(2)}</div>
                      <TipRow color={s.color} value={fmtPct(b.frequency, 1)} label="observed" />
                      <TipRow value={fmtPct(b.confidence, 1)} label="predicted" />
                      <TipRow value={fmtInt(b.count)} label="pixels" /></>)}
                    onPointerLeave={tip.hide} />
                </g>
              ))}
            </g>
          );
        })}
      </svg>
      {tip.node}
    </div>
  );
}

// ------------------------------------------------------------------ horizontal bar list (single series)
export function BarList({ items, unit = "", color = "var(--series-1)", max }: { items: { label: string; value: number }[]; unit?: string; color?: string; max?: number }) {
  const top = max ?? Math.max(...items.map((i) => i.value), 0);
  if (!items.length) return <div className="muted small">No data.</div>;
  return (
    <div className="stack" style={{ gap: 8 }} role="list">
      {items.map((i) => (
        <div key={i.label} role="listitem">
          <div className="row between xs"><span>{i.label}</span><strong className="tabular">{fmtNum(i.value, i.value < 10 ? 2 : 0)}{unit}</strong></div>
          <div style={{ height: 8, background: "var(--surface-3)", borderRadius: 4, marginTop: 3 }}>
            <div style={{ width: `${top ? Math.max(1.5, (i.value / top) * 100) : 0}%`, height: "100%", background: color, borderRadius: "0 4px 4px 0" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="table-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
      <table className="table">
        <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Meter({ value, max = 1, tone = "brand", label }: { value: number; max?: number; tone?: "brand" | "warn" | "danger" | "ok"; label: string }) {
  const pct = Math.max(0, Math.min(1, value / max));
  const colors = { brand: ["var(--accent)", "var(--accent-soft)"], warn: ["var(--p-high)", "var(--p-high-bg)"], danger: ["var(--p-critical)", "var(--p-critical-bg)"], ok: ["var(--ok)", "var(--ok-bg)"] }[tone];
  return (
    <div role="meter" aria-label={label} aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}
      style={{ height: 8, background: colors[1], borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${pct * 100}%`, height: "100%", background: colors[0], borderRadius: 999 }} />
    </div>
  );
}

export const useChartMemo = useMemo;
