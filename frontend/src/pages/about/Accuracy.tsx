import { ArrowLeft, FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useBenchmark, useBenchmarks, useModel, useRunBenchmark } from "@/api/hooks";
import { GroupedBars, ReliabilityChart } from "@/components/charts";
import { Disclosure, Empty, ErrorState, InfoTip, Loading, PageHead, Tabs, useToast } from "@/components/ui";
import { fmtDateTime, fmtDuration, fmtNum, fmtPct } from "@/lib/format";
import { useDocumentTitle } from "@/lib/hooks";
import { friendlyError } from "@/lib/plain";
import { CONDITIONS, METHOD_NAMES, accuracyHeadline } from "./accuracyData";

const SERIES = [{ label: "Normal photos", color: "var(--series-1)" }, { label: "Half hidden by cloud", color: "var(--series-2)" },
  { label: "No camera photos", color: "var(--series-3)" }, { label: "No radar photos", color: "var(--series-4)" }];
const ORDER = ["otsu_vh", "mndwi", "rule_fusion", "s1_unet", "s2_unet", "early_fusion_unet", "gated_fusion_unet", "gated_fusion_unet_v2",
  "hybrid_gated_fusion_unet+s1_unet", "hybrid_gated_fusion_unet_v2+s1_unet"];

export function Accuracy() {
  useDocumentTitle("How accurate is it?");
  return (
    <div className="page page-enter">
      <Link to="/about" className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none", marginBottom: 16 }}><ArrowLeft size={16} aria-hidden /> About</Link>
      <PageHead title="How accurate is it?" lead="Two things were tested: how well the flood model finds water in photos it has never seen, and whether the whole system behaves safely when things go wrong." />
      <ModelEval />
      <section className="section"><AgentBench /></section>
    </div>
  );
}

