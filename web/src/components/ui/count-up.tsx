import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef } from "react";

// CountUp shows a figure that counts up from zero the first time it comes
// into view, then moves from its old value to a new one when the data
// changes. A refetch that brings the same value leaves it still.
//
// Screen readers and text queries get the final value from a visually
// hidden copy; the counting digits are aria-hidden and written straight to
// the DOM, so a frame of the count never re-renders React.
export function CountUp({ value, format, className }: { value: number; format: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const fmt = useRef(format);
  // The last figure painted, so an interrupted count carries on from it.
  const shown = useRef<number | null>(null);

  useLayoutEffect(() => {
    fmt.current = format;
  });

  // Before it is seen it waits at zero (or at its value, without motion).
  useLayoutEffect(() => {
    if (ref.current && shown.current === null) ref.current.textContent = fmt.current(reduce ? value : 0);
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    const paint = (n: number) => {
      el.textContent = fmt.current(n);
      shown.current = n;
    };
    const from = shown.current ?? 0;
    if (reduce || from === value) return paint(value);
    const controls = animate(from, value, {
      duration: shown.current === null ? 0.9 : 0.5,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: paint,
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  return (
    <span className={className}>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden />
    </span>
  );
}
