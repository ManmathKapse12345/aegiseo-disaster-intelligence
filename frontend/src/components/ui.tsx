import { AlertCircle, CheckCircle2, FlaskConical, Info, Inbox, RefreshCw, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AnalysisStatus, Category, Hazard } from "@/api/types";
import { errorMessage } from "@/api/client";
import { HAZARDS, PRIORITY, STATUS } from "@/lib/meta";

export function Card({ title, sub, actions, children, className = "", pad = true, id }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean; id?: string;
}) {
  return (
    <section className={`card ${className}`} id={id} aria-label={typeof title === "string" ? title : undefined}>
      {(title || actions) && (
        <header className="card-head">
          <div className="grow">
            {title && <h3>{title}</h3>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

export function StatusChip({ status }: { status: AnalysisStatus }) {
  const m = STATUS[status] ?? STATUS.queued;
  return (
    <span className={`chip ${m.tone}`} title={m.help}>
      {status === "running" ? <span className="spinner" style={{ width: 12, height: 12 }} aria-hidden /> : m.icon}
      {m.label}
    </span>
  );
}

export function PriorityChip({ category, override }: { category: Category; override?: boolean }) {
  const p = PRIORITY[category];
  return (
    <span className={`chip prio prio-${category}`} title={p.meaning}>
      <span className="swatch" style={{ background: p.color }} aria-hidden />
      {category}
      {override && <span className="muted" style={{ fontWeight: 500 }}>(override)</span>}
    </span>
  );
}

export function HazardChip({ hazard }: { hazard: Hazard }) {
  const h = HAZARDS[hazard];
  return (
    <span className="chip outline">
      <span style={{ color: h.color, display: "inline-flex" }}>{h.icon(13)}</span>
      {h.label}
    </span>
  );
}

export function SyntheticChip() {
  return (
    <span className="chip synthetic" title="Results come from a simulated scene and never describe a real place or event">
      <FlaskConical size={13} aria-hidden /> Simulated data
    </span>
  );
}

export function ConfidenceChip({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  const tone = level === "High" ? "ok" : level === "Medium" ? "info" : "warn";
  return <span className={`chip ${tone}`} title="Overall confidence from model uncertainty, cross-method agreement and data completeness">{level} confidence</span>;
}

export function InfoTip({ text, label = "More information" }: { text: string; label?: string }) {
  const id = useId();
  return (
    <span className="info-tip" tabIndex={0} aria-describedby={id} aria-label={label} role="note">
      <Info size={14} aria-hidden />
      <span className="tip" id={id} role="tooltip">{text}</span>
    </span>
  );
}

export function Stat({ label, value, sub, icon, tip }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tip?: string }) {
  return (
    <div className="card stat">
      <div className="row between">
        <span className="label">{label}{tip && <InfoTip text={tip} />}</span>
        {icon && <span className="icon" aria-hidden>{icon}</span>}
      </div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={36} aria-hidden />}
      <strong style={{ color: "var(--ink-2)" }}>{title}</strong>
      {children && <div className="small">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="banner danger" role="alert">
      <AlertCircle size={18} aria-hidden />
      <div className="grow">
        <strong>Something went wrong.</strong> {errorMessage(error)}
      </div>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}><RefreshCw size={14} aria-hidden /> Retry</button>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="row muted small" role="status" style={{ padding: 16 }}>
      <span className="spinner" aria-hidden /> {label}...
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%" }: { h?: number; w?: number | string }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden />;
}

export function Modal({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("button, input, textarea, select, [tabindex]")?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head row between">
          <h3>{title}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: { id: T; label: ReactNode; badge?: number }[]; value: T; onChange: (t: T) => void; label: string;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length].id);
    if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" className="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "error" ? <AlertCircle size={16} aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
