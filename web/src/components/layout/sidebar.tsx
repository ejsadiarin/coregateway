
import { motion } from "motion/react";
import { Terminal, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebar } from "./sidebar-context";
import { SidebarNav } from "./sidebar-nav";
import { SidebarFooter } from "./sidebar-footer";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const SIDEBAR_WIDTH_EXPANDED = 240;
const SIDEBAR_WIDTH_COLLAPSED = 64;

export function Sidebar() {
  const { isCollapsed, toggle } = useSidebar();

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "hidden md:flex flex-col h-dvh sticky top-0 z-40",
          "bg-sidebar border-r border-sidebar-border",
          "transition-[width] duration-200 ease-out",
        )}
        style={{ width: isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED }}
      >
        {/* header: logo + collapse toggle */}
        <div className={cn(
          "flex items-center border-b border-sidebar-border",
          isCollapsed ? "justify-center px-2 py-4" : "justify-between px-4 py-4"
        )}>
          <div className={cn("flex items-center gap-3", isCollapsed && "gap-0")}>
            <div className="relative shrink-0">
              <Terminal className="h-5 w-5 text-primary" />
              <motion.div
                className="absolute inset-0 border border-primary/50 rounded"
                animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0, 0.4] }}
                transition={{ duration: 3, repeat: Infinity }}
              />
            </div>
            {!isCollapsed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.15, delay: 0.05 }}
                className="min-w-0"
              >
                <h1 className="text-xs font-semibold tracking-[0.15em] text-primary truncate">
                  CORE SYSTEM
                </h1>
                <p className="text-[10px] text-muted-foreground/60 truncate">
                  Command Center
                </p>
              </motion.div>
            )}
          </div>

          {/* collapse/expand toggle */}
          {!isCollapsed && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggle}
                  className={cn(
                    "flex items-center justify-center rounded-md p-1.5 text-muted-foreground/50",
                    "transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-mono text-xs">
                Collapse sidebar
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* expand button when collapsed — sits below header */}
        {isCollapsed && (
          <div className="flex justify-center py-2 border-b border-sidebar-border/50">
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  onClick={toggle}
                  className={cn(
                    "flex items-center justify-center rounded-md p-1.5 text-muted-foreground/50",
                    "transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-mono text-xs">
                Expand sidebar
              </TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* nav items */}
        <SidebarNav />

        {/* user footer */}
        <SidebarFooter />

        {/* animated bottom accent line */}
        <motion.div
          className="h-[1px] bg-gradient-to-r from-transparent via-primary/40 to-transparent"
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: 4, repeat: Infinity }}
        />
      </aside>
    </TooltipProvider>
  );
}
