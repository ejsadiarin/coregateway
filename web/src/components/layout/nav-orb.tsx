import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  useVelocity,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import type { NavItem } from "./sidebar-nav-items";
import {
  ORBIT_RADIUS as R,
  ORBIT_SPAN,
  ORBIT_STEP,
  ORB_SIZE,
  clampOrbTop,
  orbLeft,
  orbitAngle,
  restSpot,
  type Side,
} from "@/lib/nav-orb";

const sectionColor: Record<NavItem["section"], string> = {
  overview: "var(--chart-1)",
  finance: "var(--chart-3)",
  system: "var(--chart-2)",
  admin: "var(--chart-5)",
};
const rad = (d: number) => (d * Math.PI) / 180;
const spring = { type: "spring", stiffness: 420, damping: 32 } as const;

// Where the orb rests between uses, kept on the device: the edge it hugs
// and its height as a share of the screen, so a rotation keeps it sensible.
const REST_KEY = "core.mobileNav.orb";
function readRest(): { side: Side; at: number } {
  try {
    const v = JSON.parse(localStorage.getItem(REST_KEY) ?? "");
    if ((v.side === "left" || v.side === "right") && typeof v.at === "number") return v;
  } catch {
    /* nothing kept yet */
  }
  return { side: "right", at: -1 };
}
const rest = readRest();

function restXY() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const y = rest.at < 0 ? h - ORB_SIZE - 96 : clampOrbTop(rest.at * h, h);
  return { x: orbLeft(rest.side, w), y };
}

export type OrbDock = ReturnType<typeof useOrbDock>;

// useOrbDock is the orb's position: motion values the orb is drawn at, so
// dragging it never re-renders React.
export function useOrbDock() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [side, setSide] = useState<Side>(rest.side);

  useEffect(() => {
    const home = () => {
      const p = restXY();
      x.set(p.x);
      y.set(p.y);
    };
    home();
    window.addEventListener("resize", home);
    return () => window.removeEventListener("resize", home);
  }, [x, y]);

  const center = () => ({ cx: x.get() + ORB_SIZE / 2, cy: y.get() + ORB_SIZE / 2 });

  // settle sends a released orb to rest against the nearer edge, carrying
  // its throw into the spring.
  const settle = (vx: number, vy: number) => {
    const { cx, cy } = center();
    const spot = restSpot(cx, cy, vx, vy, window.innerWidth, window.innerHeight);
    rest.side = spot.side;
    rest.at = spot.y / window.innerHeight;
    try {
      localStorage.setItem(REST_KEY, JSON.stringify(rest));
    } catch {
      /* private mode: kept for the session */
    }
    setSide(spot.side);
    animate(x, orbLeft(spot.side, window.innerWidth), { ...spring, velocity: vx });
    animate(y, spot.y, { ...spring, velocity: vy });
  };

  const moveTo = (cx: number, cy: number) => {
    animate(x, cx - ORB_SIZE / 2, spring);
    animate(y, cy - ORB_SIZE / 2, spring);
  };

  const returnHome = () => {
    const p = restXY();
    animate(x, p.x, spring);
    animate(y, p.y, spring);
  };

  return { x, y, side, center, settle, moveTo, returnHome };
}

