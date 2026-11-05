import { ClipboardCheck, PartyPopper } from "lucide-react";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useAlerts, useReviews } from "@/api/hooks";
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

  return (
    <div className="page page-narrow page-enter">
      <PageHead title="To review" lead="AegisEO never acts on its own. When it is unsure, or when a warning is ready, it waits here for a person. Your decisions are saved with your name." />
      <Disclosure summary="How reviewing works" boxed>
        <PersonInChargeIllustration />
        <ul className="small ink-2" style={{ marginTop: 12 }}>
          <li><strong>Unsure findings</strong> appear when a safety check fails - for example heavy cloud, or two methods that disagree. Look at the map, then say whether the result looks right.</li>
          <li><strong>Draft warnings</strong> are short messages about high-priority places. They are only sent if a person approves them, and practice-data warnings are never sent.</li>
          <li>When every finding of a check is answered, its status changes from "Needs a person to check" to "Done, with notes".</li>
          <li>If someone checks the same area again later, AegisEO shows that people corrected earlier results there.</li>
        </ul>
      </Disclosure>

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
                    When AegisEO is unsure about a result, it will appear here.</Empty></div>
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
                    Draft warnings appear here after a check finds high-priority places.</Empty></div>
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
