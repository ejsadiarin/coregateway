import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { useAuth } from "@/contexts/auth-context";
import { navItems, sectionLabels, matchNavPath, type NavItem, type NavSection } from "./sidebar-nav-items";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function NavItemButton({
  item,
  isActive,
  isCollapsed,
  onNavigate,
}: {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  onNavigate: (path: string) => void;
}) {
  const button = (
    <motion.button
      onClick={() => !item.disabled && onNavigate(item.path)}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200",
        isCollapsed && "justify-center px-2",
        isActive && !item.disabled &&
          "bg-primary/10 text-primary shadow-[inset_0_0_12px_rgba(0,229,204,0.06)]",
        !isActive && !item.disabled &&
          "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent",
        item.disabled &&
          "cursor-not-allowed text-muted-foreground/40"
      )}
      whileHover={!item.disabled ? { x: isCollapsed ? 0 : 2 } : undefined}
      whileTap={!item.disabled ? { scale: 0.98 } : undefined}
    >
      {/* active indicator line */}
      {isActive && !item.disabled && (
        <motion.div
          className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[2px] rounded-full bg-primary"
          layoutId="sidebar-active-indicator"
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
        />
      )}

      <item.icon className={cn(
        "h-[18px] w-[18px] shrink-0 transition-colors duration-200",
        isActive && !item.disabled && "text-primary drop-shadow-[0_0_6px_rgba(0,229,204,0.4)]",
      )} />

      {!isCollapsed && (
        <span className="truncate text-[13px] tracking-wide">
          {item.label}
        </span>
      )}

      {!isCollapsed && item.disabled && (
        <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground/30 border border-muted-foreground/15 rounded px-1.5 py-0.5">
          soon
        </span>
      )}
    </motion.button>
  );

  // wrap in tooltip when collapsed or disabled
  if (isCollapsed || item.disabled) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" className="font-mono text-xs">
          {item.disabled ? `${item.label} — Coming Soon` : item.label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return button;
}

export function SidebarNav() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isCollapsed } = useSidebar();
  const { isAdmin } = useAuth();

  const filteredItems = navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  const activePath = matchNavPath(pathname, filteredItems.map((item) => item.path));

  // group items by section preserving order
  const sections: { key: NavSection; items: NavItem[] }[] = [];
  let currentSection: NavSection | null = null;

  for (const item of filteredItems) {
    if (item.section !== currentSection) {
      currentSection = item.section;
      sections.push({ key: item.section, items: [] });
    }
    sections[sections.length - 1].items.push(item);
  }

  const handleNavigate = (path: string) => {
    navigate(path);
  };

  return (
    <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 space-y-4">
      {sections.map((section, sectionIdx) => (
        <div key={section.key}>
          {/* section label */}
          {!isCollapsed && (
            <motion.div
              className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: sectionIdx * 0.05 }}
            >
              {sectionLabels[section.key]}
            </motion.div>
          )}
          {isCollapsed && sectionIdx > 0 && (
            <div className="mx-2 mb-2 h-px bg-sidebar-border" />
          )}

          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavItemButton
                key={item.path}
                item={item}
                isActive={item.path === activePath}
                isCollapsed={isCollapsed}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
