import { useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { SidebarProvider } from "./sidebar-context";
import { Sidebar } from "./sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { ContentHeader } from "./content-header";

function ShellInner({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* desktop sidebar */}
      <Sidebar />

      {/* main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <ContentHeader />

        <motion.main
          key={pathname}
          className="flex-1 overflow-y-auto pb-16 md:pb-0"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {children}
        </motion.main>

        {/* subtle footer — desktop only */}
        <div className="hidden md:flex border-t border-border/30 px-4 py-2 text-[10px] text-muted-foreground/40 items-center gap-2 shrink-0">
          <div className="h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse" />
          <span className="tracking-wider">CORE v1.0.0 // MATRIX ACTIVE</span>
        </div>
      </div>

      {/* mobile bottom nav */}
      <MobileBottomNav />
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <ShellInner>{children}</ShellInner>
    </SidebarProvider>
  );
}
