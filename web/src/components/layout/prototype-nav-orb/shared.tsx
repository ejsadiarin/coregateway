// PROTOTYPE (throwaway): shared bits for the movable nav-orb variants.
// The orb, where it docks, and the wheel physics every variant spins with.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  useVelocity,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import { useAuth } from "@/contexts/auth-context";
import { matchNavPath, navItems, type NavItem } from "../sidebar-nav-items";

export const ORB = 56;
const MARGIN = 14;
const TOP_GUARD = 72; // under the sticky header
const BOTTOM_GUARD = 24;

export const sectionColor: Record<NavItem["section"], string> = {
  overview: "var(--chart-1)",
  finance: "var(--chart-3)",
  system: "var(--chart-2)",
  admin: "var(--chart-5)",
};

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function useOrbItems(): NavItem[] {
  const { isAdmin } = useAuth();
  return navItems.filter((i) => !i.disabled && (!i.adminOnly || isAdmin));
}

// The variant sticks across navigation even when a page rewrites its own
// search params.
let lastVariant = "A";
export function useVariant(): string {
  const [sp] = useSearchParams();
  const v = sp.get("variant");
  if (v) lastVariant = v;
  return v ?? lastVariant;
}

export function useOrbNav(items: NavItem[]) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const variant = useVariant();
  const activePath = matchNavPath(pathname, items.map((i) => i.path));
  const activeIndex = Math.max(0, items.findIndex((i) => i.path === activePath));
  const go = (path: string) => navigate(`${path}?variant=${variant}`);
  return { pathname, activePath, activeIndex, go };
}

// Where the orb rests between opens. Module state (in memory only) so it
// survives a variant switch.
const home = { side: "right" as "left" | "right", y: -1 };

function homeXY(side: "left" | "right") {
  const x = side === "right" ? window.innerWidth - ORB - MARGIN : MARGIN;
  const y = home.y < 0 ? window.innerHeight - ORB - 96 : clamp(home.y, TOP_GUARD, window.innerHeight - ORB - BOTTOM_GUARD);
  return { x, y };
}

export type OrbDock = ReturnType<typeof useOrbDock>;

export function useOrbDock() {
  const start = homeXY(home.side);
  const x = useMotionValue(start.x);
  const y = useMotionValue(start.y);
  const [side, setSide] = useState(home.side);

  useEffect(() => {
    const onResize = () => {
      const h = homeXY(home.side);
      x.set(h.x);
      y.set(h.y);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [x, y]);

  const spring = { type: "spring", stiffness: 420, damping: 32 } as const;

  // settle flings the orb to the nearest edge, carrying its throw.
  const settle = (vx: number, vy: number) => {
    const px = x.get() + ORB / 2 + vx * 0.18;
    const s: "left" | "right" = px < window.innerWidth / 2 ? "left" : "right";
    home.side = s;
    home.y = clamp(y.get() + vy * 0.12, TOP_GUARD, window.innerHeight - ORB - BOTTOM_GUARD);
    setSide(s);
    const h = homeXY(s);
    animate(x, h.x, { ...spring, velocity: vx });
    animate(y, h.y, { ...spring, velocity: vy });
  };

  const moveTo = (cx: number, cy: number) => {
    animate(x, cx - ORB / 2, spring);
    animate(y, cy - ORB / 2, spring);
  };

  const returnHome = () => {
    const h = homeXY(home.side);
    animate(x, h.x, spring);
    animate(y, h.y, spring);
  };

  const center = () => ({ cx: x.get() + ORB / 2, cy: y.get() + ORB / 2 });

  return { x, y, side, settle, moveTo, returnHome, center };
}

// The orb: drag it anywhere, let go and it flies to the nearest edge,
// squashing along the direction it moves.
export function Orb({
  dock,
  open,
  onTap,
  face,
  faceKey,
  pulseKey,
  scale = 1,
  hidden = false,
}: {
  dock: OrbDock;
  open: boolean;
  onTap: () => void;
  face: ReactNode;
  faceKey: string;
  pulseKey: string;
  scale?: number;
  hidden?: boolean;
}) {
  const vx = useVelocity(dock.x);
  const vy = useVelocity(dock.y);
  const angle = useTransform(() => (Math.atan2(vy.get(), vx.get()) * 180) / Math.PI);
  const counter = useTransform(angle, (a) => -a);
  const stretch = useTransform(() => Math.min(Math.hypot(vx.get(), vy.get()) / 4500, 0.32));
  const sx = useTransform(stretch, (s) => 1 + s);
  const sy = useTransform(stretch, (s) => 1 - s * 0.55);
  const down = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <motion.div
      drag={!open}
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => setDragging(true)}
      onDragEnd={(_, info) => {
        setDragging(false);
        dock.settle(info.velocity.x, info.velocity.y);
      }}
      onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        const d = down.current;
        down.current = null;
        if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) onTap();
      }}
      style={{ x: dock.x, y: dock.y }}
      animate={{ scale: hidden ? 0 : scale, opacity: hidden ? 0 : 1 }}
      transition={{ type: "spring", stiffness: 380, damping: 26 }}
      className="fixed left-0 top-0 z-[60] touch-none select-none"
      aria-label="Navigate"
      role="button"
    >
      <motion.div style={{ rotate: angle }}>
        <motion.div style={{ scaleX: sx, scaleY: sy }}>
          <motion.div style={{ rotate: counter }} className="relative" >
            <motion.div
              className="relative rounded-full"
              style={{ width: ORB, height: ORB }}
              animate={{ scale: dragging ? 1.12 : 1 }}
              whileTap={{ scale: 0.92 }}
            >
              {/* soft lift shadow */}
              <div
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: "0 12px 28px -10px color-mix(in srgb, var(--primary) 70%, transparent), 0 4px 10px -4px rgba(0,0,0,0.6)" }}
              />
              {/* spinning signal ring */}
              <div
                className="absolute inset-0 rounded-full animate-[spin_5s_linear_infinite]"
                style={{
                  background: `conic-gradient(from 0deg, var(--primary), transparent 30%, transparent 62%, color-mix(in srgb, var(--primary) 60%, transparent), var(--primary))`,
                  animationDuration: open ? "1.4s" : "5s",
                }}
              />
              <div className="absolute inset-[2px] grid place-items-center rounded-full bg-popover shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] text-primary">
                <motion.div
                  key={faceKey}
                  initial={{ scale: 0, rotate: -120, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 22 }}
                >
                  {face}
                </motion.div>
              </div>
              {/* arrival ripple after each navigation */}
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

