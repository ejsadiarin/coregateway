// PROTOTYPE (throwaway) — Variant C "Dial": tap the orb and it flies to the
// middle of the screen and becomes the hub of a rotary dial ringed by every
// page. Spin the dial by dragging around it (a thumb sliding up/down along
// the side turns it too); it throws and clicks into place. Whatever sits
// under the notch at 12 o'clock is focused and shows in the hub. Tap the
// hub to go; tap a page to dial it round and go. The ring wraps forever.
import { useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import type { NavItem, NavSection } from "../sidebar-nav-items";
import { Orb, clamp, fling, sectionColor, useDetent, useEscape, useOrbDock, useOrbItems, useOrbNav } from "./shared";

const rad = (d: number) => (d * Math.PI) / 180;
const wrapRel = (r: number, n: number) => ((((r + n / 2) % n) + n) % n) - n / 2;

type Hub = { cx: number; cy: number; R: number };

function DialPage({
  item,
  i,
  n,
  pos,
  hub,
  focused,
  onPress,
}: {
  item: NavItem;
  i: number;
  n: number;
  pos: MotionValue<number>;
  hub: Hub;
  focused: boolean;
  onPress: () => void;
}) {
  const step = 360 / n;
  const rel = useTransform(pos, (p) => wrapRel(i - p, n));
  const ang = useTransform(rel, (r) => rad(-90 + r * step));
  const x = useTransform(ang, (a) => hub.cx + Math.cos(a) * hub.R);
  const y = useTransform(ang, (a) => hub.cy + Math.sin(a) * hub.R);
  const scale = useTransform(rel, (r) => 1.3 - Math.min(Math.abs(r), 2.5) * 0.14);
  const opacity = useTransform(rel, (r) => 1 - Math.min(Math.abs(r) / (n / 2), 1) * 0.55);
  const a0 = rad(-90 + wrapRel(i - pos.get(), n) * step);
  return (
    <motion.div className="fixed left-0 top-0" style={{ x, y, opacity }}>
      <motion.button
        type="button"
        onClick={onPress}
        className="absolute -left-[22px] -top-[22px] grid h-11 w-11 place-items-center rounded-full border bg-popover"
        style={{
          scale,
          borderColor: focused ? "var(--primary)" : "color-mix(in srgb, var(--foreground) 12%, transparent)",
          color: focused ? "var(--primary)" : "var(--muted-foreground)",
          boxShadow: `inset 0 -2px 0 ${sectionColor[item.section]}`,
        }}
        initial={{ x: -Math.cos(a0) * hub.R, y: -Math.sin(a0) * hub.R, opacity: 0, scale: 0.3 }}
        animate={{ x: 0, y: 0, opacity: 1, scale: 1 }}
        exit={{ x: -Math.cos(a0) * hub.R, y: -Math.sin(a0) * hub.R, opacity: 0, scale: 0.3, transition: { duration: 0.25 } }}
        transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.04 + i * 0.025 }}
        whileTap={{ scale: 0.85 }}
      >
        <item.icon className="h-[18px] w-[18px]" />
      </motion.button>
    </motion.div>
  );
}

