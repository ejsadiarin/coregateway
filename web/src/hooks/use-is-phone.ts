import { useSyncExternalStore } from "react";

// The editor's phone breakpoint, matching Tailwind's md (768px). Phones get
// the full-screen shell; tablets and desktops keep the side rail.
const query = "(max-width: 767px)";
const media = typeof window === "undefined" ? null : window.matchMedia(query);

const subscribe = (onChange: () => void) => {
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
};

export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
}