export const rubber = (v: number, lo: number, hi: number) =>
  v < lo ? lo - (lo - v) * 0.3 : v > hi ? hi + (v - hi) * 0.3 : v;

export function fling(mv: MotionValue<number>, velocity: number, min?: number, max?: number) {
  return animate(mv, mv.get(), {
    type: "inertia",
    velocity,
    power: 0.3,
    timeConstant: 240,
    modifyTarget: (t) => Math.round(t),
    min,
    max,
    bounceStiffness: 420,
    bounceDamping: 32,
  });
}

// useDetent is the item the wheel rests on, buzzing the phone on each click
// past one.
export function useDetent(mv: MotionValue<number>, n: number, wrap = false) {
  const norm = (v: number) => (wrap ? ((Math.round(v) % n) + n) % n : clamp(Math.round(v), 0, n - 1));
  const [i, setI] = useState(() => norm(mv.get()));
  useMotionValueEvent(mv, "change", (v) => {
    const r = norm(v);
    if (r !== i) {
      setI(r);
      navigator.vibrate?.(4);
    }
  });
  return i;
}

// A wheel you drag up and down (or scroll with a mouse wheel), with throw
// and snap. Clicks on children are swallowed after a drag.
export function useLinearWheel(value: MotionValue<number>, { min, max, pxPerUnit }: { min: number; max: number; pxPerUnit: number }) {
  const dragged = useRef(false);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const snapTimer = useRef<number | undefined>(undefined);

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
      value.set(rubber(base - dy / pxPerUnit, min, max));
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
      const dt = (b.t - a.t) / 1000 || 1;
      anim.current = fling(value, -((b.y - a.y) / dt) / pxPerUnit, min, max);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onWheel = (e: React.WheelEvent) => {
    anim.current?.stop();
    value.set(clamp(value.get() + e.deltaY / pxPerUnit / 2, min, max));
    window.clearTimeout(snapTimer.current);
    snapTimer.current = window.setTimeout(() => {
      anim.current = animate(value, Math.round(value.get()), { type: "spring", stiffness: 300, damping: 30 });
    }, 120);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (dragged.current) {
      e.stopPropagation();
      e.preventDefault();
      dragged.current = false;
    }
  };

  const spinTo = (i: number) => {
    anim.current?.stop();
    anim.current = animate(value, i, { type: "spring", stiffness: 260, damping: 28 });
  };

  return { onPointerDown, onWheel, onClickCapture, spinTo };
}

export function useEscape(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && fn();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
}
