import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronUp } from "lucide-react";
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
  nested = false,
  holdsActive = false,
}: {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  onNavigate: (path: string) => void;
  // nested is a child row: shorter, under its parent.
  nested?: boolean;
  // holdsActive is a parent whose child is the current page.
  holdsActive?: boolean;
}) {
  const button = (
    <motion.button
      onClick={() => !item.disabled && onNavigate(item.path)}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-all duration-200",
        nested && !isCollapsed && "py-1.5 pl-2.5",
        isCollapsed && "justify-center px-2",
        isActive && !item.disabled &&
          "bg-primary/10 text-primary shadow-[inset_0_0_12px_rgba(0,229,204,0.06)]",
        !isActive && !item.disabled && holdsActive && "text-primary/80 hover:bg-sidebar-accent",
        !isActive && !item.disabled && !holdsActive &&
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
        nested && !isCollapsed && "h-4 w-4",
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

// NavGroup is a top-level item with its children nested under it, joined by
// a tree line. The arrow folds the children away; they stay open while one
// of them is the current page.
function NavGroup({
  item,
  childItems,
  activePath,
  isCollapsed,
  onNavigate,
}: {
  item: NavItem;
  childItems: NavItem[];
  activePath: string | null;
  isCollapsed: boolean;
  onNavigate: (path: string) => void;
}) {
  const [folded, setFolded] = useState(false);
  const childActive = childItems.some((c) => c.path === activePath);
  const open = !folded || childActive;

  const parent = (
    <NavItemButton
      item={item}
      isActive={item.path === activePath}
      isCollapsed={isCollapsed}
      onNavigate={onNavigate}
      holdsActive={childActive}
    />
  );

  if (childItems.length === 0) return parent;

  // Collapsed, the rail has no room for a tree: children follow as icons.
  if (isCollapsed) {
    return (
      <>
        {parent}
        {childItems.map((child) => (
          <NavItemButton
            key={child.path}
            item={child}
            isActive={child.path === activePath}
            isCollapsed
            onNavigate={onNavigate}
            nested
          />
        ))}
      </>
    );
  }

  return (
    <div>
      <div className="relative">
        {parent}
        <button
          type="button"
          onClick={() => setFolded((f) => !f)}
          disabled={childActive}
          aria-expanded={open}
          aria-label={open ? `Hide ${item.label} pages` : `Show ${item.label} pages`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronUp className={cn("h-3.5 w-3.5 transition-transform duration-200", !open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div className="ml-[21px] space-y-0.5 pt-0.5">
          {childItems.map((child) => (
            <div key={child.path} className="relative pl-3.5">
              {/* the tree line: down from the parent, then across to the child */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 h-1/2 w-2.5 rounded-bl-md border-b border-l border-sidebar-border"
              />
              <NavItemButton
                item={child}
                isActive={child.path === activePath}
                isCollapsed={false}
                onNavigate={onNavigate}
                nested
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
            {section.items
              .filter((item) => !item.parent)
              .map((item) => (
                <NavGroup
                  key={item.path}
                  item={item}
                  childItems={section.items.filter((c) => c.parent === item.path)}
                  activePath={activePath}
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
