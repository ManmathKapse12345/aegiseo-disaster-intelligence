import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, MapPinned, RefreshCcw, ShieldCheck, ThumbsDown, ThumbsUp, XCircle } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useAlertDecision, useReviewDecision } from "@/api/hooks";
import type { Alert, ReviewTask } from "@/api/types";
import { Disclosure, PracticeChip, PriorityChip, useToast } from "@/components/ui";
import { fmtDateTime, timeAgo } from "@/lib/format";
import { HAZARDS } from "@/lib/meta";
import { type ReviewDecisionKind, decisionEffects, friendlyError, reviewStory } from "@/lib/plain";

const DECISION_ICON: Record<ReviewDecisionKind, typeof ThumbsUp> = { confirm: ThumbsUp, false_positive: ThumbsDown, acknowledge: Eye, request_rerun: RefreshCcw };
const DECISION_DONE: Record<string, string> = { confirm: "Looks right", false_positive: "Marked wrong", acknowledge: "Noted", request_rerun: "Run again" };

export function ReviewCard({ task, showAnalysis = true, onOpenMap, defaultOpen = false }: {
  task: ReviewTask; showAnalysis?: boolean; onOpenMap?: (cell: string | null) => void; defaultOpen?: boolean;
}) {
  const decide = useReviewDecision();
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState(defaultOpen);
  const story = reviewStory(task);
  const effects = decisionEffects(task);
  const cell = typeof task.payload?.cell_id === "string" ? task.payload.cell_id : null;

  const act = async (decision: ReviewDecisionKind) => {
    try {
      const r = await decide.mutateAsync({ id: task.id, decision, comment: comment.trim() || undefined });
      if (r.rerun_analysis_id) {
        toast("ok", "Saved. A fresh copy of the check has started.");
        nav(`/results/${r.rerun_analysis_id}`);
        return;
      }
      toast("ok", `Saved: "${effects[decision].label}". ${decision === "false_positive" ? effects.false_positive.effect : ""}`.trim());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ["reviews"] });
      toast("error", friendlyError(e));
    }
  };

  if (task.status === "resolved") {
    return (
      <article className="review-card">
        <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
          <strong>{story.title}</strong>
          <span className="chip ok"><CheckCircle2 size={14} aria-hidden /> {DECISION_DONE[task.decision ?? ""] ?? task.decision}</span>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          By {task.decided_by} · {timeAgo(task.decided_at)}{task.comment ? ` · "${task.comment}"` : ""}
          {task.analysis_name && <> · <Link to={`/results/${task.analysis_id}`}>{task.analysis_name}</Link></>}
        </p>
      </article>
    );
  }

  return (
    <article className="review-card" aria-label={story.title}>
      <div className="row-wrap" style={{ gap: 8 }}>
        <span className="chip warn">{task.kind === "verify_detection" ? "Check a square" : "Unsure finding"}</span>
        {task.hazard && <span className="chip outline">{HAZARDS[task.hazard].icon(14)} {HAZARDS[task.hazard].label}</span>}
        {task.mode === "synthetic" && <PracticeChip />}
        <span className="caption muted" style={{ marginLeft: "auto" }}>{timeAgo(task.created_at)}</span>
      </div>
      <h4 style={{ marginTop: 12 }}>{story.title}</h4>
      {showAnalysis && task.analysis_name && <p className="small muted" style={{ marginTop: 2 }}>In: <Link to={`/results/${task.analysis_id}`}>{task.analysis_name}</Link></p>}
      {!open && (
        <>
          <p className="small ink-2 clamp-2" style={{ marginTop: 8 }}>{story.why}</p>
          <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setOpen(true)} aria-expanded={false}>Look and decide</button>
        </>
      )}
      {open && <>
      <div className="review-why">
        <p><strong>Why you're asked:</strong> {story.why}</p>
        {story.look && <p style={{ marginTop: 8 }}><strong>What to look at:</strong> {story.look}</p>}
        {onOpenMap ? (
          <button className="linklike small" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10 }} onClick={() => onOpenMap(cell)}>
            <MapPinned size={15} aria-hidden /> {cell ? `Show square ${cell} on the map` : "Show it on the map"}
          </button>
        ) : (
          <Link to={`/results/${task.analysis_id}${cell ? `?square=${cell}` : ""}`} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10 }}>
            <MapPinned size={15} aria-hidden /> Open the map{cell ? ` at square ${cell}` : ""}
          </Link>
        )}
      </div>
      <div style={{ marginTop: 6 }}>
        <Disclosure summary={<span className="small">Technical detail</span>}><p className="small ink-2"><code>{story.technical}</code></p></Disclosure>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label className="label" htmlFor={`c-${task.id}`}>Your note <span className="muted" style={{ fontWeight: 400 }}>(optional, saved with your decision)</span></label>
        <input id={`c-${task.id}`} className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Compared the photos - the water is real" />
      </div>
      <div className="decision-grid" role="group" aria-label="Your decision">
        {(Object.keys(effects) as ReviewDecisionKind[]).map((k) => {
          const Icon = DECISION_ICON[k];
          return (
            <button key={k} className={`decision ${k === "confirm" ? "ok" : k === "false_positive" ? "danger" : ""}`} disabled={decide.isPending} onClick={() => act(k)}>
              <strong><Icon size={16} aria-hidden /> {effects[k].label}</strong>
              <span>{effects[k].effect}</span>
            </button>
          );
        })}
      </div>
      </>}
    </article>
  );
}

