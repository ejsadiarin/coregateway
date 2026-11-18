// The editor's loading state: a skeletal top bar, canvas and phone toolbar.
// Kept free of engine imports so the dashboard can use it as the lazy route
// fallback without pulling Excalidraw into the main bundle.

export function DrawEditorSkeleton() {
  return (
    <div
      role="status"
      aria-label="Opening board"
      className="flex h-full min-h-0 flex-col max-md:overscroll-none md:min-h-[500px]"
    >
      <div className="flex h-[53px] shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:h-[39px]">
        <div className="h-4 w-14 animate-pulse rounded bg-muted" />
        <div className="h-4 w-36 animate-pulse rounded bg-muted" />
        <div className="ml-auto h-4 w-24 animate-pulse rounded bg-muted" />
      </div>
      <div className="hidden h-[33px] shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:flex">
        <div className="h-3 w-12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-12 shrink-0 border-r border-border bg-muted/20 md:block" />
        <div className="flex-1 p-4">
          <div className="h-full w-full animate-pulse rounded-lg border border-border bg-muted/20" />
        </div>
      </div>
      <div className="h-[99px] shrink-0 border-t border-border bg-muted/20 md:hidden" />
    </div>
  );
}
