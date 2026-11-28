import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useAuth } from "@/contexts/auth-context";
import { lastSeenPersister, queryClient } from "@/contexts/query-context";
import { LAST_SEEN_VERSION, keepsLastSeen } from "@/lib/last-seen";

// LastSeenProvider gives the dashboard its QueryClient, restoring the
// signed-in account's last-seen data from the device first and keeping it
// as reads land. Keyed by account, so one account never restores into
// another's.
export function LastSeenProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return (
    <PersistQueryClientProvider
      key={user.id}
      client={queryClient}
      persistOptions={{
        persister: lastSeenPersister(user.id),
        maxAge: Infinity,
        buster: LAST_SEEN_VERSION,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === "success" && keepsLastSeen(q.queryKey),
          // Writes aren't kept yet: the Outbox queue (ADR-0009) is to come.
          shouldDehydrateMutation: () => false,
        },
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
