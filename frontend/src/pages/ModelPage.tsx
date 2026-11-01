import { FlaskConical, Play } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "@/api/client";
import { useBenchmark, useBenchmarks, useModel, useRunBenchmark } from "@/api/hooks";
import { GroupedBars, ReliabilityChart } from "@/components/charts";
import { Card, Empty, ErrorState, InfoTip, Loading, Tabs, useToast } from "@/components/ui";
import { fmtDateTime, fmtDuration, fmtNum, fmtPct } from "@/lib/format";

const CONDS: [string, string][] = [["as_is", "As provided"], ["cloud_50", "50 % cloud"], ["no_s2", "No optical"], ["no_s1", "No radar"]];
const SERIES = [{ label: "As provided", color: "var(--series-1)" }, { label: "50 % cloud", color: "var(--series-2)" },
  { label: "No optical", color: "var(--series-3)" }, { label: "No radar", color: "var(--series-4)" }];
const NAMES: Record<string, string> = {
  otsu_vh: "Otsu SAR (VH)", otsu_vv: "Otsu SAR (VV)", mndwi: "MNDWI optical", rule_fusion: "Rule fusion", s1_unet: "S1 U-Net", s2_unet: "S2 U-Net",
  early_fusion_unet: "Early fusion", gated_fusion_unet: "Gated fusion v1", gated_fusion_unet_v2: "Gated fusion v2",
  "hybrid_gated_fusion_unet+s1_unet": "Hybrid v1 + S1", "hybrid_gated_fusion_unet_v2+s1_unet": "Hybrid v2 + S1",
};

export function ModelPage() {
  const [tab, setTab] = useState<"model" | "benchmark">("model");
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h1>Model & benchmarks</h1><p>How well the perception model maps water from radar and optical data - including when a sensor is missing - and how reliably the agent behaves end to end.</p></div>
      </div>
      <Tabs label="Section" value={tab} onChange={setTab} tabs={[{ id: "model", label: "Water model evaluation" }, { id: "benchmark", label: "Agent benchmark" }]} />
      <div style={{ marginTop: 16 }}>{tab === "model" ? <ModelEval /> : <AgentBench />}</div>
    </div>
  );
}

