import { useLocation, useMatch } from "react-router-dom";
import { SidebarProvider } from "./sidebar-context";
import { Sidebar } from "./sidebar";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { ContentHeader } from "./content-header";
import { PageTitleProvider } from "./page-title";
import { cn } from "@/lib/utils";

function ShellInner({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // The Draw editor gets the whole phone screen: its own compact top bar
  // replaces the dashboard header and bottom nav. Tablets and desktops keep
  // the normal shell.
  const isDrawEditor = useMatch("/dashboard/draw/:boardId") !== null;

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* desktop sidebar */}
      <Sidebar />

      {/* main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <div className={cn(isDrawEditor && "hidden md:block")}>
          <ContentHeader />
        </div>

        {/* Keyed so each route starts at the top. The fade is a CSS opacity
            animation the compositor runs on its own: the new page's mount
            blocks the main thread for a few frames, which a JS-driven
            slide stuttered through. */}
        <main
          key={pathname}
          className={cn(
            "route-enter flex-1 overflow-y-auto",
            isDrawEditor ? "min-h-0 max-md:overflow-hidden max-md:pb-0" : "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0",
          )}
        >
          {children}
        </main>

        {/* subtle footer — desktop only */}
        <div className="hidden md:flex border-t border-border/30 px-4 py-2 text-[10px] text-muted-foreground/40 items-center gap-2 shrink-0">
          <div className="h-1.5 w-1.5 rounded-full bg-accent/60 animate-pulse" />
          <span className="tracking-wider">CORE v1.0.0 // MATRIX ACTIVE</span>
        </div>
      </div>

      {/* mobile bottom nav — not under the full-screen editor */}
      {!isDrawEditor && <MobileBottomNav />}
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <PageTitleProvider>
        <ShellInner>{children}</ShellInner>
      </PageTitleProvider>
    </SidebarProvider>
  );
}
