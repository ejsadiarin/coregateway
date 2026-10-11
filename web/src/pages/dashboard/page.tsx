import { motion } from "motion/react";
import { SystemStatus } from "@/components/dashboard/system-status";
import { QuickActions } from "@/components/dashboard/quick-actions";
import { ServiceGrid } from "@/components/dashboard/service-grid";
import { useAllServicesStats } from "@/hooks/use-services";

export default function DashboardPage() {
  const { data: overallStats } = useAllServicesStats();

  return (
    <div className="px-4 md:px-6 py-6">
      {/* Status Strip */}
      <motion.div
        className="mb-8 px-4 py-3 rounded-xl border border-border bg-card/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-medium tracking-tight text-foreground truncate">
                DASHBOARD ONLINE
              </h1>
              <p className="text-[11px] text-muted-foreground font-mono">
                All critical systems operational · Last sync:{" "}
                <span className="text-accent">just now</span>
              </p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-4 text-xs shrink-0">
            {overallStats && (
              <>
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Services</span>
                  <span className="font-mono tabular-nums text-card-foreground">
                    {overallStats.total_services} monitored
                  </span>
                </div>
                <div className="w-px h-8 bg-border" />
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Uptime (24h)</span>
                  <span className="font-mono tabular-nums text-card-foreground">
                    {overallStats.successful_checks > 0
                      ? `${((overallStats.successful_checks / overallStats.total_checks) * 100).toFixed(1)}%`
                      : "N/A"}
                  </span>
                </div>
                <div className="w-px h-8 bg-border" />
                <div className="flex flex-col items-end">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Avg Response</span>
                  <span className="font-mono tabular-nums text-card-foreground">
                    {overallStats.avg_response_time
                      ? `${Math.round(overallStats.avg_response_time)}ms`
                      : "N/A"}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* Quick Actions */}
      <div className="mb-8">
        <QuickActions />
      </div>

      {/* System Status */}
      <div className="mb-8">
        <SystemStatus />
      </div>

      {/* Services Grid */}
      <ServiceGrid />
    </div>
  );
}
