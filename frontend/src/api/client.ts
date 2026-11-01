/** Minimal, typed fetch client with timeouts and the API's uniform error envelope. */

export class ApiError extends Error {
  status: number;
  details?: { field: string; message: string }[];
  requestId?: string;
  constructor(message: string, status: number, details?: { field: string; message: string }[], requestId?: string) {
    super(message);
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";
const TOKEN_KEY = "aegis.token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode): token lives only for this page */
  }
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers, signal: init.signal ?? ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") throw new ApiError("The server took too long to respond. Please try again.", 0);
    throw new ApiError("Cannot reach the AegisEO API. Check that the backend is running.", 0);
  }
  clearTimeout(timer);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: string; details?: { field: string; message: string }[]; request_id?: string } } | null)?.error;
    const msg = typeof err?.message === "string" ? err.message : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, err?.details, err?.request_id);
  }
  return body as T;
}

export const post = <T>(path: string, body?: unknown) => api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: "DELETE" });

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.details?.length) return `${e.message}: ${e.details.map((d) => `${d.field ? d.field + " - " : ""}${d.message}`).join("; ")}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}
