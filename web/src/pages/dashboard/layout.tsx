import { Outlet, useLocation } from "react-router-dom";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { useAuth } from "@/contexts/auth-context";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchBudgetSettings } from "@/lib/budget-settings";

function ProtectedLayout() {
  const { isAuthenticated, isLoading, isGuest } = useAuth();
  const location = useLocation();
  // Once per session: a user who never saved a budget timezone starts on this
  // device's, so rule entries land on their date, not UTC's (corefinance #9).
  useQuery({
    queryKey: ["budget", "settings"],
    queryFn: fetchBudgetSettings,
    enabled: isAuthenticated && !isGuest,
    staleTime: Infinity,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Initializing...
          </span>
        </div>
      </div>
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
