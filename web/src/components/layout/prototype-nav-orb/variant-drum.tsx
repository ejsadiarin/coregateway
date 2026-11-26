// PROTOTYPE (throwaway) — Variant B "Drum": the orb melts open (a circular
// reveal from wherever it sits) into a 3D picker drum. Drag up/down to spin
// the drum with throw; the row in the lens is focused. Tap the lens to go,
// tap any other row to spin to it and go. The dotted rail on the edge
// scrubs straight to a page.
import { useState } from "react";
import { AnimatePresence, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { CornerDownLeft } from "lucide-react";
import type { NavItem } from "../sidebar-nav-items";
import { ORB, Orb, clamp, sectionColor, useDetent, useEscape, useLinearWheel, useOrbDock, useOrbItems, useOrbNav } from "./shared";

const ROW = 46;
const DEG = 21;
const RADIUS = ROW / (2 * Math.tan(((DEG / 2) * Math.PI) / 180));
const W = 252;
const H = 360;
const MARGIN = 14;

type Panel = { top: number; side: "left" | "right"; ox: number; oy: number };

function DrumRow({
  item,
  i,
  offset,
  focused,
  current,
  onPress,
}: {
  item: NavItem;
  i: number;
  offset: MotionValue<number>;
  focused: boolean;
  current: boolean;
  onPress: () => void;
}) {
  const rel = useTransform(offset, (o) => i - o);
  const transform = useTransform(rel, (r) => `rotateX(${-r * DEG}deg) translateZ(${RADIUS}px)`);
  const opacity = useTransform(rel, (r) => {
    const a = Math.abs(r * DEG);
    return a >= 88 ? 0 : 0.25 + 0.75 * Math.cos((a * Math.PI) / 180) ** 2;
  });
  return (
    <motion.button
      type="button"
      onClick={onPress}
      className="absolute inset-x-3 top-1/2 flex items-center gap-3 px-3 [backface-visibility:hidden]"
      style={{ height: ROW, marginTop: -ROW / 2, transform, opacity }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: sectionColor[item.section] }} />
      <item.icon className="h-[18px] w-[18px] shrink-0" style={{ color: focused ? "var(--primary)" : "var(--muted-foreground)" }} />
      <span
        className="truncate text-[15px] tracking-tight transition-[color,font-weight] duration-150"
        style={{ color: focused ? "var(--foreground)" : "var(--muted-foreground)", fontWeight: focused ? 600 : 400 }}
      >
        {item.label}
      </span>
      {current && <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/70">here</span>}
    </motion.button>
  );
}

function Rail({ items, focused, onScrub }: { items: NavItem[]; focused: number; onScrub: (i: number) => void }) {
  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onScrub(clamp(Math.round(((e.clientY - r.top) / r.height) * (items.length - 1)), 0, items.length - 1));
  };
  return (
    <div
      className="absolute right-1.5 top-1/2 flex -translate-y-1/2 flex-col items-center gap-[5px] px-1.5 py-2"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub(e);
      }}
      onPointerMove={(e) => e.buttons && scrub(e)}
    >
      {items.map((it, i) => (
        <motion.span
          key={it.path}
          className="w-[4px] rounded-full"
          animate={{ height: i === focused ? 16 : 4, opacity: i === focused ? 1 : 0.45 }}
          transition={{ type: "spring", stiffness: 600, damping: 30 }}
          style={{ background: i === focused ? "var(--primary)" : sectionColor[it.section] }}
        />
      ))}
    </div>
  );
}

