import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ORB_SIZE, inDockZone, orbitCentreY } from "@/lib/nav-orb";
import { matchNavPath, navItems } from "./sidebar-nav-items";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { Orb, OrbitMenu, useOrbDock, type Anchor } from "./nav-orb";
import { setMobileNavMode, useMobileNavMode } from "./mobile-nav-mode";

// MobileNav is the phone's navigation: a movable orb that opens into an
// arc of every page, or the classic bottom bar. Drop the orb onto the
// bottom edge and it docks as the bar; drag the bar up and it lifts off as
// the orb, still under the same finger.
export function MobileNav() {
  const mode = useMobileNavMode();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const items = navItems.filter((i) => !i.disabled && (!i.adminOnly || isAdmin));
  const activePath = matchNavPath(pathname, items.map((i) => i.path));
  const activeIndex = Math.max(0, items.findIndex((i) => i.path === activePath));

  const dock = useOrbDock();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [carrying, setCarrying] = useState(false);
  const [docking, setDocking] = useState(false);
  const [morphFrom, setMorphFrom] = useState<{ x: number; y: number } | null>(null);
  const [liftAt, setLiftAt] = useState<{ x: number; y: number; full: number } | undefined>(undefined);
  const stopCarry = useRef<() => void>(() => {});
  useEffect(() => () => stopCarry.current(), []);

  const open = anchor !== null;

  const close = () => setAnchor(null);

  const openOrbit = () => {
    const { cx, cy } = dock.center();
    const oy = orbitCentreY(cy, window.innerHeight);
    dock.moveTo(cx, oy);
    setAnchor({ cx, cy: oy, side: dock.side });
    navigator.vibrate?.(8);
  };

  // A page change from anywhere (a link, back) folds the arc away.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (anchor) setAnchor(null);
  }
  // However the arc closes, the orb glides back to where it rests.
  useEffect(() => {
    if (!open) return dock.returnHome();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // re-run only when the arc opens or closes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // carry moves the orb with the finger until it lets go. `grab` is where
  // the finger holds the orb; `moved` is true when the drag is already
  // under way (a lift off the bar). A press that never moves is a tap.
  const carry = (from: { x: number; y: number }, grab: { x: number; y: number }, moved: boolean) => {
    let dragging = moved;
    let inZone = false;
    let samples = [{ t: performance.now(), ...from }];
    if (moved) setCarrying(true);

    const move = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
      if (!dragging) {
        dragging = true;
        setCarrying(true);
      }
      dock.x.set(ev.clientX - grab.x);
      dock.y.set(ev.clientY - grab.y);
      const zone = inDockZone(ev.clientY - grab.y + ORB_SIZE / 2, window.innerHeight);
      if (zone !== inZone) {
        inZone = zone;
        setDocking(zone);
        if (zone) navigator.vibrate?.(6);
      }
      const now = performance.now();
      samples.push({ t: now, x: ev.clientX, y: ev.clientY });
      samples = samples.filter((s) => now - s.t < 100);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      stopCarry.current = () => {};
    };
    const up = () => {
      end();
      setCarrying(false);
      setDocking(false);
      if (!dragging) {
        if (open) close();
        else openOrbit();
        return;
      }
      if (inZone) {
        const { cx, cy } = dock.center();
        setMorphFrom({ x: cx, y: cy });
        setMobileNavMode("bar");
        return;
      }
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = (b.t - a.t) / 1000 || 1;
      dock.settle((b.x - a.x) / dt, (b.y - a.y) / dt);
    };
    stopCarry.current = end;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onOrbDown = (e: React.PointerEvent) => {
    // an open arc is closed by a tap on the orb, never dragged
    if (open) return carry({ x: e.clientX, y: e.clientY }, { x: Infinity, y: Infinity }, false);
    carry({ x: e.clientX, y: e.clientY }, { x: e.clientX - dock.x.get(), y: e.clientY - dock.y.get() }, false);
  };

  const onLift = (screen: { x: number; y: number }, inBar: { x: number; y: number; full: number }) => {
    const grab = { x: ORB_SIZE / 2, y: ORB_SIZE / 2 };
    dock.x.set(screen.x - grab.x);
    dock.y.set(screen.y - grab.y);
    setLiftAt(inBar);
    setMorphFrom(null);
    setMobileNavMode("orb");
    navigator.vibrate?.(10);
    carry(screen, grab, true);
  };

  const ActiveIcon = items[activeIndex]?.icon;

  return (
    <>
      <AnimatePresence custom={liftAt}>
        {mode === "bar" && <MobileBottomNav key="bar" morphFrom={morphFrom} onLift={onLift} />}
      </AnimatePresence>

      {mode === "orb" && (
        <>
          <AnimatePresence>
            {anchor && (
              <OrbitMenu
                key="orbit"
                anchor={anchor}
                items={items}
                activeIndex={activeIndex}
                onClose={close}
                onGo={(path) => {
                  navigate(path);
                  close();
                }}
              />
            )}
          </AnimatePresence>

          {/* the strip the orb docks into, shown while it is carried */}
          <AnimatePresence>
            {carrying && (
              <motion.div
                className="pointer-events-none fixed inset-x-0 bottom-0 z-[58] flex h-[calc(3.5rem+env(safe-area-inset-bottom))] items-start justify-center border-t border-dashed pt-4 md:hidden"
                style={{
                  borderColor: docking ? "var(--primary)" : "var(--border)",
                  background: docking
                    ? "color-mix(in srgb, var(--primary) 14%, var(--sidebar))"
                    : "color-mix(in srgb, var(--sidebar) 70%, transparent)",
                }}
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%", transition: { duration: 0.18 } }}
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              >
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.25em] transition-colors"
                  style={{ color: docking ? "var(--primary)" : "var(--muted-foreground)" }}
                >
                  {docking ? "release to dock as bar" : "drop here for the bar"}
                </span>
              </motion.div>
            )}
          </AnimatePresence>

          <Orb
            dock={dock}
            open={open}
            lifted={carrying}
            docking={docking}
            onPointerDown={onOrbDown}
            faceKey={open ? "close" : pathname}
            pulseKey={pathname}
            face={open ? <X className="h-5 w-5" /> : ActiveIcon ? <ActiveIcon className="h-5 w-5" /> : null}
          />
        </>
      )}
    </>
  );
}
