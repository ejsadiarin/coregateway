// PROTOTYPE (throwaway) — Variant A "Orbit": the sketch, literally. Tap the
// orb and pages swing out on threads along an arc beside it; drag up/down
// anywhere to roll the arc like a wheel. The one straight out from the orb
// is focused (bigger, labelled). Tap any page to go.
import { useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { X } from "lucide-react";
import type { NavItem } from "../sidebar-nav-items";
import { Orb, clamp, sectionColor, useDetent, useEscape, useLinearWheel, useOrbDock, useOrbItems, useOrbNav } from "./shared";

const R = 138;
const STEP = 24; // degrees between pages on the arc
const SPAN = 100; // degrees either side of straight-out before a page fades away
const ITEM = 46;
const rad = (d: number) => (d * Math.PI) / 180;

type Anchor = { cx: number; cy: number; side: "left" | "right" };

function angleOf(rel: number, a: Anchor) {
  // pages further down the list sit lower on the arc
  return a.side === "right" ? 180 - rel * STEP : rel * STEP;
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
  const rel = useTransform(offset, (o) => i - o);
  const ang = useTransform(rel, (r) => rad(angleOf(r, anchor)));
  const x = useTransform(ang, (a) => anchor.cx + Math.cos(a) * R);
  const y = useTransform(ang, (a) => anchor.cy + Math.sin(a) * R);
  const opacity = useTransform(rel, (r) => {
    const d = Math.abs(r * STEP);
    return d > SPAN ? 0 : 1 - Math.pow(d / SPAN, 3);
  });
  const scale = useTransform(rel, (r) => 1.22 - Math.min(Math.abs(r), 3) * 0.13);

  // the thread: an S-curl from the orb's rim out to the page
  const d = useTransform(ang, (a) => {
    const ux = Math.cos(a), uy = Math.sin(a);
    const sx = anchor.cx + ux * 32, sy = anchor.cy + uy * 32;
    const ex = anchor.cx + ux * (R - 26), ey = anchor.cy + uy * (R - 26);
    const c1a = a + 0.55, c2a = a - 0.4;
    const c1x = anchor.cx + Math.cos(c1a) * R * 0.5, c1y = anchor.cy + Math.sin(c1a) * R * 0.5;
    const c2x = anchor.cx + Math.cos(c2a) * R * 0.72, c2y = anchor.cy + Math.sin(c2a) * R * 0.72;
    return `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`;
  });

  // where this page bursts out from: the orb itself
  const a0 = rad(angleOf(i - offset.get(), anchor));
  const from = { x: -Math.cos(a0) * R, y: -Math.sin(a0) * R };
  const delay = 0.05 + order * 0.035;
  const isLaunching = launching === i;
  const dimmed = launching !== null && !isLaunching;
  const labelLeft = anchor.side === "right";

  return (
    <>
      <svg className="pointer-events-none fixed inset-0 h-full w-full overflow-visible">
        <motion.path
          d={d}
          fill="none"
          strokeLinecap="round"
          strokeWidth={focused ? 2 : 1.25}
          style={{ opacity, stroke: focused ? "var(--primary)" : "color-mix(in srgb, var(--foreground) 28%, transparent)" }}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: dimmed ? 0 : 1 }}
          exit={{ pathLength: 0, transition: { duration: 0.18 } }}
          transition={{ duration: 0.45, delay: dimmed ? 0 : delay, ease: [0.2, 0.8, 0.2, 1] }}
        />
      </svg>
      <motion.div className="fixed left-0 top-0" style={{ x, y, opacity }}>
        <motion.button
          type="button"
          onClick={onPress}
          className="absolute grid place-items-center rounded-2xl border bg-popover text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
          style={{
            width: ITEM,
            height: ITEM,
            left: -ITEM / 2,
            top: -ITEM / 2,
            scale,
            borderColor: focused ? "var(--primary)" : "var(--border)",
            color: focused ? "var(--primary)" : undefined,
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
              style={{ [labelLeft ? "right" : "left"]: ITEM / 2 + 14, translateY: "-50%" }}
              initial={{ opacity: 0, x: labelLeft ? 12 : -12, filter: "blur(4px)" }}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, x: labelLeft ? 6 : -6, transition: { duration: 0.12 } }}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.22em]" style={{ color: sectionColor[item.section], textAlign: labelLeft ? "right" : "left" }}>
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
  const arc = `M${x0},${y0} A${r},${r} 0 0 ${anchor.side === "right" ? 0 : 1} ${x1},${y1}`;
  const bead = useTransform(offset, (o) => {
    const t = clamp(o / Math.max(1, n - 1), 0, 1);
    return p(sweep - t * sweep * 2);
  });
  const bx = useTransform(bead, (b) => b[0]);
  const by = useTransform(bead, (b) => b[1]);
  return (
    <motion.svg
      className="pointer-events-none fixed inset-0 h-full w-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <path d={arc} fill="none" stroke="color-mix(in srgb, var(--foreground) 14%, transparent)" strokeWidth={1} strokeDasharray="2 5" />
      <motion.circle cx={bx} cy={by} r={3.5} fill="var(--primary)" />
    </motion.svg>
  );
}

export function VariantOrbit() {
  const items = useOrbItems();
  const { pathname, activeIndex, go } = useOrbNav(items);
  const dock = useOrbDock();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [launching, setLaunching] = useState<number | null>(null);
  const offset = useMotionValue(activeIndex);
  const focused = useDetent(offset, items.length);
  const wheel = useLinearWheel(offset, { min: 0, max: items.length - 1, pxPerUnit: R * rad(STEP) });
  const open = anchor !== null;

  const close = () => {
    setAnchor(null);
    dock.returnHome();
  };
  useEscape(open, close);

  const toggle = () => {
    if (open) return close();
    const { cx, cy } = dock.center();
    // glide the orb clear of the screen edges so the whole arc fits
    const ccy = clamp(cy, R + 90, window.innerHeight - R - 80);
    dock.moveTo(cx, ccy);
    offset.set(activeIndex);
    setAnchor({ cx, cy: ccy, side: dock.side });
    navigator.vibrate?.(8);
  };

  const launch = (i: number) => {
    // an off-focus page rolls into focus first, then launches
    const wait = i === focused ? 0 : 260;
    if (wait) wheel.spinTo(i);
    window.setTimeout(() => {
      setLaunching(i);
      navigator.vibrate?.([6, 30, 12]);
    }, wait);
    window.setTimeout(() => {
      go(items[i].path);
      setLaunching(null);
      close();
    }, wait + 300);
  };

  const ActiveIcon = items[activeIndex]?.icon;

  return (
    <>
      <AnimatePresence>
        {anchor && (
          <motion.div
            key="orbit"
            className="fixed inset-0 z-[55] touch-none select-none"
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
              onClick={close}
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
        )}
      </AnimatePresence>
      <Orb
        dock={dock}
        open={open}
        onTap={toggle}
        faceKey={open ? "x" : pathname}
        pulseKey={pathname}
        face={open ? <X className="h-5 w-5" /> : ActiveIcon ? <ActiveIcon className="h-5 w-5" /> : null}
      />
    </>
  );
}
