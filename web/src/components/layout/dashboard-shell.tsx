import { useState } from "react";
import { useLocation, useMatch } from "react-router-dom";
import { SidebarProvider } from "./sidebar-context";
import { Sidebar } from "./sidebar";
import { NavOrbPrototype, useNavOrbVariant } from "./prototype-nav-orb";
import { ContentHeader } from "./content-header";
import { PageTitleProvider } from "./page-title";
import { cn } from "@/lib/utils";
import { tabEnterFrom } from "@/lib/motion";
import { bottomTabOf, primaryItems } from "./bottom-nav-items";

const tabs = primaryItems.map((i) => i.path);

function ShellInner({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  // The Draw editor gets the whole phone screen: its own compact top bar
  // replaces the dashboard header and bottom nav. Tablets and desktops keep
  // the normal shell.
  const isDrawEditor = useMatch("/dashboard/draw/:boardId") !== null;
  // PROTOTYPE: the nav orb has no bar to pad for (variant Z is today's bar).
  const hasBottomBar = useNavOrbVariant() === "Z";

  // Which side the new page comes in from: a move between bottom-nav tabs
  // slides in from the side of the tab picked (phones only, in app.css);
  // anything else fades in with a slight rise.
  const [route, setRoute] = useState<{ path: string; from: "left" | "right" | null }>({ path: pathname, from: null });
  if (route.path !== pathname) {
    setRoute({ path: pathname, from: tabEnterFrom(tabs, bottomTabOf(route.path), bottomTabOf(pathname)) });
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* desktop sidebar */}
      <Sidebar />

      {/* main content area */}
      <div className="flex flex-1 flex-col min-w-0 overflow-hidden">
        <div className={cn(isDrawEditor && "hidden md:block")}>
          <ContentHeader />
        </div>

        {/* Keyed so each route starts at the top. The entrance is a CSS
            animation the compositor runs on its own: the new page's mount
            blocks the main thread for a few frames, which a JS-driven
            slide stuttered through. */}
        <main
          key={pathname}
          className={cn(
            "route-enter flex-1 overflow-y-auto",
            // The Draw editor reads its canvas's offset as it mounts, which
            // a moving page would skew: it only fades.
            isDrawEditor ? "route-fade" : route.from && `route-from-${route.from}`,
            isDrawEditor ? "min-h-0 max-md:overflow-hidden max-md:pb-0" : hasBottomBar ? "pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0" : "pb-24 md:pb-0",
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
      {!isDrawEditor && <NavOrbPrototype />}
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
