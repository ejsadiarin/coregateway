import { useInView, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import { odometerSlots } from '@/lib/motion';

// Odometer shows a figure whose digits roll like a meter: up from zero the
// first time it comes into view, then each digit rolls to its new place
// when the data changes. A refetch that brings the same value leaves it
// still. (After ui-moments' Odometer Stepper.)
//
// Screen readers and text queries get the figure from a visually hidden
// copy; the rolling columns are aria-hidden, their digits drawn by CSS
// (app.css .odometer-digit) so they add no text of their own. Only
// transform moves (DESIGN §6), and reduced motion snaps it.
export function Odometer({
  value,
  format,
  className
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const text = format(value);
  const rolled = inView || reduce;

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden className="inline-flex tabular-nums">
        {odometerSlots(text).map((slot) =>
          slot.digit === null ? (
            <span key={slot.key}>{slot.char}</span>
          ) : (
            <span key={slot.key} className="odometer-digit relative inline-block overflow-hidden">
              <span
                className="absolute inset-x-0 top-0 text-center transition-transform duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
                style={{
                  transform: `translateY(-${(rolled ? slot.digit : 0) * 10}%)`,
                  // The ones settle first; higher places follow a beat behind.
                  transitionDelay: `${Math.min(Number(slot.key), 5) * 40}ms`
                }}
              />
            </span>
          )
        )}
      </span>
    </span>
  );
}
