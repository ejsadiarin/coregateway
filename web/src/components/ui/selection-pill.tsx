import { motion } from "motion/react";
import { cn } from "@/lib/utils";

// The glide between options of a segmented control, tab list or nav: one
// highlight per group, drawn behind the chosen option, that moves to the
// next choice instead of jumping (DESIGN §6). Give every option of a group
// the same `group` (a useId() per mounted control, so two controls never
// share one highlight) and render the pill only inside the chosen option;
// the option needs `relative isolate` so the pill sits behind its label.
// MotionConfig reducedMotion="user" at the app root snaps it.
export function SelectionPill({ group, className }: { group: string; className?: string }) {
  return (
    <motion.span
      layoutId={group}
      aria-hidden
      className={cn("absolute inset-0 -z-10", className)}
      transition={{ type: "spring", bounce: 0.18, duration: 0.4 }}
    />
  );
}
