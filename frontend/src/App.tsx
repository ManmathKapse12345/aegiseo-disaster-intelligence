import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Compass } from "lucide-react";
import { Component, lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { ApiError } from "./api/client";
import { Shell } from "./components/Shell";
import { Empty, Loading, ToastProvider } from "./components/ui";
import { Home } from "./pages/Home";

// Pages other than Home load on demand, so the first visit doesn't download the map library.
const CheckWizard = lazy(() => import("./pages/check/CheckWizard").then((m) => ({ default: m.CheckWizard })));
const ResultsList = lazy(() => import("./pages/results/ResultsList").then((m) => ({ default: m.ResultsList })));
const ResultPage = lazy(() => import("./pages/results/ResultPage").then((m) => ({ default: m.ResultPage })));
const ReviewPage = lazy(() => import("./pages/review/ReviewPage").then((m) => ({ default: m.ReviewPage })));
const About = lazy(() => import("./pages/about/About").then((m) => ({ default: m.About })));
const Accuracy = lazy(() => import("./pages/about/Accuracy").then((m) => ({ default: m.Accuracy })));
const DataSources = lazy(() => import("./pages/about/DataSources").then((m) => ({ default: m.DataSources })));

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      retryDelay: (n) => Math.min(8000, 800 * 2 ** n),
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
});

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page page-narrow">
          <div className="card" role="alert">
            <Empty title="Something on this page broke" icon={<Compass size={40} aria-hidden />}
              action={<div className="row-wrap" style={{ justifyContent: "center" }}>
                <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload the page</button>
                <a className="btn" href="/">Go to the home page</a>
              </div>}>
              Your data is safe - this is a display problem. Reloading usually fixes it.
              <div className="caption muted" style={{ marginTop: 8 }}><code>{this.state.error.message}</code></div>
            </Empty>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFound() {
  return (
    <div className="page page-narrow">
      <Empty title="This page doesn't exist" icon={<Compass size={40} aria-hidden />}
        action={<div className="row-wrap" style={{ justifyContent: "center" }}><Link to="/" className="btn btn-primary">Go to the home page</Link><Link to="/check" className="btn">Check a place</Link></div>}>
        The link may be old or mistyped.
      </Empty>
    </div>
  );
}

/** Old addresses keep working: /analyze, /analyses/:id, /model, /sources, /methodology. */
function KeepQuery({ to }: { to: string }) {
  const loc = useLocation();
  return <Navigate to={`${to}${loc.search}`} replace />;
}
function OldResult() {
  const { id = "" } = useParams();
  return <Navigate to={`/results/${id}`} replace />;
}

export function AppRoutes() {
  const loc = useLocation();
  return (
    <Boundary key={loc.pathname}>
      <Suspense fallback={<div className="page"><Loading label="Loading the page" /></div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/check" element={<CheckWizard />} />
          <Route path="/results" element={<ResultsList />} />
          <Route path="/results/:id" element={<ResultPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/alerts" element={<ReviewPage />} />
          <Route path="/about" element={<About />} />
          <Route path="/about/accuracy" element={<Accuracy />} />
          <Route path="/about/data" element={<DataSources />} />
          <Route path="/analyze" element={<KeepQuery to="/check" />} />
          <Route path="/analyses" element={<Navigate to="/results" replace />} />
          <Route path="/analyses/:id" element={<OldResult />} />
          <Route path="/model" element={<Navigate to="/about/accuracy" replace />} />
          <Route path="/sources" element={<Navigate to="/about/data" replace />} />
          <Route path="/methodology" element={<Navigate to="/about" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </Boundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Shell>
            <AppRoutes />
          </Shell>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
