import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode } from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { ApiError } from "./api/client";
import { Shell } from "./components/Shell";
import { Empty, ToastProvider } from "./components/ui";
import { AnalysisDetail } from "./pages/AnalysisDetail";
import { Alerts, Analyses, ReviewQueue, Sources } from "./pages/Lists";
import { Methodology } from "./pages/Methodology";
import { ModelPage } from "./pages/ModelPage";
import { NewAnalysis } from "./pages/NewAnalysis";
import { Overview } from "./pages/Overview";

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
        <div className="card card-pad" role="alert">
          <h2>This view failed to render</h2>
          <p className="muted" style={{ marginTop: 6 }}>{this.state.error.message}</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/analyze" element={<NewAnalysis />} />
      <Route path="/analyses" element={<Analyses />} />
      <Route path="/analyses/:id" element={<AnalysisDetail />} />
      <Route path="/review" element={<ReviewQueue />} />
      <Route path="/alerts" element={<Alerts />} />
      <Route path="/sources" element={<Sources />} />
      <Route path="/model" element={<ModelPage />} />
      <Route path="/methodology" element={<Methodology />} />
      <Route path="*" element={<Empty title="Page not found"><Link to="/">Back to the overview</Link></Empty>} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <Shell>
            <Boundary>
              <AppRoutes />
            </Boundary>
          </Shell>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}
