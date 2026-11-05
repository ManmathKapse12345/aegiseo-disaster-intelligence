import { ArrowLeft, ExternalLink, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { useRecheckSources, useSources } from "@/api/hooks";
import type { Source } from "@/api/types";
import { Disclosure, ErrorState, Loading, PageHead } from "@/components/ui";
import { fmtInt, timeAgo } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";

const GROUPS: [string, string, string][] = [
  ["observation", "Satellite photos", "The photos AegisEO compares. Both are free European Copernicus satellites."],
  ["context", "Maps of people, places and land", "Used to work out who and what is in the hit area, and to ignore rivers and lakes that are always there."],
  ["feed", "Live disaster alerts", "Used to show what is happening now, and to cross-check fires."],
  ["service", "Helper services", "Not used to find damage - they make the website easier to use."],
  ["training", "Training data", "Used once, to teach the flood model. Not needed when running a check."],
];

export const SOURCE_STATUS: Record<string, [string, string, string]> = {
  operational: ["ok", "Working", "Answered the last check normally."],
  degraded: ["warn", "Partly working", "Slow or answering with errors. Checks still run but may miss some of this data."],
  unavailable: ["danger", "Not reachable", "Can't be reached right now. Checks still run and say clearly what is missing - nothing is made up."],
  offline: ["warn", "Offline mode", "This server is running without internet, using saved data only."],
  not_configured: ["", "Not set up", "Optional and not switched on for this server."],
  static: ["accent", "Built in", "A fixed dataset that doesn't need a live connection."],
  unknown: ["", "Unknown", "Not checked yet."],
};

/** Plain names and uses, keyed by source id (backend/aegis/sources/registry.py). Official names stay visible underneath. */
const PLAIN: Record<string, [string, string]> = {
  "sentinel-1-rtc": ["Radar satellite (Sentinel-1)", "Radar photos that see through clouds, day and night. Used to find water."],
  "sentinel-2-l2a": ["Camera satellite (Sentinel-2)", "Colour photos, plus colours our eyes can't see. Used to find water, burned land and plant loss, and to measure clouds."],
  "cop-dem-glo-30": ["Height map of the ground", "Shows hills and valleys, so water isn't wrongly found on steep slopes, and landslides are looked for where it's steep."],
  "jrc-gsw": ["Map of rivers and lakes", "Shows water that is always there, so it isn't counted as flooding."],
  "esa-worldcover": ["Land-cover map", "Shows where buildings, fields and forests are - used to describe what kind of land was hit."],
  "hrsl": ["Population map", "Estimates how many people live in each small patch of land (about 30 m across)."],
  "worldpop": ["Population totals", "A second population estimate, used as a cross-check."],
  "openstreetmap": ["OpenStreetMap", "The free world map made by volunteers: hospitals, schools, roads, villages and more."],
  "gdacs": ["Disaster alerts (GDACS)", "Current floods, storms, earthquakes and fires around the world, with alert levels."],
  "usgs-earthquakes": ["Earthquake list (USGS)", "Recent strong earthquakes - shown for context only."],
  "nasa-firms": ["Active fires (NASA FIRMS)", "Where satellites saw fires burning - used to double-check wildfire results."],
  "open-meteo": ["Rain records", "How much rain fell each day around the event."],
  "sen1floods11": ["Expert-mapped flood photos", "Flood photos mapped by hand by experts - used once, to teach the flood model."],
  "nominatim": ["Place search", "Finds places when you type a name, so you don't need coordinates."],
  "anthropic-claude": ["Writing helper (optional)", "Can word the summary more naturally from the measured numbers. It never measures anything itself."],
};

export function SourceStatus({ status }: { status: string }) {
  const [tone, label, help] = SOURCE_STATUS[status] ?? ["", status, ""];
  return <span className={`chip ${tone}`} title={help}><span className="chip-dot" aria-hidden />{label}</span>;
}

export function DataSources() {
  useDocumentTitle("Where the data comes from");
  const q = useSources();
  const re = useRecheckSources();
  const working = (q.data ?? []).filter((s) => s.status === "operational" || s.status === "static").length;
  return (
    <div className="page page-enter">
      <Link to="/about" className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", marginBottom: 16 }}><ArrowLeft size={16} aria-hidden /> About</Link>
      <PageHead title="Where the data comes from" lead="Everything AegisEO uses is public. If a source is down, checks still run and clearly say what is missing - AegisEO never fills gaps with made-up values."
        actions={<button className="btn" onClick={() => re.mutate()} disabled={re.isPending}><RefreshCcw size={16} aria-hidden /> {re.isPending ? "Checking…" : "Check them all again"}</button>} />
      {q.isLoading && <Loading label="Checking every source - this can take a few seconds" />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {re.isError && <ErrorState error={re.error} />}
      {q.data && <p className="small ink-2" style={{ marginBottom: 24 }}>{working} of {q.data.length} sources are working or built in right now.</p>}
      {GROUPS.map(([cat, title, lead]) => {
        const items = (q.data ?? []).filter((s) => s.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat} className="section-tight">
            <h2 style={{ fontSize: "1.75rem" }}>{title}</h2>
            <p className="ink-2 small" style={{ margin: "6px 0 16px" }}>{lead}</p>
            <div className="grid g-2" style={{ gap: 16 }}>{items.map((s) => <SourceCard key={s.id} s={s} />)}</div>
          </section>
        );
      })}
    </div>
  );
}

function SourceCard({ s }: { s: Source }) {
  const help = SOURCE_STATUS[s.status]?.[2];
  return (
    <article className="card card-pad">
      <div className="row between" style={{ gap: 12, alignItems: "flex-start" }}>
        <div>
          <h3 style={{ fontSize: "1.25rem" }}>{PLAIN[s.id]?.[0] ?? s.name}</h3>
          <div className="caption muted">{s.name} · {s.provider}</div>
        </div>
        <SourceStatus status={s.status} />
      </div>
      <p className="small" style={{ marginTop: 12 }}>{PLAIN[s.id]?.[1] ?? s.provides}</p>
      {(s.health?.error || (s.status !== "operational" && help)) && (
        <p className="caption" style={{ marginTop: 8, color: s.health?.error ? "var(--warn)" : "var(--ink-3)" }}>{s.health?.error ? `Last check: ${s.health.error}` : help}</p>
      )}
      <div style={{ marginTop: 8 }}>
        <Disclosure summary={<span className="small">Details: coverage, detail, updates, licence, limits</span>}>
          <dl className="kv-list">
            <dt>Provides</dt><dd>{s.provides}</dd>
            <dt>Covers</dt><dd>{s.coverage}</dd>
            <dt>Detail</dt><dd>{s.spatial_resolution}</dd>
            <dt>How often</dt><dd>{s.temporal_resolution}</dd>
            <dt>Updated</dt><dd>{s.update_frequency}</dd>
            <dt>Access</dt><dd>{s.access}</dd>
            <dt>Licence</dt><dd>{s.license}</dd>
            <dt>Limits</dt><dd style={{ fontWeight: 450 }}>{s.limitations}</dd>
            {s.health?.detail && <><dt>Note</dt><dd style={{ fontWeight: 450 }}>{s.health.detail}</dd></>}
          </dl>
          <div className="row between caption muted" style={{ marginTop: 12 }}>
            <span>{s.health?.latency_ms != null ? `Answered in ${fmtInt(s.health.latency_ms)} ms` : ""}{s.health?.checked_at ? ` · checked ${timeAgo(s.health.checked_at)}` : ""}</span>
            <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>Website <ExternalLink size={13} aria-hidden /></a>
          </div>
        </Disclosure>
      </div>
    </article>
  );
}