// Orb draws the orb at the dock's position. It stretches along the way it
// moves, flattens while it is over the strip where it would dock, and
// ripples after each move to a new page. Dragging is the owner's job: it
// hands the press to onPointerDown.
export function Orb({
  dock,
  face,
  faceKey,
  pulseKey,
  open,
  lifted,
  docking,
  onPointerDown,
}: {
  dock: OrbDock;
  face: ReactNode;
  faceKey: string;
  pulseKey: string;
  open: boolean;
  lifted: boolean;
  docking: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const vx = useVelocity(dock.x);
  const vy = useVelocity(dock.y);
  const angle = useTransform(() => (Math.atan2(vy.get(), vx.get()) * 180) / Math.PI);
  const counter = useTransform(angle, (a) => -a);
  const stretch = useTransform(() => Math.min(Math.hypot(vx.get(), vy.get()) / 4500, 0.32));
  const sx = useTransform(stretch, (s) => 1 + s);
  const sy = useTransform(stretch, (s) => 1 - s * 0.55);

  return (
    <motion.div
      role="button"
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
      onPointerDown={onPointerDown}
      style={{ x: dock.x, y: dock.y }}
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
      className="fixed left-0 top-0 z-[60] touch-none select-none md:hidden"
    >
      <motion.div style={{ rotate: angle }}>
        <motion.div style={{ scaleX: sx, scaleY: sy }}>
          <motion.div style={{ rotate: counter }}>
            <motion.div
              className="relative rounded-full"
              style={{ width: ORB_SIZE, height: ORB_SIZE }}
              animate={docking ? { scaleX: 1.35, scaleY: 0.72 } : { scaleX: lifted ? 1.12 : 1, scaleY: lifted ? 1.12 : 1 }}
              transition={{ type: "spring", stiffness: 500, damping: 24 }}
            >
              <div
                className="absolute inset-0 rounded-full"
                style={{
                  boxShadow:
                    "0 12px 28px -10px color-mix(in srgb, var(--primary) 70%, transparent), 0 4px 10px -4px rgba(0,0,0,0.6)",
                }}
              />
              <div
                className="absolute inset-0 rounded-full animate-[spin_5s_linear_infinite] motion-reduce:animate-none"
                style={{
                  background:
                    "conic-gradient(from 0deg, var(--primary), transparent 30%, transparent 62%, color-mix(in srgb, var(--primary) 60%, transparent), var(--primary))",
                  animationDuration: open ? "1.4s" : "5s",
                }}
              />
              <div className="absolute inset-[2px] grid place-items-center rounded-full bg-popover text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                <motion.div
                  key={faceKey}
                  initial={{ scale: 0, rotate: -120, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                >
                  {face}
                </motion.div>
              </div>
              <motion.span
                key={pulseKey}
                className="pointer-events-none absolute inset-0 rounded-full border-2 border-primary"
                initial={{ scale: 1, opacity: 0.9 }}
                animate={{ scale: 2.4, opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

// ---- the arc the orb opens into ----

export type Anchor = { cx: number; cy: number; side: Side };

const ITEM = 46;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const rubber = (v: number, lo: number, hi: number) =>
  v < lo ? lo - (lo - v) * 0.3 : v > hi ? hi + (v - hi) * 0.3 : v;

// The wheel: a list position (fractional while it turns) dragged up and
// down, thrown, and clicked into whole pages.
function useWheel(value: MotionValue<number>, max: number) {
  const pxPerPage = R * rad(ORBIT_STEP);
  const dragged = useRef(false);
  const anim = useRef<AnimationPlaybackControls | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    anim.current?.stop();
    dragged.current = false;
    const startY = e.clientY;
    const base = value.get();
    let samples = [{ t: performance.now(), y: e.clientY }];
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (Math.abs(dy) > 6) dragged.current = true;
      if (!dragged.current) return;
      value.set(rubber(base - dy / pxPerPage, 0, max));
      const now = performance.now();
      samples.push({ t: now, y: ev.clientY });
      samples = samples.filter((s) => now - s.t < 100);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragged.current) return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      const v = -((b.y - a.y) / ((b.t - a.t) / 1000 || 1)) / pxPerPage;
      anim.current = animate(value, value.get(), {
        type: "inertia",
        velocity: v,
        power: 0.3,
        timeConstant: 240,
        modifyTarget: Math.round,
        min: 0,
        max,
        bounceStiffness: 420,
        bounceDamping: 32,
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onWheel = (e: React.WheelEvent) => {
    anim.current?.stop();
    value.set(clamp(value.get() + e.deltaY / pxPerPage / 2, 0, max));
    anim.current = animate(value, Math.round(value.get()), { type: "spring", stiffness: 300, damping: 30, delay: 0.12 });
  };

  // A drag that ends over a page must not also open it.
  const onClickCapture = (e: React.MouseEvent) => {
    if (!dragged.current) return;
    e.stopPropagation();
    dragged.current = false;
  };

  const spinTo = (i: number) => {
    anim.current?.stop();
    anim.current = animate(value, i, { type: "spring", stiffness: 260, damping: 28 });
  };

  return { onPointerDown, onWheel, onClickCapture, spinTo };
}

// useFocused is the page the wheel rests on, buzzing the phone on each
// click past one.
function useFocused(value: MotionValue<number>, n: number) {
  const [i, setI] = useState(() => clamp(Math.round(value.get()), 0, n - 1));
  useMotionValueEvent(value, "change", (v) => {
    const r = clamp(Math.round(v), 0, n - 1);
    if (r === i) return;
    setI(r);
    navigator.vibrate?.(4);
  });
  return i;
}

function ArcPage({
  item,
  i,
  offset,
  anchor,
  focused,
  launching,
  order,
  onPress,
}: {
  item: NavItem;
  i: number;
  offset: MotionValue<number>;
  anchor: Anchor;
  focused: boolean;
  launching: number | null;
  order: number;
  onPress: () => void;
}) {
  const ang = useTransform(offset, (o) => rad(orbitAngle(i - o, anchor.side)));
  const x = useTransform(ang, (a) => anchor.cx + Math.cos(a) * R);
  const y = useTransform(ang, (a) => anchor.cy + Math.sin(a) * R);
  const opacity = useTransform(offset, (o) => {
    const d = Math.abs((i - o) * ORBIT_STEP);
    return d > ORBIT_SPAN ? 0 : 1 - (d / ORBIT_SPAN) ** 3;
  });
  const scale = useTransform(offset, (o) => 1.22 - Math.min(Math.abs(i - o), 3) * 0.13);
  // a page faded off the ends of the arc must not catch a tap
  const pointerEvents = useTransform(opacity, (v) => (v < 0.1 ? "none" : "auto"));

  // the thread: an S-curl from the orb's rim out to the page
  const d = useTransform(ang, (a) => {
    const at = (t: number, r: number) => [anchor.cx + Math.cos(t) * r, anchor.cy + Math.sin(t) * r].join(",");
    return `M${at(a, 32)} C${at(a + 0.55, R * 0.5)} ${at(a - 0.4, R * 0.72)} ${at(a, R - 26)}`;
  });

  // each page bursts out of, and is pulled back into, the orb
  const a0 = rad(orbitAngle(i - offset.get(), anchor.side));
  const from = { x: -Math.cos(a0) * R, y: -Math.sin(a0) * R };
  const delay = 0.05 + order * 0.035;
  const isLaunching = launching === i;
  const dimmed = launching !== null && !isLaunching;
  const labelLeft = anchor.side === "right";

  return (
    <>
      <svg className="pointer-events-none fixed inset-0 h-full w-full overflow-visible" aria-hidden>
        <motion.path
          d={d}
          fill="none"
          strokeLinecap="round"
          strokeWidth={focused ? 2 : 1.25}
          style={{
            opacity,
            stroke: focused ? "var(--primary)" : "color-mix(in srgb, var(--foreground) 28%, transparent)",
          }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: dimmed ? 0 : 1 }}
          exit={{ pathLength: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.45, delay: dimmed ? 0 : delay, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <motion.div className="fixed left-0 top-0" style={{ x, y, opacity, pointerEvents }}>
        <motion.button
          type="button"
          aria-label={item.label}
          onClick={onPress}
          className="absolute grid place-items-center rounded-2xl border bg-popover shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
          style={{
            width: ITEM,
            height: ITEM,
            left: -ITEM / 2,
            top: -ITEM / 2,
            scale,
            borderColor: focused ? "var(--primary)" : "var(--border)",
            color: focused ? "var(--primary)" : "var(--foreground)",
          }}
          initial={{ x: from.x, y: from.y, opacity: 0, rotate: -90 }}
          animate={
            isLaunching
              ? { x: from.x, y: from.y, opacity: 0, rotate: 0, transition: { duration: 0.32, ease: [0.6, 0, 0.8, 0.4] } }
              : { x: 0, y: 0, opacity: dimmed ? 0 : 1, rotate: 0 }
          }
          exit={{ x: from.x, y: from.y, opacity: 0, rotate: 90, transition: { duration: 0.22, delay: order * 0.015 } }}
          transition={{ type: "spring", stiffness: 380, damping: 22, delay }}
          whileTap={{ scale: 0.9 }}
        >
          <item.icon className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full" style={{ background: sectionColor[item.section] }} />
        </motion.button>
        <AnimatePresence>
          {focused && launching === null && (
            <motion.div
              className="pointer-events-none absolute top-0 whitespace-nowrap"
              style={{ [labelLeft ? "right" : "left"]: ITEM / 2 + 14, translateY: "-50%", textAlign: labelLeft ? "right" : "left" }}
              initial={{ opacity: 0, x: labelLeft ? 12 : -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.12 } }}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: sectionColor[item.section] }}>
                {item.section}
              </div>
              <div className="text-lg font-semibold leading-none tracking-tight text-foreground">{item.label}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </>
  );
}

// A faint inner track with a bead showing how far through the list you are.
function Track({ offset, anchor, n }: { offset: MotionValue<number>; anchor: Anchor; n: number }) {
  const r = R - 62;
  const sweep = 70;
  const p = (deg: number) => {
    const a = rad(anchor.side === "right" ? 180 + deg : -deg);
    return [anchor.cx + Math.cos(a) * r, anchor.cy + Math.sin(a) * r];
  };
  const [x0, y0] = p(sweep);
  const [x1, y1] = p(-sweep);
  const bead = useTransform(offset, (o) => p(sweep - clamp(o / Math.max(1, n - 1), 0, 1) * sweep * 2));
  const bx = useTransform(bead, (b) => b[0]);
  const by = useTransform(bead, (b) => b[1]);
  return (
    <motion.svg className="pointer-events-none fixed inset-0 h-full w-full" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <path
        d={`M${x0},${y0} A${r},${r} 0 0 ${anchor.side === "right" ? 0 : 1} ${x1},${y1}`}
        fill="none"
        stroke="color-mix(in srgb, var(--foreground) 14%, transparent)"
        strokeWidth={1}
        strokeDasharray="2 5"
      />
      <motion.circle cx={bx} cy={by} r={3.5} fill="var(--primary)" />
    </motion.svg>
  );
}

// OrbitMenu is the opened orb: every page on an arc beside it, rolled by
// dragging up and down. Tapping the focused page goes there; tapping
// another rolls it into focus first.
export function OrbitMenu({
  anchor,
  items,
  activeIndex,
  onGo,
  onClose,
}: {
  anchor: Anchor;
  items: NavItem[];
  activeIndex: number;
  onGo: (path: string) => void;
  onClose: () => void;
}) {
  const offset = useMotionValue(activeIndex);
  const focused = useFocused(offset, items.length);
  const wheel = useWheel(offset, items.length - 1);
  const [launching, setLaunching] = useState<number | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const launch = (i: number) => {
    if (launching !== null) return;
    const wait = i === focused ? 0 : 260;
    if (wait) wheel.spinTo(i);
    timers.current.push(
      window.setTimeout(() => {
        setLaunching(i);
        navigator.vibrate?.([6, 30, 12]);
      }, wait),
      window.setTimeout(() => onGo(items[i].path), wait + 300),
    );
  };

  return (
    <motion.div
      className="fixed inset-0 z-[55] touch-none select-none md:hidden"
      onPointerDown={wheel.onPointerDown}
      onWheel={wheel.onWheel}
      onClickCapture={wheel.onClickCapture}
    >
      <motion.div
        className="absolute inset-0 backdrop-blur-[3px]"
        style={{
          background: `radial-gradient(circle at ${anchor.cx}px ${anchor.cy}px, color-mix(in srgb, var(--primary) 16%, transparent), color-mix(in srgb, var(--background) 82%, transparent) 260px)`,
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.25, delay: 0.1 } }}
        onClick={onClose}
      />
      <Track offset={offset} anchor={anchor} n={items.length} />
      {items.map((item, i) => (
        <ArcPage
          key={item.path}
          item={item}
          i={i}
          offset={offset}
          anchor={anchor}
          focused={i === focused}
          launching={launching}
          order={Math.abs(i - activeIndex)}
          onPress={() => launch(i)}
        />
      ))}
      <motion.div
        className="pointer-events-none absolute inset-x-0 top-20 text-center font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground"
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.35 } }}
        exit={{ opacity: 0 }}
      >
        drag ↕ to roll · tap to go
      </motion.div>
    </motion.div>
  );
}
