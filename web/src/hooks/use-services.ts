import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchServices,
  fetchService,
  createService,
  updateService,
  deleteService,
  fetchServiceHistory,
  fetchServiceStats,
  fetchAllServicesStats
} from '@/lib/api';
import type {
  Service,
  CreateServiceRequest,
  UpdateServiceRequest,
  ServiceHealthHistory,
  ServiceStats
} from '@/types/api';

export const serviceKeys = {
  all: ['services'] as const,
  lists: () => [...serviceKeys.all, 'list'] as const,
  list: () => [...serviceKeys.lists()] as const,
  details: () => [...serviceKeys.all, 'detail'] as const,
  detail: (id: string) => [...serviceKeys.details(), id] as const,
  history: (id: string) => [...serviceKeys.all, 'history', id] as const,
  stats: (id: string) => [...serviceKeys.all, 'stats', id] as const,
  allStats: () => [...serviceKeys.all, 'stats', 'all'] as const
};

export function useServices() {
  return useQuery<Service[]>({
    queryKey: serviceKeys.list(),
    queryFn: fetchServices,
    refetchInterval: 30000,
    staleTime: 10000
  });
}

export function useService(id: string | null) {
  return useQuery<Service>({
    queryKey: serviceKeys.detail(id ?? ''),
    queryFn: () => fetchService(id!),
    enabled: !!id
  });
}

export function useServiceHistory(id: string | null, enabled: boolean = true) {
  return useQuery<ServiceHealthHistory[]>({
    queryKey: serviceKeys.history(id ?? ''),
    queryFn: () => fetchServiceHistory(id!),
    enabled: !!id && enabled,
    staleTime: 30000
  });
}

export function useServiceStats(id: string | null, enabled: boolean = true) {
  return useQuery<ServiceStats>({
    queryKey: serviceKeys.stats(id ?? ''),
    queryFn: () => fetchServiceStats(id!),
    enabled: !!id && enabled,
    staleTime: 60000
  });
}

export function useAllServicesStats(enabled = true) {
  return useQuery({
    queryKey: serviceKeys.allStats(),
    queryFn: fetchAllServicesStats,
    enabled,
    refetchInterval: 60000,
    staleTime: 30000
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateServiceRequest) => createService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
    }
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateServiceRequest }) => updateService(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
      queryClient.invalidateQueries({ queryKey: serviceKeys.detail(variables.id) });
    }
  });
}

export function useDeleteService() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: serviceKeys.lists() });
    }
  });
}

// Stub: health check trigger endpoint not implemented in coregateway
export function useTriggerHealthCheck() {
  return useMutation({
    mutationFn: async (_id: string) => { throw new Error('Health check trigger not implemented'); }
  });
}