function ModelEval() {
  const q = useModel();
  const [split, setSplit] = useState<"test" | "bolivia" | "valid">("test");
  if (q.isLoading) return <Loading label="Loading the test results" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const ev = m.evaluation;
  const h = accuracyHeadline(m);
  if (!ev || !h) return <div className="card"><Empty title="No test results on this server">Run <code>python -m aegis.ml.evaluate</code> after training to create them.</Empty></div>;
  const all: [string, any][] = [...Object.entries(ev.baselines ?? {}), ...Object.entries(ev.models ?? {}), ...Object.entries(ev.hybrids ?? {})];
  const rows = ORDER.map((k) => all.find(([n]) => n === k)).filter(Boolean) as [string, any][];
  const sel = ev.selection ?? {};
  const fusion = ev.models?.[sel.model_variant ?? "gated_fusion_unet"];
  // before/after calibration exists for the base fusion model (the deployed set-up adds a radar helper on top of it)
  const cal = fusion?.splits?.test?.as_is;
  const fusionName = METHOD_NAMES[sel.model_variant] ?? "the combined model";
  const unc = fusion?.uncertainty;
  return (
    <div className="stack-lg">
      <div className="stat-band">
        <div><div className="sb-value">{h.overlap}%</div><div className="sb-label">overlap with flood maps drawn by experts, on {h.chips ?? "the"} test images it never saw while learning.</div></div>
        <div><div className="sb-value">{h.noOptical == null ? "-" : `${h.noOptical}%`}</div><div className="sb-label">overlap when every camera photo is hidden (radar only) - floods often come with clouds.</div></div>
        <div><div className="sb-value">{h.calibration ?? "-"}</div><div className="sb-label">average gap between how sure it says it is and how often it is right (the set-up in use, test images).</div></div>
      </div>
      <div className="callout neutral">
        <span className="small"><strong>What "overlap" means:</strong> take the area the computer marked and the area the experts marked. Divide the part they share by everything either of them marked.
          100% is a perfect match. Experts mapping the same flood rarely agree perfectly either. <InfoTip text="This is the 'intersection over union' (IoU) score used in remote-sensing research." /></span>
      </div>

      <section className="card card-pad-lg">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div>
            <h3>Overlap score of each method, in different conditions</h3>
            <p>Higher is better. Single-sensor methods can't run when their sensor is missing ("n/a"). The system uses the last method.</p>
          </div>
          <Tabs label="Test set" value={split} onChange={setSplit} tabs={[{ id: "test", label: "Test" }, { id: "bolivia", label: "New country (Bolivia)" }, { id: "valid", label: "Validation" }]} />
        </div>
        <GroupedBars ariaLabel="Overlap score by method and condition" series={SERIES} height={260}
          groups={rows.map(([n, e]) => ({ label: METHOD_NAMES[n] ?? n, values: CONDITIONS.map(([c]) => e.splits?.[split]?.[c]?.iou ?? null) }))} />
        {split === "bolivia" && <p className="caption muted" style={{ marginTop: 8 }}>Bolivia is a flood event that was kept completely out of training. On it, without camera photos, a simple radar rule does better than every learned model - an honest weakness described in the failure analysis.</p>}
      </section>

      <div className="grid g-2" style={{ gap: 24 }}>
        <section className="card card-pad-lg">
          <h3>Is its confidence honest?</h3>
          <p className="small muted" style={{ margin: "6px 0 14px" }}>Each dot compares how sure the model said it was (across) with how often it was right (up). Dots on the grey line mean perfectly honest confidence. Shown for {fusionName}, before and after its confidence was adjusted on separate validation images.</p>
          {cal?.calibration && cal?.calibration_uncalibrated ? <ReliabilityChart series={[
            { label: `before adjustment (gap ${fmtNum((cal.calibration_uncalibrated?.ece ?? 0) * 100, 1)} pts)`, color: "var(--series-2)", bins: cal.calibration_uncalibrated?.bins ?? [] },
            { label: `after adjustment (gap ${fmtNum(cal.calibration.ece * 100, 1)} pts)`, color: "var(--series-1)", bins: cal.calibration.bins ?? [] }]} /> : <Empty title="No calibration data" />}
        </section>
        <section className="card card-pad-lg">
          <h3>Does it know when it's unsure?</h3>
          <p className="small muted" style={{ margin: "6px 0 14px" }}>If only the spots it is most sure about are kept, the remaining answers get much better. That's why unsure results are sent to a person.</p>
          {unc ? (
            <table className="table"><thead><tr><th>Spots kept (most sure first)</th><th className="num">Correct</th><th className="num">Overlap</th></tr></thead>
              <tbody>{unc.risk_coverage.map((r: any) => <tr key={r.coverage}><td>{fmtPct(r.coverage)}</td><td className="num">{fmtPct(r.accuracy, 1)}</td><td className="num">{fmtPct(r.iou, 1)}</td></tr>)}</tbody></table>
          ) : <Empty title="No uncertainty test" />}
          {unc && <p className="caption muted" style={{ marginTop: 10 }}>Its uncertainty points at its mistakes {fmtPct(unc.auroc_entropy_vs_error, 0)} of the time when comparing a wrong spot with a right one (AUROC {fmtNum(unc.auroc_entropy_vs_error, 3)}).</p>}
        </section>
      </div>

      <Disclosure summary="All the numbers (precision, recall, F1, flood-only overlap, calibration)">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Method</th><th>Condition</th><th className="num">Overlap</th><th className="num">F1</th><th className="num">Precision</th><th className="num">Recall</th><th className="num">Flood-only overlap</th><th className="num">Calibration gap</th></tr></thead>
            <tbody>{rows.flatMap(([n, e]) => CONDITIONS.map(([c, cl]) => {
              const r = e.splits?.[split]?.[c];
              return <tr key={n + c}><td>{METHOD_NAMES[n] ?? n}</td><td className="caption">{cl}</td>{r ? <>
                <td className="num">{fmtNum(r.iou, 3)}</td><td className="num">{fmtNum(r.f1, 3)}</td><td className="num">{fmtNum(r.precision, 3)}</td><td className="num">{fmtNum(r.recall, 3)}</td>
                <td className="num">{fmtNum(r.flood_iou_excl_permanent, 3)}</td><td className="num">{fmtNum(r.calibration?.ece, 3)}</td></> : <td colSpan={6} className="caption muted">not applicable</td>}</tr>;
            }))}</tbody>
          </table>
        </div>
        <p className="caption muted" style={{ marginTop: 8 }}>Showing the "{split}" set. "Flood-only overlap" ignores rivers and lakes that are always there.</p>
      </Disclosure>
      <Disclosure summary="How the flood model was made (model card)">
        <dl className="kv-list">
          <dt>Training data</dt><dd>Sen1Floods11 v1.1, hand-labelled by experts (Bonafilia et al., 2020): 252 training / 89 validation / 90 test images from 10 flood events, plus 15 images from a flood in Bolivia that was never used for training.</dd>
          <dt>What it looks at</dt><dd>Radar (Sentinel-1 VV, VH and their difference) and camera bands (Sentinel-2 blue, green, red, near- and short-wave infrared, plus two water indices), each with a "valid data" mask.</dd>
          <dt>Design</dt><dd>Two encoders (radar and camera) joined by learned "gates" that decide, pixel by pixel, how much to trust each sensor; a shared U-Net decoder ({fmtNum(m.variants?.gated_fusion_unet?.parameters, 0)} parameters for v1).</dd>
          <dt>Made robust by</dt><dd>Random crops and flips, simulated clouds, whole-sensor dropout and changes in image processing levels.</dd>
          <dt>Honest confidence</dt><dd>Temperature scaling fitted on the validation set (T = {fmtNum(fusion?.temperature, 2)}).</dd>
          <dt>Uncertainty</dt><dd>Monte-Carlo dropout: each spot is predicted several times with small random changes; the spread measures how unsure it is.</dd>
          <dt>Chosen by</dt><dd>{sel.criterion ?? "-"}.</dd>
          <dt>Known limits</dt><dd>Trained on 11 flood events. Deserts, snow or dense cities may be unfamiliar (checked on every run by safety check G11). Radar under-detects water among buildings and under trees.</dd>
        </dl>
      </Disclosure>
    </div>
  );
}

