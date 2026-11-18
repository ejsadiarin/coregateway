// A phone-only bottom sheet for the Draw panels. Vaul supplies the drag-to-
// dismiss gesture, the overlay tap and Escape; the desktop keeps its side
// panels, so callers only mount this below the md breakpoint.

import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/utils";

export function DrawSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={false}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Drawer.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-background outline-none",
            "pb-[env(safe-area-inset-bottom)]",
            className,
          )}
        >
          <Drawer.Handle className="coredraw-draw-handle mx-auto mt-2 shrink-0" />
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">{description}</Drawer.Description>
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
