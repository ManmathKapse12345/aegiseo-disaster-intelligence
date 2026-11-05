import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, patch, post } from "./client";
import type {
  Alert, AnalysisBrief, AnalysisDetail, CellProps, CreateAnalysis, Dashboard, LayerInfo, LiveEvent, Me, Passage, Place, ReviewTask,
  Scenario, Source, Trace,
} from "./types";

const ACTIVE = new Set(["queued", "running"]);

export const useMe = () => useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/api/me"), staleTime: 60_000 });
export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => api<{ status: string; version: string }>("/api/health", { timeoutMs: 8000 }), refetchInterval: 30_000, retry: 0 });

export const useDashboard = () =>
  useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/api/dashboard"), refetchInterval: 15_000, placeholderData: keepPreviousData });

export const useAnalyses = (params: { status?: string; hazard?: string; mode?: string } = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({
    queryKey: ["analyses", params],
    queryFn: () => api<{ total: number; items: AnalysisBrief[] }>(`/api/analyses?limit=200${q ? "&" + q : ""}`),
    refetchInterval: (query) => (query.state.data?.items.some((a) => ACTIVE.has(a.status)) ? 3000 : 20_000),
    placeholderData: keepPreviousData,
  });
};

export const useAnalysis = (id: string) =>
  useQuery({
    queryKey: ["analysis", id],
    queryFn: () => api<AnalysisDetail>(`/api/analyses/${id}`),
    refetchInterval: (query) => (query.state.data && ACTIVE.has(query.state.data.status) ? 2000 : false),
    placeholderData: keepPreviousData,
  });

const doneKey = (s?: string) => (s && !ACTIVE.has(s) ? "done" : "active");

export const useDetections = (id: string, status?: string) =>
  useQuery({ queryKey: ["detections", id, doneKey(status)], queryFn: () => api<GeoJSON.FeatureCollection>(`/api/analyses/${id}/detections`), enabled: doneKey(status) === "done" });
export const usePriorities = (id: string, status?: string) =>
  useQuery({
    queryKey: ["priorities", id, doneKey(status)],
    queryFn: () => api<GeoJSON.FeatureCollection<GeoJSON.Polygon, CellProps>>(`/api/analyses/${id}/priorities`),
    enabled: doneKey(status) === "done",
  });
export const useFacilities = (id: string, status?: string) =>
  useQuery({ queryKey: ["facilities", id, doneKey(status)], queryFn: () => api<GeoJSON.FeatureCollection<GeoJSON.Point>>(`/api/analyses/${id}/facilities`), enabled: doneKey(status) === "done" });
export const useLayers = (id: string, status?: string) =>
  useQuery({ queryKey: ["layers", id, doneKey(status)], queryFn: () => api<LayerInfo[]>(`/api/analyses/${id}/layers`), enabled: doneKey(status) === "done" });
export const useTrace = (id: string, active: boolean) =>
  useQuery({ queryKey: ["trace", id], queryFn: () => api<Trace>(`/api/analyses/${id}/trace`), refetchInterval: active ? 2500 : false, placeholderData: keepPreviousData });

export const useScenarios = () => useQuery({ queryKey: ["scenarios"], queryFn: () => api<Scenario[]>("/api/scenarios"), staleTime: Infinity });
export const useSources = () => useQuery({ queryKey: ["sources"], queryFn: () => api<Source[]>("/api/sources", { timeoutMs: 60_000 }), staleTime: 120_000 });
export const useLiveEvents = () =>
  useQuery({ queryKey: ["events"], queryFn: () => api<{ events: LiveEvent[]; sources: Record<string, { status: string; error?: string }>; fetched_at: string }>("/api/events/live", { timeoutMs: 60_000 }), staleTime: 300_000 });
export const useAlerts = (status?: string, analysisId?: string) =>
  useQuery({
    queryKey: ["alerts", status ?? "", analysisId ?? ""],
    queryFn: () => api<{ items: Alert[]; counts: Record<string, number> }>(`/api/alerts?limit=300${status ? `&status=${status}` : ""}${analysisId ? `&analysis_id=${analysisId}` : ""}`),
    refetchInterval: 15_000, placeholderData: keepPreviousData,
  });