// The bezel: ticks plus one coloured arc per section with its name running
// along it. It turns with the dial.
function Bezel({ items, pos, hub }: { items: NavItem[]; pos: MotionValue<number>; hub: Hub }) {
  const n = items.length;
  const step = 360 / n;
  const rotate = useTransform(pos, (p) => -p * step);
  const outer = hub.R + 38;
  const tickR = hub.R + 26;

  const runs: { section: NavSection; from: number; to: number }[] = [];
  items.forEach((it, i) => {
    const last = runs[runs.length - 1];
    if (last && last.section === it.section) last.to = i;
    else runs.push({ section: it.section, from: i, to: i });
  });
  const arcPath = (a0: number, a1: number, r: number) => {
    const p0 = [Math.cos(rad(a0)) * r, Math.sin(rad(a0)) * r];
    const p1 = [Math.cos(rad(a1)) * r, Math.sin(rad(a1)) * r];
    return `M${p0[0]},${p0[1]} A${r},${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${p1[0]},${p1[1]}`;
  };

  return (
    <motion.svg
      className="pointer-events-none fixed left-0 top-0 overflow-visible"
      width={1}
      height={1}
      style={{ x: hub.cx, y: hub.cy }}
      initial={{ opacity: 0, scale: 0.6, rotate: -60 }}
      animate={{ opacity: 1, scale: 1, rotate: 0 }}
      exit={{ opacity: 0, scale: 0.6, rotate: 60, transition: { duration: 0.25 } }}
      transition={{ type: "spring", stiffness: 140, damping: 18 }}
    >
      <motion.g style={{ rotate }}>
        {Array.from({ length: 72 }, (_, k) => {
          const a = rad(k * 5);
          const long = k % 6 === 0;
          const r0 = tickR - (long ? 7 : 3);
          return (
            <line
              key={k}
              x1={Math.cos(a) * r0}
              y1={Math.sin(a) * r0}
              x2={Math.cos(a) * tickR}
              y2={Math.sin(a) * tickR}
              stroke="color-mix(in srgb, var(--foreground) 22%, transparent)"
              strokeWidth={long ? 1.2 : 0.8}
            />
          );
        })}
        {runs.map((run) => {
          const a0 = -90 + (run.from - 0.42) * step;
          const a1 = -90 + (run.to + 0.42) * step;
          const id = `dial-arc-${run.section}`;
          return (
            <g key={run.section}>
              <path d={arcPath(a0, a1, outer)} fill="none" stroke={sectionColor[run.section]} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
              <path id={id} d={arcPath(a0, a1, outer + 8)} fill="none" />
              <text className="font-mono" fontSize={8.5} letterSpacing={2.5} fill={sectionColor[run.section]} opacity={0.9}>
                <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
                  {run.section.toUpperCase()}
                </textPath>
              </text>
            </g>
          );
        })}
      </motion.g>
      {/* the notch at 12 o'clock stays put */}
      <path d={`M-6,${-hub.R - 58} L6,${-hub.R - 58} L0,${-hub.R - 48} Z`} fill="var(--primary)" />
      <line x1={0} y1={-hub.R - 47} x2={0} y2={-hub.R - 30} stroke="var(--primary)" strokeWidth={1.5} strokeLinecap="round" />
    </motion.svg>
  );
}

