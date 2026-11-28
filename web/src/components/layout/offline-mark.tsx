import { useOnline } from "@/hooks/use-online";

// OfflineMark is the strip under the header while there is no connection:
// what the page shows is its last-seen data, saved on this device.
export function OfflineMark() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground md:px-6"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
      <span className="text-foreground">Offline</span>
      <span aria-hidden>·</span>
      <span className="truncate">Last-seen data on this device</span>
    </div>
  );
}
