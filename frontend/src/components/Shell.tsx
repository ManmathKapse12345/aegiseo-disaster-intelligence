import {
  Activity, BellRing, BookOpenText, Boxes, ChevronRight, ClipboardCheck, Database, FlaskConical, LayoutDashboard, ListChecks, LogIn,
  Menu, Radar, Satellite, ShieldCheck, UserCircle2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { setToken } from "@/api/client";
import { useDashboard, useHealth, useMe } from "@/api/hooks";
import { Modal } from "./ui";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/analyze", label: "New analysis", icon: Radar },
  { to: "/analyses", label: "Analyses", icon: ListChecks },
  { section: "Human review" },
  { to: "/review", label: "Review queue", icon: ClipboardCheck, badge: "reviews" },
  { to: "/alerts", label: "Alerts", icon: BellRing, badge: "alerts" },
  { section: "System" },
  { to: "/sources", label: "Data sources", icon: Database },
  { to: "/model", label: "Model & benchmarks", icon: FlaskConical },
  { to: "/methodology", label: "How it works", icon: BookOpenText },
] as const;

const TITLES: Record<string, string> = {
  "": "Overview", analyze: "New analysis", analyses: "Analyses", review: "Review queue", alerts: "Alerts", sources: "Data sources",
  model: "Model & benchmarks", methodology: "How it works",
};

export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const dash = useDashboard();
  const health = useHealth();
  const me = useMe();
  const [signIn, setSignIn] = useState(false);
  const [token, setTok] = useState("");
  useEffect(() => setOpen(false), [loc.pathname]);
  const parts = loc.pathname.split("/");
  const seg = parts[1] ?? "";
  const crumb = seg === "analyses" && parts[2] ? "Analysis" : (TITLES[seg] ?? "Not found");
  const counts = { reviews: dash.data?.review.open_tasks ?? 0, alerts: dash.data?.review.alerts_pending ?? 0 };
  const apiUp = health.isSuccess;

  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Link to="/" className="brand" style={{ textDecoration: "none" }}>
          <span className="brand-mark"><Satellite size={19} aria-hidden /></span>
          <span>
            <div className="brand-name" style={{ color: "var(--ink)" }}>AegisEO</div>
            <div className="brand-sub">Disaster intelligence</div>
          </span>
        </Link>
        <nav className="nav" aria-label="Primary navigation">
          {NAV.map((n, i) =>
            "section" in n ? (
              <div key={i} className="nav-section">{n.section}</div>
            ) : (
              <NavLink key={n.to} to={n.to} end={"end" in n} className={({ isActive }) => (isActive ? "active" : "")}>
                <n.icon size={17} aria-hidden />
                {n.label}
                {"badge" in n && counts[n.badge] > 0 && <span className="count" aria-label={`${counts[n.badge]} pending`}>{counts[n.badge]}</span>}
              </NavLink>
            ),
          )}
        </nav>
        <div className="sidebar-foot">
          <div className="row" style={{ marginBottom: 6 }}>
            <ShieldCheck size={14} aria-hidden /> <strong style={{ color: "var(--ink-2)" }}>Advisory mode</strong>
          </div>
          The agent drafts; people decide. Nothing is published without human approval.
        </div>
      </aside>
      {open && <div className="modal-backdrop" style={{ zIndex: 55, background: "rgba(15,27,45,.25)" }} onClick={() => setOpen(false)} />}
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-btn" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="crumbs">
            <span>AegisEO</span><ChevronRight size={14} aria-hidden />
            <strong>{crumb}</strong>
          </div>
          <div className="spacer" />
          <span className={`chip ${apiUp ? "ok" : health.isLoading ? "" : "danger"}`} title={apiUp ? `API online - v${health.data?.version}` : "API unreachable"}>
            <Activity size={13} aria-hidden /> {apiUp ? "Systems online" : health.isLoading ? "Connecting" : "API offline"}
          </span>
          {dash.data && dash.data.analyses.running > 0 && (
            <span className="chip info"><span className="spinner" style={{ width: 11, height: 11 }} aria-hidden /> {dash.data.analyses.running} running</span>
          )}
          {me.data && (me.data.auth_enabled && me.isError ? null : (
            <span className="chip outline" title={`Signed in as ${me.data.user} (${me.data.role})`}><UserCircle2 size={14} aria-hidden /> {me.data.user} · {me.data.role}</span>
          ))}
          {me.isError && (
            <button className="btn btn-sm" onClick={() => setSignIn(true)}><LogIn size={14} aria-hidden /> Sign in</button>
          )}
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
      <Modal title="Sign in with an access token" open={signIn} onClose={() => setSignIn(false)}
        footer={<><button className="btn" onClick={() => setSignIn(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={() => { setToken(token.trim() || null); window.location.reload(); }}>Sign in</button></>}>
        <div className="field">
          <label htmlFor="tok">Access token</label>
          <input id="tok" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setTok(e.target.value)} />
          <span className="hint">Tokens are issued by your administrator (AEGIS_API_TOKENS) and kept only for this browser session.</span>
        </div>
      </Modal>
      <Onboarding />
    </div>
  );
}

const STEPS = [
  { icon: Radar, title: "Choose an area and a hazard", text: "Pick a case study, a live alert, or draw any area. Choose flood, wildfire or landslide and the event date." },
  { icon: Satellite, title: "The agent gathers evidence", text: "It finds Sentinel-1 radar and Sentinel-2 optical images before and after the event, checks cloud cover and data quality, and loads terrain, water, land-cover, population and infrastructure layers." },
  { icon: Boxes, title: "Detection, exposure, priorities", text: "A multi-sensor model maps the change with calibrated confidence. The agent estimates who and what may be exposed and ranks response cells with plain-language explanations." },
  { icon: ClipboardCheck, title: "You stay in control", text: "Uncertain or high-impact findings are routed to the review queue. Alerts are drafts until a person approves them; every number links back to its evidence." },
];

function Onboarding() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  useEffect(() => {
    try {
      if (!localStorage.getItem("aegis.onboarded")) setOpen(true);
    } catch {
      /* storage unavailable: skip onboarding */
    }
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem("aegis.onboarded", "1");
    } catch {
      /* ignore */
    }
  };
  const s = STEPS[i];
  return (
    <Modal title="Welcome to AegisEO" open={open} onClose={close}
      footer={<>
        <button className="btn btn-ghost" onClick={close}>Skip</button>
        {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
        {i < STEPS.length - 1 ? <button className="btn btn-primary" onClick={() => setI(i + 1)}>Next</button>
          : <button className="btn btn-primary" onClick={close}>Get started</button>}
      </>}>
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 6 }}>{STEPS.map((_, k) => <span key={k} style={{ height: 4, flex: 1, borderRadius: 2, background: k <= i ? "var(--brand)" : "var(--line)" }} />)}</div>
        <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
          <span className="stat"><span className="icon" style={{ width: 44, height: 44, borderRadius: 12 }}><s.icon size={22} aria-hidden /></span></span>
          <div>
            <h3 style={{ marginBottom: 6 }}>{s.title}</h3>
            <p className="muted">{s.text}</p>
          </div>
        </div>
        <p className="xs muted">Step {i + 1} of {STEPS.length}. You can revisit this guide on the "How it works" page.</p>
      </div>
    </Modal>
  );
}
