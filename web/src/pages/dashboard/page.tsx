import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { MessageSquareText, PenTool, SquareKanban, Wallet } from "lucide-react";
import { ServiceGrid } from "@/components/dashboard/service-grid";
import { useAllServicesStats } from "@/hooks/use-services";
import { useAuth } from "@/contexts/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const destinations = [
  { label: "Budget", path: "/dashboard/budget", icon: Wallet, description: "Spending, income and what is left" },
  { label: "Feed", path: "/dashboard/feed", icon: MessageSquareText, description: "Notes, reminders and captures" },
  { label: "Draw", path: "/dashboard/draw", icon: PenTool, description: "Boards and sketches" },
  { label: "Kanban", path: "/dashboard/kanban", icon: SquareKanban, description: "Cards and reminders" },
];

function AdminHome() {
  const { data: overallStats } = useAllServicesStats();

  return (
    <div className="px-4 md:px-6 py-6">
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

      <ServiceGrid />
    </div>
  );
}

export default function DashboardPage() {
  const { isAdmin } = useAuth();

  if (isAdmin) return <AdminHome />;

  return (
    <div className="px-4 md:px-6 py-6">
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <h1 className="text-primary">WELCOME</h1>
        <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">
          Your budget, notes, boards and sketches. Pick a place to start.
        </p>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {destinations.map((destination, index) => (
          <motion.div
            key={destination.label}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index * 0.06, 0.24) }}
          >
            <Link to={destination.path} className="block">
              <Card className="h-full transition-colors hover:border-primary/60">
                <CardHeader className="pb-2">
                  <destination.icon className="mb-2 h-5 w-5 text-primary" />
                  <CardTitle className="text-base">{destination.label}</CardTitle>
                  <CardDescription>{destination.description}</CardDescription>
                </CardHeader>
                <CardContent />
              </Card>
            </Link>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
