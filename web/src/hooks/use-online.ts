import { useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

// useOnline follows whether the device has a connection, as React Query
// sees it (the browser's online and offline events), so a page and its
// reads agree on it.
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => onlineManager.subscribe(onChange),
    () => onlineManager.isOnline(),
  );
}