const BENCH_LABELS: [string, string, string, boolean][] = [
  ["task_success_rate", "Tests passed", "Scenarios and safety probes that behaved as expected.", true],
  ["escalation_recall", "Asked a person when it should", "Of the cases that needed a person, how many it sent to one.", true],
  ["escalation_precision", "Asked only when needed", "Of the times it asked a person, how many were really needed.", true],
  ["groundedness", "Warnings with every number checked", "Draft warnings whose every number and date matched a measured value.", true],
  ["tool_success_rate", "Tool calls that worked", "Includes failures injected on purpose to test recovery.", true],
  ["decision_trace_quality", "Decisions with written reasons", "Choices recorded with a reason and the alternatives or a rule.", true],
  ["mean_iou", "Average overlap on test scenes", "Against the known right answers of the made-up test scenes.", false],
];

function AgentBench() {
  const q = useBenchmarks();
  const run = useRunBenchmark();
  const toast = useToast();
  const latest = q.data?.items.find((r) => r.suite === "agent") ?? q.data?.items[0];
  const detail = useBenchmark(latest?.id);
  const s = latest?.summary;
  const start = async () => {
    try {
      await run.mutateAsync("agent");
      toast("ok", "The safety tests have started. They take about a minute.");
    } catch (e) {
      toast("error", friendlyError(e));
    }
  };
  return (
    <>
      <div className="section-head">
        <div>
          <h2>Does the whole system behave safely?</h2>
          <p>Twelve made-up situations with known right answers - outages, heavy cloud, broken data, invalid requests, a missing model - plus eight attempts to make it misbehave (send without approval, invent numbers, use alarming language).</p>
        </div>
        <button className="btn btn-primary" onClick={start} disabled={run.isPending || q.data?.running}><Play size={16} aria-hidden /> {q.data?.running ? "Running…" : "Run the tests again"}</button>
      </div>
      {q.data?.last_error && <ErrorState error={new Error(q.data.last_error)} title="The last test run failed" />}
      {!latest && !q.isLoading && <div className="card"><Empty title="Not tested on this server yet" icon={<FlaskConical size={40} aria-hidden />}>Press "Run the tests again" to measure it. Only administrators can start the tests.</Empty></div>}
      {s && (
        <>
          <p className="caption muted" style={{ marginBottom: 12 }}>Latest run: {fmtDateTime(latest!.created_at)}, took {fmtDuration(latest!.duration_s)}.</p>
          <div className="grid g-4" style={{ gap: 16 }}>
            {BENCH_LABELS.map(([k, label, tip]) => (
              <div key={k} className="card card-pad">
                <div className="small muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>{label} <InfoTip text={tip} /></div>
                <div className="fact-value" style={{ fontFamily: "var(--font-display)", fontSize: "2rem", marginTop: 6 }}>{fmtPct(s[k], 0)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16 }}>
            <Disclosure summary="Each test, one by one">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Test</th><th>Kind</th><th>Result</th><th className="num">Overlap</th><th>Asked a person</th><th className="num">Time</th></tr></thead>
                  <tbody>{(detail.data?.results ?? []).map((r: any) => (
                    <tr key={r.id}><td><strong>{r.id}</strong> {r.title}</td><td className="caption">{r.category}</td>
                      <td><span className={`chip ${r.passed ? "ok" : "danger"}`}>{r.passed ? "passed" : "failed"}</span></td>
                      <td className="num">{r.metrics?.iou != null ? fmtPct(r.metrics.iou, 0) : "-"}</td><td className="caption">{r.escalated == null ? "-" : r.escalated ? "yes" : "no"}</td>
                      <td className="num">{r.latency_s != null ? `${fmtNum(r.latency_s, 1)} s` : "-"}</td></tr>))}</tbody>
                </table>
              </div>
            </Disclosure>
          </div>
        </>
      )}
    </>
  );
}
