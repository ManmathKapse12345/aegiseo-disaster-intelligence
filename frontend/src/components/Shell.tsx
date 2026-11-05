import { BookOpen, ClipboardCheck, House, LayoutGrid, LogIn, ScanSearch, UserCircle2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { setToken } from "@/api/client";
import { useDashboard, useHealth, useMe } from "@/api/hooks";
import { useScrolled } from "@/lib/hooks";
import { BrandMark } from "./illustrations";
import { Modal } from "./ui";

/** Five destinations, named after what people want to do - not after the software's internals. */
const NAV = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/check", label: "Check a place", short: "Check", icon: ScanSearch },
  { to: "/results", label: "Results", icon: LayoutGrid },
  { to: "/review", label: "To review", short: "Review", icon: ClipboardCheck, badge: true },
  { to: "/about", label: "About", icon: BookOpen },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const loc = useLocation();
  const dash = useDashboard();
  const health = useHealth();
  const me = useMe();
  const scrolled = useScrolled();
  const mainRef = useRef<HTMLElement>(null);
  const [signIn, setSignIn] = useState(false);
  const [token, setTok] = useState("");
  const waiting = (dash.data?.review.open_tasks ?? 0) + (dash.data?.review.alerts_pending ?? 0);
  const first = useRef(true);

  // New page: start at the top and move keyboard / screen-reader focus to the content.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    mainRef.current?.focus({ preventScroll: true });
  }, [loc.pathname]);

  const conn = health.isSuccess ? "ok" : health.isLoading ? "wait" : "bad";
  const connText = conn === "ok" ? "Connected" : conn === "wait" ? "Connecting" : "Can't reach the server";

  return (
    <div className="app">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className={`topbar ${scrolled ? "scrolled" : ""}`}>
        <div className="topbar-inner">
          <Link to="/" className="brand" aria-label="AegisEO home">
            <BrandMark />
            <span>
              <span className="brand-name">AegisEO</span>
              <span className="brand-sub">Disaster maps from space</span>
            </span>
          </Link>
          <nav className="mainnav" aria-label="Main">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={"end" in n} className={({ isActive }) => (isActive ? "active" : "")}>
                {n.label}
                {"badge" in n && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-actions">
            <span className="conn" title={health.data ? `Server version ${health.data.version}` : undefined} role="status">
              <span className={`conn-dot ${conn === "ok" ? "" : conn}`} aria-hidden />
              <span className="conn-label">{connText}</span>
            </span>
            {me.data?.auth_enabled && !me.isError && (
              <span className="chip outline" title={`Signed in as ${me.data.user} (${me.data.role})`}><UserCircle2 size={15} aria-hidden /> {me.data.user}</span>
            )}
            {me.isError && (
              <button className="btn btn-sm" onClick={() => setSignIn(true)}><LogIn size={15} aria-hidden /> Sign in</button>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="app-main" tabIndex={-1} ref={mainRef}>{children}</main>

      <footer className="footer">
        <div className="footer-inner">
          <div style={{ maxWidth: 640 }}>
            <strong style={{ color: "var(--ink)" }}>AegisEO</strong> helps people see where a flood, wildfire or landslide has hit, using free satellite photos.
            It is an advisory tool: a person approves every warning before anything is sent.
          </div>
          <div className="row-wrap" style={{ gap: "8px 18px" }}>
            <Link to="/about">About</Link>
            <Link to="/about/accuracy">How accurate is it?</Link>
            <Link to="/about/data">Where the data comes from</Link>
          </div>
          <div style={{ width: "100%" }}>
            Contains modified Copernicus Sentinel data (ESA) via Microsoft Planetary Computer · Map data © OpenStreetMap contributors · Basemaps by OpenFreeMap and EOX
          </div>
        </div>
      </footer>

      <div className="tabbar">
        <nav aria-label="Main (mobile)">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={"end" in n} className={({ isActive }) => (isActive ? "active" : "")}>
              <n.icon size={22} aria-hidden />
              {"short" in n ? n.short : n.label}
              {"badge" in n && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
            </NavLink>
          ))}
        </nav>
      </div>

      <Modal title="Sign in" open={signIn} onClose={() => setSignIn(false)}
        footer={<>
          <button className="btn" onClick={() => setSignIn(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={!token.trim()} onClick={() => { setToken(token.trim() || null); window.location.reload(); }}>Sign in</button>
        </>}>
        <div className="field">
          <label className="label" htmlFor="tok">Access code</label>
          <input id="tok" className="input" type="password" autoComplete="off" value={token} onChange={(e) => setTok(e.target.value)} />
          <span className="hint">Your administrator gives you this code. It is kept only until you close this browser tab.</span>
        </div>
      </Modal>
    </div>
  );
}
