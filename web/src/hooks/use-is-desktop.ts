import { useSyncExternalStore } from "react";

// The desktop breakpoint, matching Tailwind's lg (1024px): wide enough for
// two columns side by side, like the Reminders list beside its calendar.
const query = "(min-width: 1024px)";
const media = typeof window === "undefined" ? null : window.matchMedia(query);

const subscribe = (onChange: () => void) => {
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
};

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
}
