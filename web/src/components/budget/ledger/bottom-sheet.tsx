import type { ButtonHTMLAttributes } from "react";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

// BottomSheet slides up from the bottom on a phone and sits centred near
// the bottom on a wider screen. Its parts: a header that stays, a body
// that scrolls, a footer that stays.
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  header,
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "flex max-h-[92dvh] flex-col rounded-t-3xl border-border bg-popover p-0",
          "sm:inset-x-auto sm:bottom-4 sm:left-1/2 sm:w-[480px] sm:-translate-x-1/2 sm:rounded-3xl sm:border",
          // Each sheet has its own close control.
          "[&>button:last-child]:hidden",
          className,
        )}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        <SheetDescription className="sr-only">{description ?? title}</SheetDescription>
        <div className="flex flex-col gap-3 px-4 pt-2.5 pb-1.5">
          <div aria-hidden className="mx-auto h-1 w-10 rounded-full bg-foreground/25" />
          {header}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pt-1.5 pb-4">{children}</div>
        {footer && <div className="border-t border-border px-4 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </SheetContent>
    </Sheet>
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
