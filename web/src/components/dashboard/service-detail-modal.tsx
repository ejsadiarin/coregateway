
import {
  ExternalLink,
  RefreshCw,
  Clock,
  Activity,
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
import { useTriggerHealthCheck } from "@/hooks/use-services";
import type { Service } from "@/types/api";
import { formatDistanceToNow } from "date-fns";

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

function formatResponseTime(ms?: number): string {
  if (!ms) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function ServiceDetailModal({
  service,
  isOpen,
  onClose,
}: ServiceDetailModalProps) {
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
                <ExternalLink className="w-4 h-4" />
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
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
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

          {/* Latest check result; only the latest is kept, not a history. */}
          {service.last_error && (
            <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/5">
              <p className="text-xs text-muted-foreground mb-1">Last check failed</p>
              <p className="text-sm text-destructive break-words">{service.last_error}</p>
            </div>
          )}

          {/* Service Configuration (collapsed details) */}
          <div className="text-xs text-muted-foreground border-t border-border pt-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
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
