import { useSyncExternalStore } from "react";

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function snapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * Reactive "is dark mode active" — the <html> class is the single source of
 * truth (set by the pre-paint script, applyMode, and the system-preference
 * watcher), so this hook stays correct no matter which of them flipped it.
 * Use it where a concrete color string must be recomputed (charts, canvases).
 */
export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, snapshot);
}
