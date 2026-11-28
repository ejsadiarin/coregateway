import { animate, motion, useMotionValue, useMotionValueEvent, type AnimationPlaybackControls } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// HoldToConfirm is a destructive action that runs only once it has been
// held down. A fill sweeps across while it is held, the label trembles just
// before it completes, and a check draws in when it does. Letting go early
// drains the fill; a quick tap shakes the label and says to hold. (After
// ui-moments' Hold to Confirm.)
//
// It holds with a mouse, a finger, or Space or Enter from the keyboard. A
// screen reader's activation (a click no pointer or key started) confirms
// at once: that is already a deliberate act, and it can't be held.
//
// Once confirmed it stays done while `pending`, then resets, so an action
// that fails can be tried again.
export function HoldToConfirm({
  onConfirm,
  children,
  disabled,
  pending = false,
  duration = 1000,
  className
}: {
  onConfirm: () => void;
  children: ReactNode;
  disabled?: boolean;
  pending?: boolean;
  // How long, in ms, it has to be held.
  duration?: number;
  className?: string;
}) {
  const progress = useMotionValue(0);
  const run = useRef<AnimationPlaybackControls | null>(null);
  const held = useRef(false);
  const [holding, setHolding] = useState(false);
  const [near, setNear] = useState(false);
  const [done, setDone] = useState(false);
  const [nudge, setNudge] = useState(0);
  const [said, setSaid] = useState('');

  useMotionValueEvent(progress, 'change', (v) => setNear(v > 0.8 && v < 1));

  const confirm = () => {
    held.current = false;
    setHolding(false);
    setDone(true);
    setSaid('Confirmed');
    onConfirm();
  };

  const start = () => {
    if (disabled || pending || done || held.current) return;
    held.current = true;
    setHolding(true);
    run.current?.stop();
    run.current = animate(progress, 1, {
      duration: (duration / 1000) * (1 - progress.get()),
      ease: 'linear',
      onComplete: confirm
    });
  };

  const release = () => {
    if (!held.current) return;
    held.current = false;
    setHolding(false);
    run.current?.stop();
    if (progress.get() < 0.2) {
      setNudge((n) => n + 1);
      setSaid('Keep holding to confirm');
    }
    run.current = animate(progress, 0, { duration: 0.25, ease: 'easeOut' });
  };

  // Back to ready once the action has settled, in case it failed and the
  // button is still on screen.
  useEffect(() => {
    if (!done || pending) return;
    const t = setTimeout(() => {
      setDone(false);
      setSaid('');
      progress.set(0);
    }, 1200);
    return () => clearTimeout(t);
  }, [done, pending, progress]);

  useEffect(() => () => run.current?.stop(), []);

  const isKey = (key: string) => key === ' ' || key === 'Enter';

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        data-holding={holding || undefined}
        data-done={done || undefined}
        className={cn(
          'relative isolate inline-flex min-h-11 touch-none select-none items-center justify-center overflow-hidden rounded-lg border border-destructive/40 bg-destructive/10 px-4 text-sm font-medium text-destructive transition-[transform,background-color,color] duration-200 [-webkit-touch-callout:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
          holding && 'scale-[0.97]',
          done && 'bg-destructive text-destructive-foreground',
          className
        )}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={(e) => {
          if (!isKey(e.key)) return;
          e.preventDefault();
          if (!e.repeat) start();
        }}
        onKeyUp={(e) => {
          if (!isKey(e.key)) return;
          e.preventDefault();
          release();
        }}
        onBlur={release}
        onClick={(e) => {
          if (e.detail === 0 && !held.current && !done && !pending) confirm();
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <motion.span
          aria-hidden
          className="absolute inset-0 -z-10 origin-left bg-destructive/25"
          style={{ scaleX: progress, opacity: done ? 0 : 1 }}
        />
        <motion.span
          key={nudge}
          className={cn(
            'inline-flex items-center gap-2 whitespace-nowrap transition-opacity duration-200',
            done && 'opacity-0',
            near && 'animate-[hold-tremble_90ms_linear_infinite]'
          )}
          initial={nudge ? { x: 0 } : false}
          animate={nudge ? { x: [0, -4, 4, -2, 2, 0] } : undefined}
          transition={{ duration: 0.35 }}
        >
          {children}
        </motion.span>
        <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute h-5 w-5" fill="none">
          <motion.path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={false}
            animate={{ pathLength: done ? 1 : 0, opacity: done ? 1 : 0 }}
            transition={{ duration: 0.35, delay: done ? 0.1 : 0 }}
          />
        </svg>
      </button>
      <span className="sr-only" role="status">
        {said}
      </span>
    </>
  );
}
