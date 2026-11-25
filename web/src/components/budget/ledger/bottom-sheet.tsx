import type { ButtonHTMLAttributes } from "react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/utils";
import { CLOSE_THRESHOLD, useSheetClose, useSheetIsPhone } from "./use-sheet-close";

// BottomSheet slides up from the bottom on a phone and sits centred on a
// wider screen. Its parts: a header that stays, a body that scrolls, a
// footer that stays.
//
// Vaul supplies dismissal by drag. On a phone the whole card follows the
// finger (a scrolled body scrolls instead, until it is back at the top);
// on a wider screen only the handle drags, so text stays selectable, and
// the card rises in and drops out (.bottom-sheet in app.css).
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  header,
  footer,
  children,
  className,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  // wide lays a desktop sheet out across, so it needs no scrolling.
  wide?: boolean;
}) {
  const phone = useSheetIsPhone();
  // A dismissal from the sheet itself (drag, Escape, a tap outside) plays
  // the exit, then reports the close.
  const dismiss = useSheetClose(() => onOpenChange(false));
  // A light tick when a drag crosses the point where letting go dismisses
  // (Android; other browsers have no vibrate and skip it).
  const past = useRef(false);
  const onDrag = (_: unknown, share: number) => {
    const now = share >= CLOSE_THRESHOLD;
    if (now && !past.current) navigator.vibrate?.(8);
    past.current = now;
  };

  return (
    <Drawer.Root
      open={open && dismiss.open}
      onOpenChange={(o) => (o ? onOpenChange(true) : dismiss.close())}
      closeThreshold={CLOSE_THRESHOLD}
      handleOnly={!phone}
      onDrag={onDrag}
      onRelease={() => (past.current = false)}
      shouldScaleBackground={false}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Overlay className="bottom-sheet-overlay fixed inset-0 z-50 bg-black/80" />
        <Drawer.Content
          // No focus ring on the first button when a sheet opens; a field
          // that should take focus asks for it itself.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-3xl border-t border-border bg-popover p-0 shadow-lg outline-none",
            // From a tablet up it is a card in the middle of the screen.
            "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[88dvh] sm:w-[480px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl sm:border",
            wide && "md:w-[min(720px,calc(100vw-3rem))] lg:w-[min(960px,calc(100vw-4rem))]",
            className,
          )}
        >
          <Drawer.Title className="sr-only">{title}</Drawer.Title>
          <Drawer.Description className="sr-only">{description ?? title}</Drawer.Description>
          <div className={cn("flex flex-col gap-3 px-4 pt-2.5 pb-1.5 sm:pt-2", wide && "lg:px-6")}>
            <Drawer.Handle className="bottom-sheet-handle mx-auto" />
            {header}
          </div>
          <div className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pt-1.5 pb-4", wide && "lg:px-6")}>{children}</div>
          {footer && <div className={cn("border-t border-border px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-4", wide && "lg:px-6")}>{footer}</div>}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Segmented is a row of choices where one is on.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  activeClass = "bg-foreground text-background",
  labels,
  className,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  activeClass?: string;
  labels?: Partial<Record<T, string>>;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex rounded-xl bg-muted p-[3px]", className)}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={o === value}
          onClick={() => onChange(o)}
          className={cn(
            "min-h-9 flex-1 whitespace-nowrap rounded-[10px] px-2 text-sm transition-colors",
            o === value ? cn("font-semibold", activeClass) : "font-medium text-foreground/80 hover:text-foreground",
          )}
        >
          {labels?.[o] ?? o[0].toUpperCase() + o.slice(1)}
        </button>
      ))}
    </div>
  );
}

// Field is a labelled group in a sheet.
export function Field({ label, htmlFor, children, aside }: { label: string; htmlFor?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted-foreground">
            {label}
          </label>
        ) : (
          <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        )}
        {aside}
      </div>
      {children}
    </div>
  );
}

export function Pill({
  on,
  onClick,
  children,
  className,
  ...rest
}: { on?: boolean; onClick?: () => void; children: ReactNode; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm transition-colors",
        on ? "bg-foreground font-semibold text-background" : "border border-foreground/15 font-medium text-foreground hover:bg-foreground/5",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