export function VariantDial() {
  const items = useOrbItems();
  const n = items.length;
  const step = 360 / n;
  const { pathname, activeIndex, go } = useOrbNav(items);
  const dock = useOrbDock();
  const [hub, setHub] = useState<Hub | null>(null);
  const pos = useMotionValue(activeIndex);
  const focused = useDetent(pos, n, true);
  const anim = useRef<AnimationPlaybackControls | null>(null);
  const dragged = useRef(false);
  const dir = useRef(1);
  const prevFocused = useRef(focused);
  if (prevFocused.current !== focused) {
    dir.current = wrapRel(focused - prevFocused.current, n) > 0 ? 1 : -1;
    prevFocused.current = focused;
  }
  const open = hub !== null;

  const close = () => {
    setHub(null);
    dock.returnHome();
  };
  useEscape(open, close);

  const spinTo = (i: number) => {
    anim.current?.stop();
    const target = pos.get() + wrapRel(i - pos.get(), n);
    anim.current = animate(pos, target, { type: "spring", stiffness: 200, damping: 24 });
  };

  const openDial = () => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2 + 10;
    const R = clamp(Math.min(window.innerWidth, window.innerHeight) * 0.32, 108, 160);
    dock.moveTo(cx, cy);
    setHub({ cx, cy, R });
    // wind-up: the dial spins in and settles on the current page
    pos.set(activeIndex - 4);
    anim.current = animate(pos, activeIndex, { type: "spring", stiffness: 70, damping: 14 });
    navigator.vibrate?.(8);
  };

  const launch = (i: number) => {
    const wait = i === focused ? 0 : 320;
    if (wait) spinTo(i);
    window.setTimeout(() => {
      navigator.vibrate?.([6, 30, 12]);
      go(items[i].path);
      close();
    }, wait + 120);
  };

  // rotational drag: the angle the finger sweeps round the hub turns the dial
  const onPointerDown = (e: React.PointerEvent) => {
    if (!hub) return;
    anim.current?.stop();
    dragged.current = false;
    const angleAt = (x: number, y: number) => (Math.atan2(y - hub.cy, x - hub.cx) * 180) / Math.PI;
    let last = angleAt(e.clientX, e.clientY);
    const sx = e.clientX, sy = e.clientY;
    let samples = [{ t: performance.now(), p: pos.get() }];
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) dragged.current = true;
      if (!dragged.current) return;
      const a = angleAt(ev.clientX, ev.clientY);
      let d = a - last;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      last = a;
      pos.set(pos.get() - d / step);
      const now = performance.now();
      samples.push({ t: now, p: pos.get() });
      samples = samples.filter((s) => now - s.t < 100);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragged.current) return;
      const a = samples[0];
      const b = samples[samples.length - 1];
      anim.current = fling(pos, (b.p - a.p) / ((b.t - a.t) / 1000 || 1));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onWheel = (e: React.WheelEvent) => {
    anim.current?.stop();
    pos.set(pos.get() + e.deltaY / 120);
    window.clearTimeout((onWheel as unknown as { t?: number }).t);
    (onWheel as unknown as { t?: number }).t = window.setTimeout(() => spinTo(((Math.round(pos.get()) % n) + n) % n), 120);
  };

  const f = items[focused];
  const ActiveIcon = items[activeIndex]?.icon;
  const FocusIcon = f?.icon;

  return (
    <>
      <AnimatePresence>
        {hub && (
          <motion.div
            key="dial"
            className="fixed inset-0 z-[55] touch-none select-none"
            onPointerDown={onPointerDown}
            onWheel={onWheel}
            onClickCapture={(e) => {
              if (dragged.current) {
                e.stopPropagation();
                dragged.current = false;
              }
            }}
          >
            <motion.div
              className="absolute inset-0 backdrop-blur-[6px]"
              style={{
                background: `radial-gradient(circle at ${hub.cx}px ${hub.cy}px, color-mix(in srgb, var(--primary) 10%, var(--background)) 0, color-mix(in srgb, var(--background) 88%, transparent) ${hub.R + 80}px)`,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { delay: 0.1 } }}
              onClick={close}
            />
            {/* the groove the pages ride in */}
            <motion.div
              className="pointer-events-none absolute rounded-full border border-dashed"
              style={{
                left: hub.cx - hub.R,
                top: hub.cy - hub.R,
                width: hub.R * 2,
                height: hub.R * 2,
                borderColor: "color-mix(in srgb, var(--foreground) 10%, transparent)",
              }}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 22 }}
            />
            <Bezel items={items} pos={pos} hub={hub} />
            {items.map((item, i) => (
              <DialPage
                key={item.path}
                item={item}
                i={i}
                n={n}
                pos={pos}
                hub={hub}
                focused={i === focused}
                onPress={() => launch(i)}
              />
            ))}
            {/* focused page's name under the hub, sliding the way the dial turns */}
            <div className="pointer-events-none absolute left-0 right-0 text-center" style={{ top: hub.cy + 58 }}>
              <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
                <motion.div
                  key={f.path}
                  custom={dir.current}
                  variants={{
                    in: (d: number) => ({ x: d * 40, opacity: 0, filter: "blur(6px)" }),
                    on: { x: 0, opacity: 1, filter: "blur(0px)" },
                    out: (d: number) => ({ x: -d * 40, opacity: 0, filter: "blur(6px)" }),
                  }}
                  initial="in"
                  animate="on"
                  exit="out"
                  transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                >
                  <div className="text-2xl font-semibold leading-none tracking-tighter text-foreground">{f.label}</div>
                  <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.25em]" style={{ color: sectionColor[f.section] }}>
                    {f.path === items[activeIndex].path ? "you are here" : "tap hub to go"}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Orb
        dock={dock}
        open={open}
        scale={open ? 1.5 : 1}
        onTap={open ? () => launch(focused) : openDial}
        faceKey={open ? `f-${f?.path}` : pathname}
        pulseKey={pathname}
        face={
          open && FocusIcon ? <FocusIcon className="h-5 w-5" /> : ActiveIcon ? <ActiveIcon className="h-5 w-5" /> : null
        }
      />
    </>
  );
}
