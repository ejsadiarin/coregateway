import { useSyncExternalStore } from "react";

// A phone or tablet: no hover, a finger for a pointer. Its on-screen
// keyboard has no Shift+Enter.
const query = "(hover: none) and (pointer: coarse)";
const media = typeof window === "undefined" ? null : window.matchMedia(query);

const subscribe = (onChange: () => void) => {
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
};

// useTouchDevice says whether this is a touch device, and follows a change
// (a 2-in-1 folded into a tablet, a pointer attached).
export function useTouchDevice(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
}