function ModelEval() {
  const q = useModel();
  const [split, setSplit] = useState<"test" | "bolivia" | "valid">("test");
  if (q.isLoading) return <Loading />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const m = q.data!;
  const ev = m.evaluation;
  if (!ev) return <Card><Empty title="No evaluation yet">Run <code>python -m aegis.ml.evaluate</code> after training.</Empty></Card>;
  const entries: [string, any][] = [...Object.entries(ev.baselines ?? {}), ...Object.entries(ev.models ?? {}), ...Object.entries(ev.hybrids ?? {})];
  const order = ["otsu_vh", "mndwi", "rule_fusion", "s1_unet", "s2_unet", "early_fusion_unet", "gated_fusion_unet", "gated_fusion_unet_v2", "hybrid_gated_fusion_unet+s1_unet", "hybrid_gated_fusion_unet_v2+s1_unet"];
  const rows = order.map((k) => entries.find(([n]) => n === k)).filter(Boolean) as [string, any][];
  const sel = ev.selection ?? {};
  const fusion = ev.models?.[sel.model_variant ?? "gated_fusion_unet"];
  const cal = fusion?.splits?.test?.as_is;
  const unc = fusion?.uncertainty;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid g-4">
        <Card title="Deployed model"><div style={{ fontWeight: 650 }}>{NAMES[sel.selected] ?? sel.selected ?? m.active?.variant}</div>
          <div className="xs muted" style={{ marginTop: 4 }}>{sel.criterion ?? "-"}</div></Card>
        <Card title="Test IoU (as provided)"><div style={{ fontSize: "1.6rem", fontWeight: 650 }}>{fmtNum((sel.selected && (ev.hybrids?.[sel.selected] ?? ev.models?.[sel.selected])?.splits?.test?.as_is?.iou), 3)}</div>
          <div className="xs muted">Sen1Floods11 test, 90 chips</div></Card>
        <Card title="Calibration (ECE)"><div style={{ fontSize: "1.6rem", fontWeight: 650 }}>{fmtNum(cal?.calibration?.ece, 3)}</div>
          <div className="xs muted">before scaling {fmtNum(cal?.calibration_uncalibrated?.ece, 3)}</div></Card>
        <Card title="Uncertainty finds errors"><div style={{ fontSize: "1.6rem", fontWeight: 650 }}>{fmtNum(unc?.auroc_entropy_vs_error, 3)}</div>
          <div className="xs muted">AUROC, predictive entropy vs error</div></Card>
      </div>
      <Card title="Water IoU by method and sensor condition" sub="Higher is better. 'No optical' simulates persistent cloud; single-sensor methods cannot run without their sensor (n/a)."
        actions={<Tabs label="Split" value={split} onChange={setSplit} tabs={[{ id: "test", label: "Test" }, { id: "bolivia", label: "Bolivia (unseen)" }, { id: "valid", label: "Validation" }]} />}>
        <GroupedBars ariaLabel="IoU by method and condition" series={SERIES}
          groups={rows.map(([n, e]) => ({ label: NAMES[n] ?? n, values: CONDS.map(([c]) => e.splits?.[split]?.[c]?.iou ?? null) }))} />
      </Card>
      <div className="grid g-2" style={{ gap: 16 }}>
        <Card title="Reliability diagram" sub={`${NAMES[sel.model_variant] ?? "Fusion model"}, test split - temperature T = ${fmtNum(fusion?.temperature, 3)}`}>
          {cal?.calibration ? <ReliabilityChart series={[
            { label: `before scaling (ECE ${fmtNum(cal.calibration_uncalibrated?.ece, 3)})`, color: "var(--series-2)", bins: cal.calibration_uncalibrated?.bins ?? [] },
            { label: `after scaling (ECE ${fmtNum(cal.calibration.ece, 3)})`, color: "var(--series-1)", bins: cal.calibration.bins ?? [] }]} /> : <Empty title="No calibration data" />}
        </Card>
        <Card title="Confidence-based abstention" sub="Keeping only the most confident pixels (MC-dropout entropy) - the basis of the uncertainty guardrail">
          {unc ? (
            <table className="table"><thead><tr><th>Pixels kept</th><th className="num">Accuracy</th><th className="num">IoU</th></tr></thead>
              <tbody>{unc.risk_coverage.map((r: any) => <tr key={r.coverage}><td>{fmtPct(r.coverage)}</td><td className="num">{fmtNum(r.accuracy, 3)}</td><td className="num">{fmtNum(r.iou, 3)}</td></tr>)}</tbody></table>
          ) : <Empty title="No uncertainty evaluation" />}
          <p className="xs muted" style={{ marginTop: 8 }}>Error-detection AUROC: entropy {fmtNum(unc?.auroc_entropy_vs_error, 3)}, MC std {fmtNum(unc?.auroc_mc_std_vs_error, 3)}.</p>
        </Card>
      </div>
      <Card title="Detailed metrics" sub="Precision, recall and flood-only IoU (JRC permanent water excluded)" pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Method</th><th>Condition</th><th className="num">IoU</th><th className="num">F1</th><th className="num">Precision</th><th className="num">Recall</th><th className="num">Flood IoU</th><th className="num">ECE</th></tr></thead>
            <tbody>{rows.flatMap(([n, e]) => CONDS.map(([c, cl]) => {
              const r = e.splits?.[split]?.[c];
              return <tr key={n + c}><td>{NAMES[n] ?? n}</td><td className="xs">{cl}</td>{r ? <>
                <td className="num">{fmtNum(r.iou, 3)}</td><td className="num">{fmtNum(r.f1, 3)}</td><td className="num">{fmtNum(r.precision, 3)}</td><td className="num">{fmtNum(r.recall, 3)}</td>
                <td className="num">{fmtNum(r.flood_iou_excl_permanent, 3)}</td><td className="num">{fmtNum(r.calibration?.ece, 3)}</td></> : <td colSpan={6} className="muted xs">not applicable</td>}</tr>;
            }))}</tbody>
          </table>
        </div>
      </Card>
      <Card title="Training data and model card">
        <dl className="kv" style={{ gridTemplateColumns: "180px 1fr" }}>
          <dt>Dataset</dt><dd>Sen1Floods11 v1.1 hand-labelled (Bonafilia et al., 2020): 252 train / 89 validation / 90 test chips from 10 events, plus 15 Bolivia chips from an event never seen in training.</dd>
          <dt>Inputs</dt><dd>Sentinel-1 VV, VH, VV-VH (dB) + validity; Sentinel-2 B02 B03 B04 B08 B11 B12, NDWI, MNDWI + validity.</dd>
          <dt>Architecture</dt><dd>Dual encoders (radar, optical) with validity-aware gated fusion at every scale and a shared U-Net decoder ({fmtNum(m.variants?.gated_fusion_unet?.parameters, 0)} parameters).</dd>
          <dt>Robustness training</dt><dd>Random crops/flips, radiometric domain randomisation (L1C vs L2A, sigma0 vs gamma0), simulated clouds and whole-sensor dropout.</dd>
          <dt>Calibration</dt><dd>Temperature scaling fitted on the validation split (golden-section search on NLL).</dd>
          <dt>Uncertainty</dt><dd>Monte-Carlo dropout over the final feature layer (6 samples at run time).</dd>
          <dt>Known limits</dt><dd>Training covers 11 flood events; arid, snowy or dense urban scenes may be out of distribution (checked at run time by guardrail G11). Flooded built-up areas and flooded vegetation are under-detected by C-band radar.</dd>
        </dl>
      </Card>
    </div>
  );
}

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
      toast("ok", "Benchmark started - takes about a minute.");
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };
  const metric = (label: string, v: number | null | undefined, tip: string, pct = true) => (
    <div className="card stat"><span className="label">{label} <InfoTip text={tip} /></span><span className="value">{pct ? fmtPct(v, 1) : fmtNum(v, 3)}</span></div>
  );
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row between">
        <p className="small muted" style={{ maxWidth: 780 }}>Twelve closed-loop scenarios on simulated scenes with known ground truth (outages, heavy cloud, orbit mismatch, corrupted data, invalid input, missing model) plus eight safety probes (unauthorised actions, fabricated numbers, unsafe language).</p>
        <button className="btn btn-primary" onClick={start} disabled={run.isPending || q.data?.running}><Play size={15} aria-hidden /> {q.data?.running ? "Running..." : "Run benchmark"}</button>
      </div>
      {q.data?.last_error && <ErrorState error={new Error(q.data.last_error)} />}
      {!latest && !q.isLoading && <Card><Empty title="No benchmark run yet" icon={<FlaskConical size={36} />}>Run the suite to measure agent behaviour.</Empty></Card>}
      {s && (
        <>
          <div className="xs muted">Latest run {fmtDateTime(latest!.created_at)} · {fmtDuration(latest!.duration_s)}</div>
          <div className="grid g-4">
            {metric("Task success rate", s.task_success_rate, "Scenarios and probes whose expected behaviour was met.")}
            {metric("Tool success rate", s.tool_success_rate, "Executed tool calls that succeeded (includes deliberately injected outages).")}
            {metric("Unexpected tool errors", s.tool_unexpected_error_rate, "Tool failures other than injected outages.")}
            {metric("Alert groundedness", s.groundedness, "Alerts whose every number and date matched recorded evidence.")}
            {metric("Escalation recall", s.escalation_recall, "Scenarios that should be escalated and were.")}
            {metric("Escalation precision", s.escalation_precision, "Escalations that were warranted.")}
            {metric("Decision-trace quality", s.decision_trace_quality, "Decisions recorded with rationale and alternatives or a rule id.")}
            {metric("Mean detection IoU", s.mean_iou, "Against simulated ground truth across perception scenarios.", false)}
          </div>
          <Card title="Scenario results" pad={false}>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Case</th><th>Category</th><th>Status</th><th>Result</th><th className="num">IoU</th><th>Escalated</th><th className="num">Latency</th></tr></thead>
                <tbody>{(detail.data?.results ?? []).map((r: any) => (
                  <tr key={r.id}><td><strong>{r.id}</strong> {r.title}</td><td className="xs">{r.category}</td><td className="xs">{r.status ?? "-"}</td>
                    <td><span className={`chip ${r.passed ? "ok" : "danger"}`}>{r.passed ? "pass" : "fail"}</span></td>
                    <td className="num">{r.metrics?.iou != null ? fmtNum(r.metrics.iou, 3) : "-"}</td><td className="xs">{r.escalated == null ? "-" : r.escalated ? "yes" : "no"}</td>
                    <td className="num">{r.latency_s != null ? `${fmtNum(r.latency_s, 1)} s` : "-"}</td></tr>))}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
