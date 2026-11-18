import { motion } from "motion/react";
import { useAuth } from "@/contexts/auth-context";
import { LatestNotesCard } from "@/components/home/latest-notes-card";
import { DueTodayCard } from "@/components/home/due-today-card";
import { QuickCaptureCard } from "@/components/home/quick-capture-card";
import { BudgetGlanceCard } from "@/components/home/budget-glance-card";
import { ServiceHealthLine } from "@/components/home/service-health-line";

export default function DashboardPage() {
  const { isAdmin, isGuest } = useAuth();

  return (
    <div className="px-4 md:px-6 py-6">
      <motion.div
        className="mb-8"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex items-center gap-2">
          <h1 className="text-primary">HOME</h1>
          {isGuest && (
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              Demo
            </span>
          )}
        </div>
        <p className="mt-2 max-w-[65ch] text-sm text-muted-foreground">
          What needs your attention today.
        </p>
      </motion.div>

      <div className="space-y-4">
        <BudgetGlanceCard />
        <QuickCaptureCard />

        <div className="grid gap-4 lg:grid-cols-2">
          <LatestNotesCard />
          <DueTodayCard />
        </div>

        {isAdmin && <ServiceHealthLine className="pt-1" />}
      </div>
    </div>
  );
}
