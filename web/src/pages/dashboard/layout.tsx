import { Outlet } from "react-router-dom";
import { DashboardShell } from "@/components/layout/dashboard-shell";
import { useAuth } from "@/contexts/auth-context";
import { Navigate } from "react-router-dom";

function ProtectedLayout() {
  const { isAuthenticated, isLoading } = useAuth();

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
    return <Navigate to="/login" replace />;
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
