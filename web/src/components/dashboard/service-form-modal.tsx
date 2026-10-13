
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateService, useUpdateService } from "@/hooks/use-services";
import type { Service } from "@/types/api";

const serviceFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(255),
  url: z.string().url("Must be a valid URL"),
  icon: z.string().optional(),
  description: z.string().optional(),
  service_type: z.string().optional(),
  health_check_interval: z.number().min(10).max(3600),
  health_check_method: z.enum(["GET", "POST", "HEAD"]),
  timeout: z.number().min(1000).max(30000),
  is_active: z.boolean(),
});

type ServiceFormData = z.infer<typeof serviceFormSchema>;

interface ServiceFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  service?: Service | null; // if provided, we're editing
}

export function ServiceFormModal({
  isOpen,
  onClose,
  onSuccess,
  service,
}: ServiceFormModalProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isEditing = !!service;

  const createService = useCreateService();
  const updateService = useUpdateService();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormData>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: service
      ? {
          name: service.name,
          url: service.url,
          icon: service.icon || "",
          description: service.description || "",
          service_type: service.service_type || "",
          health_check_interval: service.health_check_interval,
          health_check_method: service.health_check_method as
            | "GET"
            | "POST"
            | "HEAD",
          timeout: service.timeout,
          is_active: service.is_active,
        }
      : {
          name: "",
          url: "",
          icon: "",
          description: "",
          service_type: "",
          health_check_interval: 60,
          health_check_method: "GET",
          timeout: 5000,
          is_active: true,
        },
  });

  const healthCheckMethod = watch("health_check_method");

  const onSubmit = async (data: ServiceFormData) => {
    try {
      if (isEditing && service) {
        await updateService.mutateAsync({
          id: service.id,
          data: {
            name: data.name,
            url: data.url,
            icon: data.icon || undefined,
            description: data.description || undefined,
            service_type: data.service_type || undefined,
            health_check_interval: data.health_check_interval,
            health_check_method: data.health_check_method,
            timeout: data.timeout,
            is_active: data.is_active,
          },
        });
      } else {
        await createService.mutateAsync({
          name: data.name,
          url: data.url,
          icon: data.icon || undefined,
          description: data.description || undefined,
          service_type: data.service_type || undefined,
          health_check_interval: data.health_check_interval,
          health_check_method: data.health_check_method,
          timeout: data.timeout,
        });
      }
      handleClose();
      onSuccess?.();
    } catch {
      // error is handled by react-query
    }
  };

  const handleClose = () => {
    reset();
    setShowAdvanced(false);
    onClose();
  };

  const isPending = createService.isPending || updateService.isPending;
  const error = createService.error || updateService.error;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Service" : "Add New Service"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the service configuration below."
              : "Configure a new service to monitor its health and uptime."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="My Service"
              {...register("name")}
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>

          {/* URL */}
          <div className="space-y-2">
            <Label htmlFor="url">
              URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="url"
              placeholder="https://example.com"
              {...register("url")}
              aria-invalid={!!errors.url}
            />
            {errors.url && (
              <p className="text-xs text-destructive">{errors.url.message}</p>
            )}
          </div>

          {/* Service Type */}
          <div className="space-y-2">
            <Label htmlFor="service_type">Service Type</Label>
            <Input
              id="service_type"
              placeholder="Web, API, Database, etc."
              {...register("service_type")}
            />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Brief description of this service..."
              rows={2}
              {...register("description")}
            />
          </div>

          {/* Icon */}
          <div className="space-y-2">
            <Label htmlFor="icon">Icon</Label>
            <Input
              id="icon"
              placeholder="icon-name or emoji"
              {...register("icon")}
            />
            <p className="text-xs text-muted-foreground">
              Enter an icon name or emoji to display with this service
            </p>
          </div>

          {/* Advanced Settings Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showAdvanced ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            Advanced Settings
          </button>

          {/* Advanced Settings */}
          {showAdvanced && (
            <div className="space-y-4 p-4 rounded-lg border border-border bg-card/30">
              {/* Health Check Interval */}
              <div className="space-y-2">
                <Label htmlFor="health_check_interval">
                  Check Interval (seconds)
                </Label>
                <Input
                  id="health_check_interval"
                  type="number"
                  min={10}
                  max={3600}
                  {...register("health_check_interval", { valueAsNumber: true })}
                />
                {errors.health_check_interval && (
                  <p className="text-xs text-destructive">
                    {errors.health_check_interval.message}
                  </p>
                )}
              </div>

              {/* Health Check Method */}
              <div className="space-y-2">
                <Label>HTTP Method</Label>
                <Select
                  value={healthCheckMethod}
                  onValueChange={(value) =>
                    setValue(
                      "health_check_method",
                      value as "GET" | "POST" | "HEAD"
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GET">GET</SelectItem>
                    <SelectItem value="POST">POST</SelectItem>
                    <SelectItem value="HEAD">HEAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Timeout */}
              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (milliseconds)</Label>
                <Input
                  id="timeout"
                  type="number"
                  min={1000}
                  max={30000}
                  {...register("timeout", { valueAsNumber: true })}
                />
                {errors.timeout && (
                  <p className="text-xs text-destructive">
                    {errors.timeout.message}
                  </p>
                )}
              </div>

              {/* Active Status (only for edit mode) */}
              {isEditing && (
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="is_active"
                    {...register("is_active")}
                    className="w-4 h-4 rounded border-input"
                  />
                  <Label htmlFor="is_active" className="cursor-pointer">
                    Service is active
                  </Label>
                </div>
              )}
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 rounded-lg border border-destructive/50 bg-destructive/10">
              <p className="text-sm text-destructive">
                {error instanceof Error
                  ? error.message
                  : "An error occurred. Please try again."}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || isSubmitting}>
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {isEditing ? "Updating..." : "Creating..."}
                </>
              ) : isEditing ? (
                "Update Service"
              ) : (
                "Add Service"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
