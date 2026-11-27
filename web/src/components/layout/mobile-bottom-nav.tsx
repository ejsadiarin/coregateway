import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, animate, useMotionValue, type Variants } from "motion/react";
import { LogOut, MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { matchNavPath } from "./sidebar-nav-items";
import { overflowItems, primaryItems, type BottomNavItem } from "./bottom-nav-items";
import { useQueryClient } from "@tanstack/react-query";

// The active tab's tick, which glides to the next tab (one bottom nav is
// ever mounted, so a fixed layoutId is enough).
function NavTick() {
  return (
    <div className="absolute inset-x-0 top-0 flex justify-center">
      <motion.div layoutId="bottom-nav-tick" className="h-[2px] w-6 rounded-full bg-primary" transition={{ type: "spring", bounce: 0.2, duration: 0.4 }} />
    </div>
  );
}

function NavButton({
  item,
  isActive,
  onPress,
}: {
  item: BottomNavItem;
  isActive: boolean;
  onPress: () => void;
}) {
  return (
    <button
      onClick={onPress}
      data-bar-item
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-w-0",
        "transition-colors duration-200",
        isActive
          ? "text-primary"
          : "text-muted-foreground/60 active:text-muted-foreground",
      )}
    >
      {isActive && <NavTick />}
      <item.icon className={cn(
        "h-5 w-5 shrink-0",
        isActive && "drop-shadow-[0_0_6px_rgba(0,229,204,0.4)]",
      )} />
      <span className="text-[10px] tracking-wide truncate max-w-full">
        {item.label}
      </span>
    </button>
  );
}

