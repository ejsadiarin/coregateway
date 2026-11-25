import { Outlet, useLocation } from "react-router-dom";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { useAuth } from "@/contexts/auth-context";
import { Navigate } from "react-router-dom";
import { useExchangeRates } from "@/hooks/use-exchange-rates";
import { useUserTimezone } from "@/hooks/use-user-timezone";

// DashboardSkeleton paints the shell's content area while the session check
// runs, so a hard reload never flashes a full-screen spinner.
function DashboardSkeleton() {
  return (
    <div className="px-4 md:px-6 py-6" data-testid="dashboard-skeleton">
      <div className="animate-pulse space-y-6">
        <div className="h-20 rounded-xl border border-border bg-card/50" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-28 rounded-xl border border-border bg-card/50" />
          ))}
        </div>
        <div className="h-48 rounded-xl border border-border bg-card/40" />
      </div>
    </div>
  );
}

function ProtectedLayout() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();
  // Once per session: a user who never saved a timezone starts on this
  // device's, saved at the gateway, so every service dates their "today"
  // and reads their schedules there rather than in UTC (ADR-0005).
  useUserTimezone();
  // Read on every page, so any visit keeps the offline rates current.
  useExchangeRates();

  if (isLoading) {
    // Exchange shows public rates and reads nothing protected, so it opens
    // without waiting for the gateway: offline, the check never finishes.
    if (location.pathname === "/dashboard/exchange") {
      return (
        <DashboardShell>
          <Outlet />
        </DashboardShell>
      );
    }
    // The shell paints immediately; the page inside it only mounts once the
    // session is confirmed, so no protected read fires first.
    return (
      <DashboardShell>
        <DashboardSkeleton />
      </DashboardShell>
    );
  }

  if (!isAuthenticated) {
    // Login brings the reader back to this page.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}

export function DashboardLayout() {
  return <ProtectedLayout />;
}
