
import { motion } from "motion/react";
import {
  ExternalLink,
  RefreshCw,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useServiceStats, useServiceHistory, useTriggerHealthCheck } from "@/hooks/use-services";
import type { Service, ServiceHealthHistory } from "@/types/api";
import { formatDistanceToNow, format } from "date-fns";

interface ServiceDetailModalProps {
  service: Service | null;
  isOpen: boolean;
  onClose: () => void;
}

type ServiceStatus = "online" | "offline" | "degraded" | "maintenance" | "unknown";

const statusColors: Record<ServiceStatus, string> = {
  online: "text-accent border-accent/50 bg-accent/10",
  offline: "text-destructive border-destructive/50 bg-destructive/10",
  degraded: "text-amber-500 border-amber-500/50 bg-amber-500/10",
  maintenance: "text-secondary border-secondary/50 bg-secondary/10",
  unknown: "text-muted-foreground border-muted-foreground/50 bg-muted-foreground/10",
};

const statusLabels: Record<ServiceStatus, string> = {
  online: "ONLINE",
  offline: "OFFLINE",
  degraded: "DEGRADED",
  maintenance: "MAINTENANCE",
  unknown: "UNKNOWN",
};

function getStatusIcon(status: string) {
  switch (status) {
    case "online":
      return <CheckCircle2 className="w-4 h-4 text-accent" />;
    case "offline":
      return <XCircle className="w-4 h-4 text-destructive" />;
    case "degraded":
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    default:
      return <Activity className="w-4 h-4 text-muted-foreground" />;
  }
}

function formatResponseTime(ms?: number): string {
  if (!ms) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(percentage: number): string {
  return `${percentage.toFixed(2)}%`;
}

function UptimeCard({
  label,
  value,
  delay,
}: {
  label: string;
  value: number;
  delay: number;
}) {
  const color =
    value >= 99 ? "text-accent" : value >= 95 ? "text-amber-500" : "text-destructive";

  return (
    <motion.div
      className="flex flex-col items-center p-3 rounded-lg border border-border bg-card/50"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, delay }}
    >
      <span className="text-xs text-muted-foreground mb-1">{label}</span>
      <span className={`text-lg font-semibold ${color}`}>
        {formatUptime(value)}
      </span>
    </motion.div>
  );
}

function HistoryItem({ history, index }: { history: ServiceHealthHistory; index: number }) {
  return (
    <motion.div
      className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, delay: index * 0.05 }}
    >
      <div className="flex items-center gap-2">
        {getStatusIcon(history.status)}
        <span className="text-sm capitalize">{history.status}</span>
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {history.response_time && (
          <span>{formatResponseTime(history.response_time)}</span>
        )}
        <span>{format(new Date(history.checked_at), "MMM d, HH:mm:ss")}</span>
      </div>
    </motion.div>
  );
}

export function ServiceDetailModal({
  service,
  isOpen,
  onClose,
}: ServiceDetailModalProps) {
  const { data: stats, isLoading: statsLoading } = useServiceStats(
    service?.id ?? null,
    isOpen
  );
  const { data: history, isLoading: historyLoading } = useServiceHistory(
    service?.id ?? null,
    isOpen
  );
  const triggerHealthCheck = useTriggerHealthCheck();

  if (!service) return null;

  const status: ServiceStatus = service.current_status ?? "unknown";

  const handleVisitUrl = () => {
    window.open(service.url, "_blank", "noopener,noreferrer");
  };

  const handleTriggerHealthCheck = () => {
    triggerHealthCheck.mutate(service.id);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start justify-between pr-8">
            <div>
              <DialogTitle className="text-xl">{service.name}</DialogTitle>
              <DialogDescription className="mt-1">
                {service.description || service.service_type || "Service monitoring details"}
              </DialogDescription>
            </div>
            <Badge className={`${statusColors[status]} border text-xs`}>
              <div className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
              {statusLabels[status]}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Service Info */}
          <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card/30">
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground mb-1">URL</p>
              <p className="text-sm truncate">{service.url}</p>
            </div>
            <div className="flex gap-2 ml-4">
              <Button
                variant="outline"
                size="sm"
                onClick={handleVisitUrl}
                className="border-primary/50 hover:bg-primary/10"
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Visit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTriggerHealthCheck}
                disabled={triggerHealthCheck.isPending}
                className="border-accent/50 hover:bg-accent/10"
              >
                {triggerHealthCheck.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-2" />
                )}
                Check Now
              </Button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-border bg-card/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Activity className="w-3 h-3" />
                Response Time
              </div>
              <p className="text-lg font-semibold">
                {formatResponseTime(service.response_time)}
              </p>
            </div>
            <div className="p-4 rounded-lg border border-border bg-card/30">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Clock className="w-3 h-3" />
                Last Check
              </div>
              <p className="text-lg font-semibold">
                {service.last_check
                  ? formatDistanceToNow(new Date(service.last_check), {
                      addSuffix: true,
                    })
                  : "Never"}
              </p>
            </div>
          </div>

          {/* Uptime Statistics */}
          <div>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-accent" />
              Uptime Statistics
            </h3>
            {statsLoading ? (
              <div className="grid grid-cols-3 gap-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-20 rounded-lg border border-border bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : stats ? (
              <div className="grid grid-cols-3 gap-3">
                <UptimeCard label="Last 24h" value={stats.uptime_24h} delay={0} />
                <UptimeCard label="Last 7 days" value={stats.uptime_7d} delay={0.1} />
                <UptimeCard label="Last 30 days" value={stats.uptime_30d} delay={0.2} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No statistics available</p>
            )}
            {stats && (
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Avg Response: {formatResponseTime(stats.avg_response_time)}
                </span>
                <span>
                  {stats.successful_checks} / {stats.total_checks} checks passed
                </span>
              </div>
            )}
          </div>

          {/* Health Check History */}
          <div>
            <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              Recent Health Checks
            </h3>
            {historyLoading ? (
              <div className="space-y-2">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-10 rounded border border-border bg-muted animate-pulse"
                  />
                ))}
              </div>
            ) : history && history.length > 0 ? (
              <div className="max-h-60 overflow-y-auto rounded-lg border border-border bg-card/30 p-3">
                {history.slice(0, 15).map((h, idx) => (
                  <HistoryItem key={h.id} history={h} index={idx} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground p-4 text-center border border-border rounded-lg">
                No health check history available
              </p>
            )}
          </div>

          {/* Service Configuration (collapsed details) */}
          <div className="text-xs text-muted-foreground border-t border-border pt-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>
                Check Interval: <strong>{service.health_check_interval}s</strong>
              </span>
              <span>
                Method: <strong>{service.health_check_method}</strong>
              </span>
              <span>
                Timeout: <strong>{service.timeout}ms</strong>
              </span>
              <span>
                Expected Codes:{" "}
                <strong>{service.expected_status_codes.join(", ")}</strong>
              </span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