export const useReviews = (status = "open") =>
  useQuery({ queryKey: ["reviews", status], queryFn: () => api<{ items: ReviewTask[]; counts: Record<string, number> }>(`/api/reviews?status=${status}`), refetchInterval: 15_000, placeholderData: keepPreviousData });
export const useModel = () => useQuery({ queryKey: ["model"], queryFn: () => api<Record<string, any>>("/api/model"), staleTime: 300_000 });
export const useBenchmarks = () =>
  useQuery({ queryKey: ["benchmarks"], queryFn: () => api<{ running: boolean; last_error: string | null; items: { id: string; suite: string; summary: Record<string, number | null>; duration_s: number; created_at: string }[] }>("/api/benchmarks"),
    refetchInterval: (q) => (q.state.data?.running ? 3000 : 30_000) });
export const useBenchmark = (id?: string) =>
  useQuery({ queryKey: ["benchmark", id], queryFn: () => api<{ results: any[]; summary: Record<string, number | null> }>(`/api/benchmarks/${id}`), enabled: !!id });
export const useKnowledge = () => useQuery({ queryKey: ["knowledge"], queryFn: () => api<{ doc_id: string; title: string; tags: string[]; sections: { ref: string; section: string; text: string }[] }[]>("/api/knowledge"), staleTime: Infinity });
export const useKnowledgeSearch = (q: string) =>
  useQuery({ queryKey: ["kb", q], queryFn: () => api<Passage[]>(`/api/knowledge/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length >= 2 });

/** Place search runs only for a submitted term (Nominatim forbids type-ahead); results are cached per term. */
export const usePlaces = (term: string) =>
  useQuery({
    queryKey: ["places", term],
    queryFn: () => api<{ results: Place[]; attribution: string }>(`/api/places?q=${encodeURIComponent(term)}&limit=6`, { timeoutMs: 20_000 }),
    enabled: term.trim().length >= 2,
    staleTime: Infinity,
    retry: 0,
  });

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: string[]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}

export function useCreateAnalysis() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (body: CreateAnalysis) => post<AnalysisBrief>("/api/analyses", body), onSuccess: () => inv("analyses", "dashboard") });
}
export function useAnalysisAction() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "cancel" | "rerun" }) => post<AnalysisBrief>(`/api/analyses/${id}/${action}`),
    onSuccess: () => inv("analyses", "analysis", "dashboard"),
  });
}
export function useAlertDecision() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, decision, note }: { id: string; decision: "approve" | "reject"; note?: string }) => post<Alert>(`/api/alerts/${id}/decision`, { decision, note }),
    onSuccess: () => inv("alerts", "dashboard", "analysis"),
  });
}
export function useReviewDecision() {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: string; comment?: string }) =>
      post<{ rerun_analysis_id?: string; effect?: string }>(`/api/reviews/${id}/decision`, { decision, comment }),
    onSuccess: () => inv("reviews", "alerts", "dashboard", "analysis", "priorities", "analyses"),
  });
}
export function useOverride(analysisId: string) {
  const inv = useInvalidate();
  return useMutation({
    mutationFn: ({ cell, category, reason }: { cell: string; category: string | null; reason: string }) =>
      patch(`/api/analyses/${analysisId}/priorities/${cell}`, { category, reason }),
    onSuccess: () => inv("priorities", "dashboard"),
  });
}
export function useCatalogPreview() {
  return useMutation({
    mutationFn: (body: { bbox: number[]; event_date: string; pre_window?: string[]; post_window?: string[] }) =>
      post<{ pre_window: string[]; post_window: string[]; aoi_area_km2: number; sensors: Record<string, Record<string, any>> }>("/api/catalog/preview", body),
  });
}
export function useRunBenchmark() {
  const inv = useInvalidate();
  return useMutation({ mutationFn: (suite: string) => post("/api/benchmarks/run", { suite }), onSuccess: () => inv("benchmarks") });
}
export function useRecheckSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<Source[]>("/api/sources?refresh=true", { timeoutMs: 90_000 }),
    onSuccess: (data) => qc.setQueryData(["sources"], data),
  });
}
