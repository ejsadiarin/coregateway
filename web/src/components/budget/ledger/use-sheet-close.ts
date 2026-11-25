import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// The sheet's own breakpoint, Tailwind's sm: below it the sheet is a
// drawer across the bottom; from it up, a card in the middle.
const phoneQuery = typeof window === "undefined" ? null : window.matchMedia("(max-width: 639px)");
const subscribePhone = (onChange: () => void) => {
  phoneQuery?.addEventListener("change", onChange);
  return () => phoneQuery?.removeEventListener("change", onChange);
};
export const useSheetIsPhone = () =>
  useSyncExternalStore(
    subscribePhone,
    () => phoneQuery?.matches ?? false,
    () => false,
  );

// Past this share of its height, a released drag dismisses the sheet.
export const CLOSE_THRESHOLD = 0.25;

// How long the sheet takes to leave: vaul's slide on a phone, the card's
// fade (app.css, sheet-fade-out) from sm up.
const exitMs = (phone: boolean) =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : phone ? 500 : 170;

// useSheetClose gives a sheet's own buttons (Cancel, Done, a finished save)
// a close that plays the sheet's exit before onClose unmounts it. Callers
// mount a sheet only while it is open, so closing it at once would cut the
// animation off. Pass `open` to the BottomSheet and call `close`.
export function useSheetClose(onClose: () => void): { open: boolean; close: () => void } {
  const phone = useSheetIsPhone();
  const [closing, setClosing] = useState(false);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => latest.current(), exitMs(phone));
    return () => window.clearTimeout(t);
  }, [closing, phone]);
  return { open: !closing, close: useCallback(() => setClosing(true), []) };
}