export function VariantDrum() {
  const items = useOrbItems();
  const { pathname, activeIndex, activePath, go } = useOrbNav(items);
  const dock = useOrbDock();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [flash, setFlash] = useState(0);
  const offset = useMotionValue(activeIndex);
  const focused = useDetent(offset, items.length);
  const wheel = useLinearWheel(offset, { min: 0, max: items.length - 1, pxPerUnit: ROW });
  const open = panel !== null;

  const close = () => setPanel(null);
  useEscape(open, close);

  const toggle = () => {
    if (open) return close();
    const { cx, cy } = dock.center();
    const side = dock.side;
    const top = clamp(cy - H / 2, 72, window.innerHeight - H - 64);
    const left = side === "right" ? window.innerWidth - W - MARGIN : MARGIN;
    offset.set(activeIndex);
    setPanel({ top, side, ox: cx - left, oy: cy - top });
    navigator.vibrate?.(8);
  };

  const launch = (i: number) => {
    const wait = i === focused ? 0 : 280;
    if (wait) wheel.spinTo(i);
    window.setTimeout(() => {
      setFlash((f) => f + 1);
      navigator.vibrate?.([6, 30, 12]);
    }, wait);
    window.setTimeout(() => {
      go(items[i].path);
      close();
    }, wait + 260);
  };

  const f = items[focused];
  const ActiveIcon = items[activeIndex]?.icon;
  const big = Math.hypot(W, H) * 1.05;

  return (
    <>
      <AnimatePresence>
        {panel && (
          <motion.div key="drum" className="fixed inset-0 z-[55]">
            <motion.div
              className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
            />
            <motion.div
              className="absolute flex touch-none select-none flex-col overflow-hidden rounded-[28px] border border-border bg-popover shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_24px_60px_-20px_rgba(0,0,0,0.8)]"
              style={{ top: panel.top, width: W, height: H, [panel.side]: MARGIN }}
              initial={{ clipPath: `circle(${ORB / 2}px at ${panel.ox}px ${panel.oy}px)` }}
              animate={{ clipPath: `circle(${big}px at ${panel.ox}px ${panel.oy}px)` }}
              exit={{ clipPath: `circle(${ORB / 2}px at ${panel.ox}px ${panel.oy}px)` }}
              transition={{ type: "spring", stiffness: 170, damping: 24 }}
              onPointerDown={wheel.onPointerDown}
              onWheel={wheel.onWheel}
              onClickCapture={wheel.onClickCapture}
            >
              {/* header: section + position, each rolls like an odometer */}
              <div className="flex items-center justify-between px-5 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.22em]">
                <div className="relative h-4 w-28 overflow-hidden">
                  <AnimatePresence mode="popLayout" initial={false}>
                    <motion.span
                      key={f.section}
                      className="absolute left-0"
                      style={{ color: sectionColor[f.section] }}
                      initial={{ y: 14, opacity: 0 }}
                      animate={{ y: 0, opacity: 1 }}
                      exit={{ y: -14, opacity: 0 }}
                    >
                      {f.section}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <span className="tabular-nums text-muted-foreground">
                  {String(focused + 1).padStart(2, "0")} / {String(items.length).padStart(2, "0")}
                </span>
              </div>

              {/* the drum */}
              <div
                className="relative flex-1"
                style={{
                  perspective: 640,
                  maskImage: "linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)",
                  WebkitMaskImage: "linear-gradient(to bottom, transparent, black 22%, black 78%, transparent)",
                }}
              >
                {/* the lens */}
                <motion.div
                  key={flash}
                  className="pointer-events-none absolute inset-x-3 top-1/2 rounded-2xl border"
                  style={{
                    height: ROW + 4,
                    marginTop: -(ROW + 4) / 2,
                    borderColor: "color-mix(in srgb, var(--primary) 45%, transparent)",
                    background: "color-mix(in srgb, var(--primary) 11%, transparent)",
                  }}
                  initial={flash ? { scale: 1.08, background: "color-mix(in srgb, var(--primary) 40%, transparent)" } : false}
                  animate={{ scale: 1, background: "color-mix(in srgb, var(--primary) 11%, transparent)" }}
                  transition={{ duration: 0.35 }}
                />
                <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: `translateZ(${-RADIUS}px)` }}>
                  {items.map((item, i) => (
                    <DrumRow
                      key={item.path}
                      item={item}
                      i={i}
                      offset={offset}
                      focused={i === focused}
                      current={item.path === activePath}
                      onPress={() => launch(i)}
                    />
                  ))}
                </div>
                <Rail items={items} focused={focused} onScrub={(i) => wheel.spinTo(i)} />
              </div>

              <motion.button
                type="button"
                onClick={() => launch(focused)}
                className="m-3 mt-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground active:scale-[0.98]"
                initial={{ y: 30, opacity: 0 }}
                animate={{ y: 0, opacity: 1, transition: { delay: 0.15, type: "spring", stiffness: 400, damping: 28 } }}
                exit={{ y: 30, opacity: 0 }}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span key={f.path} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }}>
                    Open {f.label}
                  </motion.span>
                </AnimatePresence>
                <CornerDownLeft className="h-4 w-4" />
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Orb
        dock={dock}
        open={open}
        hidden={open}
        onTap={toggle}
        faceKey={pathname}
        pulseKey={pathname}
        face={ActiveIcon ? <ActiveIcon className="h-5 w-5" /> : null}
      />
    </>
  );
}
