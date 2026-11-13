import { ClipboardCheck, ListChecks, MessageSquareWarning, PartyPopper, PencilLine, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAlerts, useConfig, useReviews } from "@/api/hooks";
import { PersonInChargeIllustration } from "@/components/illustrations";
import { Disclosure, Empty, ErrorState, Loading, PageHead, Tabs } from "@/components/ui";
import { useDocumentTitle } from "@/lib/hooks";
import { AlertCard, ReviewCard } from "./ReviewCards";

export function ReviewPage() {
  useDocumentTitle("To review");
  const loc = useLocation();
  const [view, setView] = useState<"waiting" | "done">("waiting");
  const [section, setSection] = useState<"findings" | "warnings">(loc.pathname.startsWith("/alerts") ? "warnings" : "findings");
  const openTasks = useReviews("open");
  const doneTasks = useReviews("resolved");
  const pending = useAlerts("pending_review");
  const all = useAlerts();
  const nTasks = openTasks.data?.items.length ?? 0;
  const nAlerts = pending.data?.items.length ?? 0;
  const decided = (all.data?.items ?? []).filter((a) => a.status !== "pending_review");

  // links such as /review#how open the explanation
  useEffect(() => {
    if (loc.hash === "#how") requestAnimationFrame(() => document.getElementById("how")?.scrollIntoView({ block: "start" }));
  }, [loc.hash]);

  return (
    <div className="page page-narrow page-enter">
      <PageHead title="To review" lead="AegisEO never sends anything or changes a result on its own. Items that need a person's judgement, and every draft warning, wait here until a person decides. Each decision is saved with the person's name." />
      <div id="how">
        <Disclosure summary="How reviewing works: safety checks, findings, draft warnings and approval" boxed defaultOpen={loc.hash === "#how" || (nTasks + nAlerts > 0 && !decided.length)}>
          <ReviewExplained />
        </Disclosure>
      </div>

      <div className="row-wrap between" style={{ margin: "28px 0 20px", gap: 12 }}>
        <Tabs label="Show" value={view} onChange={setView} tabs={[
          { id: "waiting", label: "Waiting", badge: nTasks + nAlerts || undefined }, { id: "done", label: "Already decided" }]} />
      </div>

      {view === "waiting" && (
        <>
          <Tabs label="Kind of item" variant="underline" value={section} onChange={setSection} tabs={[
            { id: "findings", label: "Findings to double-check", badge: nTasks || undefined },
            { id: "warnings", label: "Draft warnings", badge: nAlerts || undefined }]} />
          <div style={{ marginTop: 20 }}>
            {section === "findings" && (
              <>
                {openTasks.isError && <ErrorState error={openTasks.error} onRetry={() => openTasks.refetch()} />}
                {openTasks.isLoading && <Loading />}
                {openTasks.data && nTasks === 0 && (
                  <div className="card"><Empty title="Nothing to double-check" icon={<PartyPopper size={40} aria-hidden />}>
                    A finding appears here when a safety check needs a person's judgement, or when a high-priority square has weak evidence.</Empty></div>
                )}
                {openTasks.data?.items.map((t) => <ReviewCard key={t.id} task={t} />)}
              </>
            )}
            {section === "warnings" && (
              <>
                {pending.isError && <ErrorState error={pending.error} onRetry={() => pending.refetch()} />}
                {pending.isLoading && <Loading />}
                {pending.data && nAlerts === 0 && (
                  <div className="card"><Empty title="No warnings waiting" icon={<ClipboardCheck size={40} aria-hidden />}>
                    Draft warnings appear here after every finished check: one for the whole area and one for each Critical or High square.</Empty></div>
                )}
                {pending.data?.items.map((a) => <AlertCard key={a.id} alert={a} />)}
              </>
            )}
          </div>
        </>
      )}

      {view === "done" && (
        <div className="stack-lg">
          <section>
            <h3 style={{ marginBottom: 12 }}>Findings</h3>
            {doneTasks.isLoading && <Loading />}
            {doneTasks.data && doneTasks.data.items.length === 0 && <p className="small muted">No findings have been decided yet.</p>}
            {doneTasks.data?.items.map((t) => <ReviewCard key={t.id} task={t} />)}
          </section>
          <section>
            <h3 style={{ marginBottom: 12 }}>Warnings</h3>
            {all.isLoading && <Loading />}
            {all.data && decided.length === 0 && <p className="small muted">No warnings have been decided yet.</p>}
            {decided.map((a) => <AlertCard key={a.id} alert={a} />)}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * The four parts of human review, each stated as: what it is, why it appears, what you do, what happens next.
 * Every statement mirrors the backend: guardrails (agents/guardrails.py), review tasks and alerts (agents/orchestrator.py,
 * agents/narrative.py), decisions (actions.py) and the recall of corrections (agents/memory.py).
 */
function ReviewExplained() {
  const delivery = useConfig().data?.features.alert_delivery;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <PersonInChargeIllustration />
      <div className="explain-grid">
        <ExplainCard icon={<ShieldCheck size={20} aria-hidden />} title="1. Safety checks" who="Automatic - nothing to do" rows={[
          ["What they are", "18 automatic tests that run during every check: on the request (size, dates), on the satellite images (clouds, missing images, orbits), on the result (unusual scene, uncertainty, very large area) and on any text written for people."],
          ["Possible results", <>Each check <strong>passes</strong>, records a <strong>note</strong>, says it <strong>needs a person</strong>, or <strong>stops</strong> something unsafe (an invalid request, or warning text whose numbers don't match the measurements).</>],
          ["What happens next", "Notes are shown on the result page; the check ends as \"Done, with notes\". If any check needs a person, the check ends as \"Needs a person to check\" and a finding appears below."],
        ]} />
        <ExplainCard icon={<ListChecks size={20} aria-hidden />} title="2. Findings to double-check" who="A person decides" rows={[
          ["Why they appear", "A safety check needed human judgement (for example: the area looks unlike the floods the model learned from, the two detection methods disagree, more than 60% of the area was marked, or possible landslides were found), or a Critical or High square has low confidence."],
          ["What you do", "Open the map, compare the 'before' and 'after' images, then choose Looks right, It's wrong, Noted, or Run it again. You can add a note."],
          ["What happens next", "Your choice and name are saved. \"It's wrong\" lowers the square to Low and rejects its waiting draft warnings; \"Run it again\" starts a fresh copy of the check. When the last open finding of a check is answered, its status changes to \"Done, with notes\"."],
        ]} />
        <ExplainCard icon={<MessageSquareWarning size={20} aria-hidden />} title="3. Draft warnings and approval" who="A person approves or rejects" rows={[
          ["Why they appear", "After every finished check, AegisEO drafts one short message about the whole area and one for each Critical or High square (at most 5). Every number and date in the text is compared with the measurements, and the wording is checked; text that fails is withheld."],
          ["What you do", "Read the message and its evidence, then press Approve or Reject (an optional note is saved with your decision)."],
          ["What happens next", <>Approve records your name. A warning is sent outside AegisEO only if the administrator set up a delivery channel (a webhook){delivery === false ? "; this server has none, so approved warnings stay inside AegisEO" : delivery === true ? "; this server has one" : ""}. Practice-data warnings are never sent. A rejected warning is never sent.</>],
        ]} />
        <ExplainCard icon={<PencilLine size={20} aria-hidden />} title="4. Priority changes" who="Optional" rows={[
          ["What they are", "On a result page, under \"Where to help first\", you can change a square's priority when you know something the images can't show, such as a report from the ground."],
          ["What happens next", "A reason is required. Your name and reason appear in the report, and AegisEO's own ranking is kept beside your change."],
          ["Remembered later", "When someone checks an overlapping area later, AegisEO lists these corrections (findings marked wrong, rejected warnings, changed priorities) on the new result. It does not change the new result because of them."],
        ]} />
      </div>
    </div>
  );
}

function ExplainCard({ icon, title, who, rows }: { icon: ReactNode; title: string; who: string; rows: [string, ReactNode][] }) {
  return (
    <section className="explain-card">
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        <span className="explain-icon" aria-hidden>{icon}</span>
        <div><h4 style={{ margin: 0 }}>{title}</h4><span className="caption muted">{who}</span></div>
      </div>
      <dl>
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
    </section>
  );
}
