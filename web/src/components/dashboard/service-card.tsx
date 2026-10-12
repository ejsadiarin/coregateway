
import { useRef } from "react";
import { motion } from "motion/react";
import {
  Globe,
  Server,
  Database,
  Cloud,
  Lock,
  FileText,
  Video,
  Download,
  Mail,
  Code,
  HardDrive,
  Wifi,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Service } from "@/types/api";
import { formatDistanceToNow } from "date-fns";

// Map of service type/icon names to Lucide icons
const iconMap: Record<string, LucideIcon> = {
  server: Server,
  database: Database,
  cloud: Cloud,
  lock: Lock,
  file: FileText,
  video: Video,
  download: Download,
  globe: Globe,
  mail: Mail,
  code: Code,
  storage: HardDrive,
  wifi: Wifi,
  web: Globe,
  api: Server,
  default: Activity,
};

// Get icon based on service type or icon field
function getServiceIcon(service: Service): LucideIcon {
  // First try the icon field
  if (service.icon) {
    const iconKey = service.icon.toLowerCase();
    if (iconMap[iconKey]) return iconMap[iconKey];
  }
  // Then try service_type
  if (service.service_type) {
    const typeKey = service.service_type.toLowerCase();
    if (iconMap[typeKey]) return iconMap[typeKey];
  }
  // Default
  return iconMap.default;
}

type ServiceStatus = "online" | "offline" | "degraded" | "maintenance" | "unknown";

interface ServiceCardProps {
  service: Service;
  onClick?: () => void;
  delay?: number;
}

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

function formatLastCheck(timestamp?: string): string {
  if (!timestamp) return "Never";
  try {
    return formatDistanceToNow(new Date(timestamp), { addSuffix: true });
  } catch {
    return "Unknown";
  }
}

export function ServiceCard({ service, onClick, delay = 0 }: ServiceCardProps) {
  const Icon = getServiceIcon(service);
  const status: ServiceStatus = service.current_status ?? "unknown";
  const ref = useRef<HTMLDivElement>(null);

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      className="group relative overflow-hidden rounded-xl border border-border bg-card p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors duration-200 hover:border-primary/50 cursor-pointer"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(delay, 0.3) }}
      whileHover={{ y: -2 }}
      onClick={onClick}
    >
      {/* Top signal tick on hover */}
      <div className="absolute top-0 left-4 right-4 h-[2px] bg-primary opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
      {/* Spotlight follow */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            "radial-gradient(240px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 border border-primary/30">
              <Icon className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-card-foreground font-medium">{service.name}</h3>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                {service.description || service.service_type || "Service"}
              </p>
            </div>
          </div>
          <Badge className={`${statusColors[status]} border text-xs`}>
            <div className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
            {statusLabels[status]}
          </Badge>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/50">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Response Time</span>
            <span className="font-mono tabular-nums text-sm text-card-foreground mt-1">
              {formatResponseTime(service.response_time)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Last Check</span>
            <span className="font-mono tabular-nums text-sm text-card-foreground mt-1">
              {formatLastCheck(service.last_check)}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// Loading skeleton for service card
export function ServiceCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <motion.div
      className="relative overflow-hidden rounded-xl border border-border bg-card p-6"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-muted animate-pulse" />
          <div>
            <div className="h-4 w-24 bg-muted rounded animate-pulse" />
            <div className="h-3 w-32 bg-muted rounded animate-pulse mt-2" />
          </div>
        </div>
        <div className="h-5 w-16 bg-muted rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-4 border-t border-border/50">
        <div>
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          <div className="h-4 w-12 bg-muted rounded animate-pulse mt-2" />
        </div>
        <div>
          <div className="h-3 w-16 bg-muted rounded animate-pulse" />
          <div className="h-4 w-20 bg-muted rounded animate-pulse mt-2" />
        </div>
      </div>
    </motion.div>
  );
}
