import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as api from "@/lib/api";
import type { BackupsStatus } from "@/types/api";

// useBackups polls while a backup runs, so the list fills in when it ends.
export function useBackups() {
    return useQuery<BackupsStatus, Error>({
        queryKey: ["backups"],
        queryFn: api.fetchBackups,
        refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
    });
}

export function useStartBackup() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.startBackup,
        // A 409 (already running) also means the list is stale.
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ["backups"] });
        },
    });
}