function OverflowMenu({
  isOpen,
  onClose,
  items,
  activePath,
  onNavigate,
  onLogout,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: BottomNavItem[];
  activePath: string | null;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* menu panel */}
          <motion.div
            className={cn(
              "fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] left-4 right-4 z-50",
              "rounded-xl border border-sidebar-border bg-sidebar",
              "shadow-2xl shadow-black/40",
              "p-2",
            )}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
          >
            {/* close button */}
            <div className="flex items-center justify-between px-3 pb-2 mb-1 border-b border-sidebar-border/50">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/50">
                More
              </span>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-muted-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* overflow nav items */}
            <div className="space-y-0.5">
              {items.map((item) => {
                const isActive = item.path === activePath;
                return (
                  <button
                    key={item.path}
                    onClick={() => {
                      if (!item.disabled) {
                        onNavigate(item.path);
                        onClose();
                      }
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                      isActive && !item.disabled &&
                        "bg-primary/10 text-primary",
                      !isActive && !item.disabled &&
                        "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent",
                      item.disabled &&
                        "cursor-not-allowed text-muted-foreground/30",
                    )}
                  >
                    <item.icon className={cn(
                      "h-[18px] w-[18px] shrink-0",
                      isActive && !item.disabled && "text-primary drop-shadow-[0_0_6px_rgba(0,229,204,0.4)]",
                    )} />
                    <span className="tracking-wide">{item.label}</span>
                    {item.disabled && (
                      <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground/30 border border-muted-foreground/15 rounded px-1.5 py-0.5">
                        soon
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* logout */}
            <div className="mt-1 pt-1 border-t border-sidebar-border/50">
              <button
                onClick={() => {
                  onLogout();
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                <span className="tracking-wide">Logout</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// How far a finger drags the bar up before it lifts off as the orb.
const LIFT_AT = 18;

// Lifting off, the bar shrinks into the finger's point. AnimatePresence
// hands that point in as `custom` (within the bar), with the radius that
// covers the whole bar from there.
const liftVariants: Variants = {
  lift: (at?: { x: number; y: number; full: number }) =>
    at
      ? {
          clipPath: [`circle(${at.full}px at ${at.x}px ${at.y}px)`, `circle(0px at ${at.x}px ${at.y}px)`],
          transition: { duration: 0.28, ease: [0.5, 0, 0.75, 0] as const },
        }
      : { y: 60, transition: { duration: 0.2 } },
};

// MobileBottomNav is the docked bar. Drag it up and it lifts off as the
// movable orb (onLift gets the finger's point, on screen and within the
// bar). Given morphFrom, the orb's centre as it docked, the bar opens out
// of that point and its tabs spill from it.
export function MobileBottomNav({
  morphFrom,
  onLift,
}: {
  morphFrom?: { x: number; y: number } | null;
  onLift?: (screen: { x: number; y: number }, inBar: { x: number; y: number; full: number }) => void;
} = {}) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, logout } = useAuth();
  const [isOverflowOpen, setOverflowOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const pull = useMotionValue(0);

  // Dock: the bar grows out of the orb's circle and the tabs spill out of
  // it, before the first paint so the orb never blinks.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav || !morphFrom) return;
    const r = nav.getBoundingClientRect();
    const cx = morphFrom.x - r.left;
    const cy = morphFrom.y - r.top;
    const full = Math.hypot(Math.max(cx, r.width - cx), Math.max(cy, r.height - cy));
    nav.style.clipPath = `circle(28px at ${cx}px ${cy}px)`;
    const grow = animate(nav, { clipPath: [`circle(28px at ${cx}px ${cy}px)`, `circle(${full}px at ${cx}px ${cy}px)`] }, { type: "spring", stiffness: 210, damping: 26 });
    grow.then(() => (nav.style.clipPath = ""));
    nav.querySelectorAll<HTMLElement>("[data-bar-item]").forEach((el, i) => {
      const b = el.getBoundingClientRect();
      const dx = morphFrom.x - (b.left + b.width / 2);
      const dy = morphFrom.y - (b.top + b.height / 2);
      animate(el, { x: [dx, 0], y: [dy, 0], scale: [0.3, 1], opacity: [0, 1] }, { type: "spring", stiffness: 340, damping: 24, delay: 0.04 + Math.abs(dx) / 2400 + i * 0.01 });
    });
    navigator.vibrate?.(10);
    return () => grow.stop();
    // only on the mount that docked
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lift: a drag up the bar stretches it a little, then hands the finger to
  // the orb. A tap, or a drag any other way, is left alone.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!onLift || isOverflowOpen) return;
    const sx = e.clientX;
    const sy = e.clientY;
    const move = (ev: PointerEvent) => {
      const up = sy - ev.clientY;
      const side = Math.abs(ev.clientX - sx);
      if (up < -8 || (side > 12 && side > up)) return done();
      pull.set(-Math.max(0, up) * 0.35);
      if (up > LIFT_AT && up > side) {
        done();
        const r = navRef.current!.getBoundingClientRect();
        const x = ev.clientX - r.left;
        const y = ev.clientY - r.top;
        onLift({ x: ev.clientX, y: ev.clientY }, { x, y, full: Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y)) });
      }
    };
    const done = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", done);
      window.removeEventListener("pointercancel", done);
      animate(pull, 0, { type: "spring", stiffness: 500, damping: 30 });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", done);
    window.addEventListener("pointercancel", done);
  };

  const filteredOverflow = overflowItems.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  const activePath = matchNavPath(
    pathname,
    [...primaryItems, ...filteredOverflow].map((item) => item.path),
  );

  const handleNavigate = (path: string) => {
    navigate(path);
    setOverflowOpen(false);
  };

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    navigate("/login");
  };

  // check if any overflow item is active (to highlight the "More" button)
  const isOverflowActive = filteredOverflow.some(
    (item) => item.path === activePath,
  );

  return (
    <>
      <OverflowMenu
        isOpen={isOverflowOpen}
        onClose={() => setOverflowOpen(false)}
        items={filteredOverflow}
        activePath={activePath}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      {/* floating bottom nav bar */}
      <motion.nav
        ref={navRef}
        onPointerDown={onPointerDown}
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 md:hidden touch-none",
          "border-t border-sidebar-border/80",
          "bg-sidebar",
        )}
        style={{ translateY: pull }}
        initial={morphFrom ? false : { y: 60 }}
        animate={{ y: 0 }}
        exit="lift"
        variants={liftVariants}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {/* grab handle: drag up to lift the bar off as the orb */}
        {onLift && <div className="absolute left-1/2 top-1 h-[3px] w-7 -translate-x-1/2 rounded-full bg-muted-foreground/25" />}
        {/* subtle top glow line */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-50" />

        <div className="flex items-stretch h-14 px-1">
          {primaryItems.map((item) => (
            <NavButton
              key={item.path}
              item={item}
              isActive={item.path === activePath}
              onPress={() => handleNavigate(item.path)}
            />
          ))}

          {/* more button */}
          <button
            data-bar-item
            onClick={() => setOverflowOpen((prev) => !prev)}
            className={cn(
              "relative flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-w-0",
              "transition-colors duration-200",
              isOverflowOpen || isOverflowActive
                ? "text-primary"
                : "text-muted-foreground/60 active:text-muted-foreground",
            )}
          >
            {isOverflowActive && !isOverflowOpen && <NavTick />}
            <MoreHorizontal className={cn(
              "h-5 w-5 shrink-0",
              (isOverflowOpen || isOverflowActive) && "drop-shadow-[0_0_6px_rgba(0,229,204,0.4)]",
            )} />
            <span className="text-[10px] tracking-wide">More</span>
          </button>
        </div>

        {/* safe area padding for devices with home indicator */}
        <div className="pb-[env(safe-area-inset-bottom)]" />
      </motion.nav>
    </>
  );
}
