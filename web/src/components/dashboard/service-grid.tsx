
import { useState } from "react";
import { motion } from "motion/react";
import { RefreshCw, Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ServiceCard, ServiceCardSkeleton } from "./service-card";
import { ServiceDetailModal } from "./service-detail-modal";
import { ServiceFormModal } from "./service-form-modal";
import { useServices } from "@/hooks/use-services";
import type { Service } from "@/types/api";

export function ServiceGrid() {
  const { data: services, isLoading, error, refetch, isFetching } = useServices();
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const handleServiceClick = (service: Service) => {
    setSelectedService(service);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    // delay clearing selected service to allow modal close animation
    setTimeout(() => setSelectedService(null), 200);
  };

  const onlineCount = services?.filter(
    (s) => s.current_status === "online"
  ).length ?? 0;
  const totalCount = services?.length ?? 0;

  // error state
  if (error) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-primary">ACTIVE SERVICES</h2>
        </div>
        <motion.div
          className="flex flex-col items-center justify-center p-12 rounded-lg border border-destructive/30 bg-destructive/5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <AlertCircle className="w-12 h-12 text-destructive mb-4" />
          <h3 className="text-lg font-medium text-destructive mb-2">
            Failed to Load Services
          </h3>
          <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
            Unable to connect to the API server. Make sure the backend is running on port 8080.
          </p>
          <Button
            variant="outline"
            onClick={() => refetch()}
            className="border-destructive/50 hover:bg-destructive/10"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </Button>
        </motion.div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-primary">ACTIVE SERVICES</h2>
          <div className="h-4 w-32 bg-muted rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <ServiceCardSkeleton key={idx} delay={idx * 0.05} />
          ))}
        </div>
      </div>
    );
  }

  // Empty state
  if (!services || services.length === 0) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-primary">ACTIVE SERVICES</h2>
        </div>
        <motion.div
          className="flex flex-col items-center justify-center p-12 rounded-lg border border-border bg-card/50"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Plus className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-medium text-card-foreground mb-2">
            No Services Configured
          </h3>
          <p className="text-sm text-muted-foreground mb-4 text-center max-w-md">
            Add your first service to start monitoring its health and uptime.
          </p>
          <Button
            variant="outline"
            className="border-primary/50 hover:bg-primary/10"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="w-4 h-4" />
            Add Service
          </Button>
        </motion.div>

        {/* Add Service Modal */}
        <ServiceFormModal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="mb-8">
      {/* Header */}
      <motion.div
        className="flex items-center justify-between mb-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <h2 className="text-primary">ACTIVE SERVICES</h2>
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted-foreground">
            {onlineCount} of {totalCount} operational
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsAddModalOpen(true)}
            className="h-8 border-primary/50 hover:bg-primary/10"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8 px-2"
          >
            <RefreshCw
              className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </motion.div>

      {/* Services Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {services.map((service, idx) => (
          <ServiceCard
            key={service.id}
            service={service}
            onClick={() => handleServiceClick(service)}
            delay={0.1 + idx * 0.05}
          />
        ))}
      </div>

      {/* Service Detail Modal */}
      <ServiceDetailModal
        service={selectedService}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
      />

      {/* Add Service Modal */}
      <ServiceFormModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
      />
    </div>
  );
}
