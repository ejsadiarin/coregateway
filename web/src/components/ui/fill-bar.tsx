import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { cn } from "@/lib/utils";

// FillBar is the filled part of a bar: it grows from empty to `share`
// (0..1) the first time it is seen, and eases to a new share after. It
// scales rather than changing width, per DESIGN §6. Place it in a track
// with `overflow-hidden`.
export function FillBar({ share, className, style }: { share: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  return (
    <motion.span
      ref={ref}
      className={cn("block h-full w-full origin-left", className)}
      style={style}
      initial={{ scaleX: 0 }}
      animate={{ scaleX: inView ? Math.max(0, Math.min(1, share)) : 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
    />
  );
}
