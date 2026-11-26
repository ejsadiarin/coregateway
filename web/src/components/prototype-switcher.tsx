// PROTOTYPE tooling (throwaway): a floating bar that flips between UI
// variants via a URL search param. Dev builds only.
import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function PrototypeSwitcher({
  variants,
  current,
  param = "variant",
}: {
  variants: { key: string; name: string }[];
  current: string;
  param?: string;
}) {
  const [sp, setSp] = useSearchParams();
  const idx = Math.max(0, variants.findIndex((v) => v.key === current));
  const step = (d: number) => {
    const next = variants[(idx + d + variants.length) % variants.length];
    const p = new URLSearchParams(sp);
    p.set(param, next.key);
    setSp(p, { replace: true });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']"))) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const v = variants[idx];
  return (
    <div className="fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-foreground p-1 font-mono text-[11px] text-background shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)]">
      <button type="button" onClick={() => step(-1)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-background/15" aria-label="Previous variant">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="whitespace-nowrap px-1 tabular-nums">
        {v.key} <span className="opacity-60">({v.name})</span>
      </span>
      <button type="button" onClick={() => step(1)} className="grid h-7 w-7 place-items-center rounded-full hover:bg-background/15" aria-label="Next variant">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
