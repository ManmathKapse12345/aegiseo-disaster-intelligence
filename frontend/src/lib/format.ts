const nf0 = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function fmtInt(v: number | null | undefined): string {
  return isNum(v) ? nf0.format(v) : "-";
}
export function fmtNum(v: number | null | undefined, digits: 0 | 1 | 2 | 3 = 1): string {
  if (!isNum(v)) return "-";
  return (digits === 0 ? nf0 : digits === 1 ? nf1 : digits === 2 ? nf2 : nf3).format(v);
}
export function fmtCompact(v: number | null | undefined): string {
  if (!isNum(v)) return "-";
  return Math.abs(v) < 10_000 ? nf0.format(v) : compact.format(v);
}
export function fmtPct(v: number | null | undefined, digits = 0): string {
  return isNum(v) ? `${(v * 100).toFixed(digits)}%` : "-";
}
export function fmtArea(km2: number | null | undefined): string {
  if (!isNum(km2)) return "-";
  if (km2 === 0) return "0 km²";
  if (km2 < 0.01) return `${nf0.format(km2 * 100)} ha`;
  return `${km2 < 10 ? nf2.format(km2) : nf1.format(km2)} km²`;
}
export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!iso) return "-";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });
}
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "-";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(s)) return "-";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function fmtDuration(sec: number | null | undefined): string {
  if (!isNum(sec)) return "-";
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} s`;
  return `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const sentence = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
