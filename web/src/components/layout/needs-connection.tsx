import type { ReactNode } from "react";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/hooks/use-online";

// NeedsConnection stands in for what only works online (settings, export
// and import, admin pages, sign-in; ADR-0009 decision 7) while there is no
// connection. It comes back by itself once the device is online.
export function NeedsConnection({ what, className }: { what: string; className?: string }) {
  return (
    <div role="status" className={className ?? "flex flex-col items-start gap-3 px-4 py-6 md:px-6"}>
      <WifiOff className="h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">{what} needs a connection.</span> It opens again once
        you're back online.
      </p>
    </div>
  );
}

// OnlineOnly shows children only with a connection, and NeedsConnection
// without one, so nothing inside even tries to load.
export function OnlineOnly({ what, children }: { what: string; children: ReactNode }) {
  return useOnline() ? <>{children}</> : <NeedsConnection what={what} />;
}
