import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import {
LayoutDashboard,
Wallet,
Receipt,
Server,
MoreHorizontal,
TrendingUp,
SlidersHorizontal,
Users,
BarChart3,
FileText,
LogOut,
X,
type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/auth-context";
import { useQueryClient } from "@tanstack/react-query";

interface BottomNavItem {
  label: string;
  icon: LucideIcon;
  path: string;
  disabled?: boolean;
  adminOnly?: boolean;
}

const primaryItems: BottomNavItem[] = [
  { label: "Home", icon: LayoutDashboard, path: "/dashboard" },
  { label: "Budget", icon: Wallet, path: "/dashboard/budget" },
  { label: "Expenses", icon: Receipt, path: "/dashboard/budget/expenses" },
  { label: "Services", icon: Server, path: "/dashboard/services" },
];

const overflowItems: BottomNavItem[] = [
{ label: "Incomes", icon: TrendingUp, path: "/dashboard/budget/incomes" },
{ label: "Settings", icon: SlidersHorizontal, path: "/dashboard/budget/settings" },
{ label: "Analytics", icon: BarChart3, path: "/analytics", disabled: true },
{ label: "Logs", icon: FileText, path: "/logs", disabled: true },
{ label: "Users", icon: Users, path: "/dashboard/admin/users", adminOnly: true },
];

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
      className={cn(
        "relative flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-w-0",
        "transition-colors duration-200",
        isActive
          ? "text-primary"
          : "text-muted-foreground/60 active:text-muted-foreground",
      )}
    >
      {isActive && (
        <motion.div
          className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-primary"
          layoutId="mobile-nav-indicator"
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
        />
      )}
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
  pathname,
  onNavigate,
  onLogout,
}: {
  isOpen: boolean;
  onClose: () => void;
  items: BottomNavItem[];
  pathname: string;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* menu panel */}
          <motion.div
            className={cn(
              "fixed bottom-20 left-4 right-4 z-50",
              "rounded-xl border border-sidebar-border bg-sidebar/95 backdrop-blur-xl",
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
                const isActive = pathname === item.path;
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

export function MobileBottomNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin, logout } = useAuth();
  const [isOverflowOpen, setOverflowOpen] = useState(false);

  const filteredOverflow = overflowItems.filter(
    (item) => !item.adminOnly || isAdmin,
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
    (item) => pathname === item.path,
  );

  return (
    <>
      <OverflowMenu
        isOpen={isOverflowOpen}
        onClose={() => setOverflowOpen(false)}
        items={filteredOverflow}
        pathname={pathname}
        onNavigate={handleNavigate}
        onLogout={handleLogout}
      />

      {/* floating bottom nav bar */}
      <motion.nav
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 md:hidden",
          "border-t border-sidebar-border/80",
          "bg-sidebar/90 backdrop-blur-xl",
          "safe-area-bottom",
        )}
        initial={{ y: 60 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {/* subtle top glow line */}
        <motion.div
          className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent"
          animate={{ opacity: [0.3, 0.6, 0.3] }}
          transition={{ duration: 4, repeat: Infinity }}
        />

        <div className="flex items-stretch h-14 px-1">
          {primaryItems.map((item) => (
            <NavButton
              key={item.path}
              item={item}
              isActive={pathname === item.path}
              onPress={() => handleNavigate(item.path)}
            />
          ))}

          {/* more button */}
          <button
            onClick={() => setOverflowOpen((prev) => !prev)}
            className={cn(
              "relative flex flex-col items-center justify-center gap-0.5 flex-1 py-2 min-w-0",
              "transition-colors duration-200",
              isOverflowOpen || isOverflowActive
                ? "text-primary"
                : "text-muted-foreground/60 active:text-muted-foreground",
            )}
          >
            {isOverflowActive && !isOverflowOpen && (
              <motion.div
                className="absolute top-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-primary"
                layoutId="mobile-nav-indicator"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
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
