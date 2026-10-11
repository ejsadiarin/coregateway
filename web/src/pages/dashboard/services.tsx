import { useState, useMemo } from "react";
import { motion } from "motion/react";
import {
  Plus,
  RefreshCw,
  Search,
  ExternalLink,
  MoreVertical,
  Pencil,
  Trash2,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ServiceFormModal } from "@/components/dashboard/service-form-modal";
import { ServiceDetailModal } from "@/components/dashboard/service-detail-modal";
import { useServices, useDeleteService, useTriggerHealthCheck } from "@/hooks/use-services";
import type { Service } from "@/types/api";
import { formatDistanceToNow } from "date-fns";

type StatusFilter = "all" | "online" | "offline" | "degraded" | "maintenance";

const statusColors: Record<string, string> = {
  online: "text-accent border-accent/50 bg-accent/10",
  offline: "text-destructive border-destructive/50 bg-destructive/10",
  degraded: "text-amber-500 border-amber-500/50 bg-amber-500/10",
  maintenance: "text-secondary border-secondary/50 bg-secondary/10",
  unknown: "text-muted-foreground border-muted-foreground/50 bg-muted-foreground/10",
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
  if (!ms) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function ServicesPage() {
  const { data: services, isLoading, error, refetch, isFetching } = useServices();
  const deleteService = useDeleteService();
  const triggerHealthCheck = useTriggerHealthCheck();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const serviceTypes = useMemo(() => {
    if (!services) return [];
    const types = new Set<string>();
    services.forEach((s) => {
      if (s.service_type) types.add(s.service_type);
    });
    return Array.from(types).sort();
  }, [services]);

  const filteredServices = useMemo(() => {
    if (!services) return [];
    return services.filter((service) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          service.name.toLowerCase().includes(query) ||
          service.url.toLowerCase().includes(query) ||
          service.description?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }
      if (statusFilter !== "all") {
        if (service.current_status !== statusFilter) return false;
      }
      if (typeFilter !== "all") {
        if (service.service_type !== typeFilter) return false;
      }
      return true;
    });
  }, [services, searchQuery, statusFilter, typeFilter]);

  const handleDelete = async (service: Service) => {
    if (!confirm(`Are you sure you want to delete "${service.name}"?`)) return;
    await deleteService.mutateAsync(service.id);
  };

  const handleViewDetails = (service: Service) => {
    setSelectedService(service);
    setIsDetailModalOpen(true);
  };

  const handleCloseDetailModal = () => {
    setIsDetailModalOpen(false);
    setTimeout(() => setSelectedService(null), 200);
  };

  const stats = useMemo(() => {
    if (!services) return { total: 0, online: 0, offline: 0, degraded: 0 };
    return {
      total: services.length,
      online: services.filter((s) => s.current_status === "online").length,
      offline: services.filter((s) => s.current_status === "offline").length,
      degraded: services.filter((s) => s.current_status === "degraded").length,
    };
  }, [services]);

  return (
    <div className="px-4 md:px-6 py-6">
      {/* Header */}
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-4 mb-4">
          <Link to="/dashboard">
            <Button variant="ghost" size="sm" className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Dashboard
            </Button>
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-primary mb-2">
              Service Management
            </h1>
            <p className="text-sm text-muted-foreground">
              Monitor and manage all your services in one place
            </p>
          </div>
          <Button onClick={() => setIsAddModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Service
          </Button>
        </div>
      </motion.div>

      {/* Stats Cards */}
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="p-4 rounded-lg border border-border bg-card/50">
          <p className="text-xs text-muted-foreground mb-1">Total Services</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="p-4 rounded-lg border border-accent/30 bg-accent/5">
          <p className="text-xs text-muted-foreground mb-1">Online</p>
          <p className="text-2xl font-bold text-accent">{stats.online}</p>
        </div>
        <div className="p-4 rounded-lg border border-destructive/30 bg-destructive/5">
          <p className="text-xs text-muted-foreground mb-1">Offline</p>
          <p className="text-2xl font-bold text-destructive">{stats.offline}</p>
        </div>
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <p className="text-xs text-muted-foreground mb-1">Degraded</p>
          <p className="text-2xl font-bold text-amber-500">{stats.degraded}</p>
        </div>
      </motion.div>

      {/* Filters */}
      <motion.div
        className="flex flex-col md:flex-row gap-4 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2 }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as StatusFilter)}
        >
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="degraded">Degraded</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full md:w-[180px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {serviceTypes.map((type) => (
              <SelectItem key={type} value={type}>
                {type}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </motion.div>

      {/* Table */}
      <motion.div
        className="rounded-lg border border-border bg-card/30 overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.3 }}
      >
        {isLoading ? (
          <div className="p-8 text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading services...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center">
            <XCircle className="w-8 h-8 mx-auto mb-4 text-destructive" />
            <p className="text-sm text-destructive mb-4">
              Failed to load services
            </p>
            <Button variant="outline" onClick={() => refetch()}>
              Try Again
            </Button>
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="p-8 text-center">
            <Activity className="w-8 h-8 mx-auto mb-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground mb-4">
              {services?.length === 0
                ? "No services configured yet"
                : "No services match your filters"}
            </p>
            {services?.length === 0 && (
              <Button onClick={() => setIsAddModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Service
              </Button>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Type</TableHead>
                <TableHead className="hidden lg:table-cell">
                  Response Time
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  Last Check
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredServices.map((service) => (
                <TableRow
                  key={service.id}
                  className="cursor-pointer"
                  onClick={() => handleViewDetails(service)}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{service.name}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                        {service.url}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={`${
                        statusColors[service.current_status ?? "unknown"]
                      } border`}
                    >
                      <div className="flex items-center gap-1.5">
                        {getStatusIcon(service.current_status ?? "unknown")}
                        <span className="capitalize">
                          {service.current_status ?? "Unknown"}
                        </span>
                      </div>
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {service.service_type || "-"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-sm">
                      {formatResponseTime(service.response_time)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {service.last_check
                        ? formatDistanceToNow(new Date(service.last_check), {
                            addSuffix: true,
                          })
                        : "Never"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        asChild
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(service.url, "_blank");
                          }}
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Visit URL
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            triggerHealthCheck.mutate(service.id);
                          }}
                        >
                          <RefreshCw className="w-4 h-4 mr-2" />
                          Check Now
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingService(service);
                          }}
                        >
                          <Pencil className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(service);
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </motion.div>

      {/* Results count */}
      {filteredServices.length > 0 && (
        <p className="text-xs text-muted-foreground mt-4">
          Showing {filteredServices.length} of {services?.length ?? 0} services
        </p>
      )}

      {/* Add Service Modal */}
      <ServiceFormModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />

      {/* Edit Service Modal */}
      <ServiceFormModal
        isOpen={!!editingService}
        onClose={() => setEditingService(null)}
        service={editingService}
      />

      {/* Service Detail Modal */}
      <ServiceDetailModal
        service={selectedService}
        isOpen={isDetailModalOpen}
        onClose={handleCloseDetailModal}
      />
    </div>
  );
}
