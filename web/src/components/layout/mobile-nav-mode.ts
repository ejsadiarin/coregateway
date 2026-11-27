import { useSyncExternalStore } from "react";

// The phone nav is either the movable orb or the docked bottom bar; the
// owner switches by dragging one into the other. The choice is kept on the
// device and mirrored on <html data-mobile-nav> so CSS can make room for
// the bar only while it shows.
export type MobileNavMode = "orb" | "bar";

const KEY = "core.mobileNav";
const listeners = new Set<() => void>();

function read(): MobileNavMode {
  try {
    return localStorage.getItem(KEY) === "bar" ? "bar" : "orb";
  } catch {
    return "orb";
  }
}

let mode: MobileNavMode = typeof window === "undefined" ? "orb" : read();
if (typeof document !== "undefined") document.documentElement.dataset.mobileNav = mode;

export function setMobileNavMode(next: MobileNavMode) {
  if (next === mode) return;
  mode = next;
  document.documentElement.dataset.mobileNav = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: the choice lasts the session */
  }
  listeners.forEach((l) => l());
}

export function useMobileNavMode(): MobileNavMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => mode,
    () => "orb",
  );
}