const ALERT_STATUS: Record<Alert["status"], { label: string; tone: string }> = {
  pending_review: { label: "Waiting for approval", tone: "warn" }, approved: { label: "Approved (not sent)", tone: "ok" },
  published: { label: "Approved and sent", tone: "ok" }, rejected: { label: "Rejected", tone: "" },
};

function deliveryText(d: Record<string, unknown> | null): string | null {
  if (!d) return null;
  if (d.delivered) return "Sent to your organisation's delivery channel.";
  if (d.channel === "internal") return "Kept inside AegisEO - no delivery channel is set up.";
  if (d.channel === "none") return `Not sent: ${String(d.reason ?? "not allowed")}.`;
  if (d.error) return `Sending failed: ${String(d.error)}`;
  return null;
}

export function AlertCard({ alert, showAnalysis = true, defaultOpen = false }: { alert: Alert; showAnalysis?: boolean; defaultOpen?: boolean }) {
  const decide = useAlertDecision();
  const toast = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [deciding, setDeciding] = useState(defaultOpen);
  const st = ALERT_STATUS[alert.status];
  const long = alert.body.length > 360;

  const act = async (decision: "approve" | "reject") => {
    try {
      const r = await decide.mutateAsync({ id: alert.id, decision, note: note.trim() || undefined });
      toast("ok", decision === "reject" ? "Rejected. It won't be sent." : `Approved. ${deliveryText(r.delivery) ?? ""}`.trim());
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries({ queryKey: ["alerts"] });
      toast("error", friendlyError(e));
    }
  };

  return (
    <article className="review-card" aria-label={`Draft warning: ${alert.title}`}>
      <div className="row-wrap" style={{ gap: 8 }}>
        <PriorityChip category={alert.severity} />
        <span className={`chip ${st.tone}`}>{st.label}</span>
        {alert.grounding?.verified
          ? <span className="chip ok" title="Every number and date in the text matches a measured value"><ShieldCheck size={14} aria-hidden /> Numbers checked</span>
          : <span className="chip danger" title="The text failed the number check and was withheld">Text withheld</span>}
        {alert.synthetic && <PracticeChip />}
        <span className="caption muted" style={{ marginLeft: "auto" }}>{fmtDateTime(alert.created_at)}</span>
      </div>
      <h4 style={{ marginTop: 12 }}>{alert.title}</h4>
      {showAnalysis && alert.analysis_name && <p className="small muted" style={{ marginTop: 2 }}>From: <Link to={`/results/${alert.analysis_id}`}>{alert.analysis_name}</Link></p>}
      <blockquote style={{ margin: "12px 0 0", padding: "12px 16px", borderLeft: "3px solid var(--line-strong)", background: "var(--surface-2)", borderRadius: "0 10px 10px 0" }}>
        <div className="caption muted" style={{ marginBottom: 4 }}>The message that would be sent</div>
        <p className={`small ${deciding || alert.status !== "pending_review" ? "" : "clamp-2"}`} style={{ color: "var(--ink)" }}>{long && !open ? `${alert.body.slice(0, 360)}…` : alert.body}</p>
        {long && (deciding || alert.status !== "pending_review") && <button className="linklike small" style={{ marginTop: 6 }} onClick={() => setOpen((o) => !o)}>{open ? "Show less" : "Read all"}</button>}
      </blockquote>
      <div style={{ marginTop: 6, display: deciding || alert.status !== "pending_review" ? "block" : "none" }}>
        <Disclosure summary={<span className="small">Evidence behind it ({alert.evidence.length} items)</span>}>
          <div className="row-wrap" style={{ gap: 6 }}>{alert.evidence.map((e) => <code key={e} className="chip outline">{e}</code>)}</div>
        </Disclosure>
      </div>
      {alert.status === "pending_review" && !deciding && (
        <button className="btn btn-sm" style={{ marginTop: 12 }} onClick={() => setDeciding(true)} aria-expanded={false}>Read and decide</button>
      )}
      {alert.status === "pending_review" ? deciding && (
        <>
          <div className="field" style={{ marginTop: 14 }}>
            <label className="label" htmlFor={`n-${alert.id}`}>Your note <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <input id={`n-${alert.id}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Confirmed with the local team" />
          </div>
          <div className="decision-grid" role="group" aria-label="Your decision">
            <button className="decision ok" disabled={decide.isPending} onClick={() => act("approve")}>
              <strong><CheckCircle2 size={16} aria-hidden /> Approve</strong>
              <span>{alert.synthetic ? "Marks it approved. Practice warnings are never sent anywhere." : "Marks it approved. It is sent to your organisation's delivery channel if one is set up; otherwise it stays in AegisEO."}</span>
            </button>
            <button className="decision danger" disabled={decide.isPending} onClick={() => act("reject")}>
              <strong><XCircle size={16} aria-hidden /> Reject</strong>
              <span>It won't be sent. Later checks of the same area will show that someone corrected this.</span>
            </button>
          </div>
        </>
      ) : (
        <p className="small muted" style={{ marginTop: 12 }}>
          {alert.decided_by ? `Decided by ${alert.decided_by}, ${fmtDateTime(alert.decided_at)}.` : ""}
          {alert.decision_note ? ` Note: "${alert.decision_note}".` : ""} {deliveryText(alert.delivery) ?? ""}
        </p>
      )}
    </article>
  );
}
