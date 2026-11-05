import { useEffect, useState } from "react";

/** Sets the browser tab title; "AegisEO" is appended so tabs stay recognisable. */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const prev = document.title;
    document.title = `${title} · AegisEO`;
    return () => {
      document.title = prev;
    };
  }, [title]);
}

export function useMediaQuery(query: string): boolean {
  const get = () => (typeof window !== "undefined" && "matchMedia" in window ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!("matchMedia" in window)) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

export function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

/** Small, safe wrappers: storage can be unavailable (private mode, blocked site data). */
export const store = {
  get<T>(key: string, kind: "local" | "session" = "local"): T | null {
    try {
      const raw = (kind === "local" ? localStorage : sessionStorage).getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown, kind: "local" | "session" = "local"): void {
    try {
      (kind === "local" ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: the app works without it */
    }
  },
  remove(key: string, kind: "local" | "session" = "local"): void {
    try {
      (kind === "local" ? localStorage : sessionStorage).removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
