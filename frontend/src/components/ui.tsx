import { AlertCircle, CheckCircle2, ChevronDown, FlaskConical, Info, RefreshCw, X } from "lucide-react";
import {
  createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { AnalysisStatus, Category, Hazard } from "@/api/types";
import { CONFIDENCE, HAZARDS, PRIORITY, STATUS } from "@/lib/meta";
import { friendlyError } from "@/lib/plain";

// ----------------------------------------------------------------------------- chips
export function StatusChip({ status }: { status: AnalysisStatus }) {
  const m = STATUS[status] ?? STATUS.queued;
  return (
    <span className={`chip ${m.tone}`} title={m.help}>
      {status === "running" ? <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} aria-hidden /> : m.icon}
      {m.label}
    </span>
  );
}

export function PriorityChip({ category, override, short }: { category: Category; override?: boolean; short?: boolean }) {
  const p = PRIORITY[category];
  return (
    <span className={`chip prio prio-${category}`} title={p.meaning}>
      <span className="swatch" style={{ background: p.color }} aria-hidden />
      {category}
      {short && <span style={{ fontWeight: 500 }}>· {p.short}</span>}
      {override && <span style={{ fontWeight: 500 }}>(changed by a person)</span>}
    </span>
  );
}

export function HazardChip({ hazard }: { hazard: Hazard }) {
  const h = HAZARDS[hazard];
  return (
    <span className="chip" style={{ background: h.soft, color: "var(--ink)" }}>
      <span style={{ color: h.color, display: "inline-flex" }}>{h.icon(15)}</span>
      {h.label}
    </span>
  );
}

export function PracticeChip({ onImage }: { onImage?: boolean }) {
  return (
    <span className={`chip practice`} style={onImage ? { background: "rgba(255,255,255,.95)" } : undefined}
      title="Made-up satellite data for practice and testing. It never shows a real place or event.">
      <FlaskConical size={14} aria-hidden /> Practice data
    </span>
  );
}

export function ConfidenceMeter({ level, compact }: { level: string | null | undefined; compact?: boolean }) {
  if (!level || !CONFIDENCE[level]) return null;
  const c = CONFIDENCE[level];
  if (compact) {
    return (
      <span className="chip outline" title={c.text}>
        <span className={`sure-meter lvl-${c.level}`} aria-hidden style={{ gap: 2 }}>
          <span style={{ width: 10, height: 6 }} /><span style={{ width: 10, height: 6 }} /><span style={{ width: 10, height: 6 }} />
        </span>
        {c.label} confidence
      </span>
    );
  }
  return (
    <div className="sure" role="group" aria-label={`How sure we are: ${c.label}`}>
      <span className={`sure-meter lvl-${c.level}`} aria-hidden><span /><span /><span /></span>
      <div className="small">
        <strong>How sure: {c.label}.</strong> <span className="ink-2">{c.text}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- help
export function InfoTip({ text, label = "What does this mean?" }: { text: string; label?: string }) {
  const id = useId();
  return (
    <span className="info-tip" tabIndex={0} aria-label={label} aria-describedby={id} role="button">
      <Info size={16} aria-hidden />
      <span className="tip" id={id} role="tooltip">{text}</span>
    </span>
  );
}

export function Callout({ tone = "info", icon, children, title, role }: {
  tone?: "info" | "warn" | "danger" | "ok" | "practice" | "neutral"; icon?: ReactNode; title?: ReactNode; children?: ReactNode; role?: string;
}) {
  return (
    <div className={`callout ${tone}`} role={role}>
      {icon ?? (tone === "danger" || tone === "warn" ? <AlertCircle size={20} aria-hidden /> : <Info size={20} aria-hidden />)}
      <div className="grow">
        {title && <strong style={{ display: "block", marginBottom: children ? 2 : 0 }}>{title}</strong>}
        {children}
      </div>
    </div>
  );
}

/** Progressive disclosure built on <details>, so it works with keyboard and screen readers out of the box. */
export function Disclosure({ summary, children, defaultOpen, boxed, id }: {
  summary: ReactNode; children: ReactNode; defaultOpen?: boolean; boxed?: boolean; id?: string;
}) {
  return (
    <details className={`disclosure ${boxed ? "boxed" : ""}`} open={defaultOpen} id={id}>
      <summary><span>{summary}</span><ChevronDown size={20} className="chev" aria-hidden /></summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}

// ----------------------------------------------------------------------------- states
export function Empty({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-art">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="small" style={{ maxWidth: 520 }}>{children}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "That didn't work" }: { error: unknown; onRetry?: () => void; title?: string }) {
  return (
    <div className="callout danger" role="alert">
      <AlertCircle size={20} aria-hidden />
      <div className="grow">
        <strong>{title}.</strong> {friendlyError(error)}
      </div>
      {onRetry && <button className="btn btn-sm" onClick={onRetry}><RefreshCw size={15} aria-hidden /> Try again</button>}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden /> {label}…
    </div>
  );
}

export function Skeleton({ h = 16, w = "100%", r }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />;
}

// ----------------------------------------------------------------------------- modal
export function Modal({ title, open, onClose, children, footer }: { title: string; open: boolean; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        // keep keyboard focus inside the dialog
        const els = [...ref.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
        if (!els.length) return;
        const first = els[0];
        const last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close" data-close><X size={20} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ----------------------------------------------------------------------------- tabs
export function Tabs<T extends string>({ tabs, value, onChange, label, variant = "pill", idBase }: {
  tabs: { id: T; label: ReactNode; badge?: number; icon?: ReactNode }[]; value: T; onChange: (t: T) => void; label: string;
  variant?: "pill" | "underline" | "grid"; idBase?: string;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next == null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[tabs[next].id]?.focus();
  };
  return (
    <div className={variant === "pill" ? "tabs" : variant === "grid" ? "tabs-grid" : "tabs-underline"} role="tablist" aria-label={label} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el; }} role="tab" className="tab" id={idBase ? `${idBase}-tab-${t.id}` : undefined}
          aria-controls={idBase ? `${idBase}-panel` : undefined} aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onClick={() => onChange(t.id)}>
          {t.icon}
          {t.label}
          {t.badge ? <span className="badge">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------- toasts
type Toast = { id: number; kind: "ok" | "error" | "info"; text: string };
const ToastCtx = createContext<(kind: Toast["kind"], text: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 8000 : 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "error" ? <AlertCircle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
            <span className="grow">{t.text}</span>
            <button className="btn btn-ghost btn-sm icon-btn" style={{ color: "#fff", minHeight: 26, width: 26 }} aria-label="Dismiss"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}><X size={15} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ----------------------------------------------------------------------------- small layout helpers
export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv-list">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHead({ eyebrow, title, lead, actions }: { eyebrow?: ReactNode; title: ReactNode; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div style={{ maxWidth: 760 }}>
        {eyebrow && <div className="eyebrow" style={{ marginBottom: 12 }}>{eyebrow}</div>}
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="row-wrap">{actions}</div>}
    </header>
  );
}
