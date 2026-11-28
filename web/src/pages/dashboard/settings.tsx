import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, useTheme } from "@/lib/theme";
import { revealTheme } from "@/lib/theme-reveal";
import { ReminderSettings } from "@/pages/dashboard/kanban/settings";
import { BudgetSettings } from "@/pages/dashboard/budget/settings";
import { DataSettings } from "@/pages/dashboard/data-settings";
import { NeedsConnection } from "@/components/layout/needs-connection";
import { useOnline } from "@/hooks/use-online";

// The sections of the one Settings page, in page order. Each service's own
// settings live in its section; Draw and Services have none to set.
const SECTIONS = [
  { id: "reminders", label: "Reminders" },
  { id: "budget", label: "Budget" },
  { id: "data", label: "Data" },
  { id: "appearance", label: "Appearance" },
] as const;

export default function SettingsPage() {
  const { hash } = useLocation();
  // Settings are read and saved on the server: offline only the device's
  // own appearance can change (ADR-0009 decision 7).
  const online = useOnline();
  const offline = (what: string) => <NeedsConnection what={what} className="flex flex-col items-start gap-3" />;

  // A link to a section (#budget, or an old settings URL redirected here)
  // lands on it once the page has laid out.
  useEffect(() => {
    const id = hash.slice(1);
    if (!id) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [hash]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6">
      <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">Settings</h1>
      <nav aria-label="Settings sections" className="mt-4 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border border-border px-3.5 text-sm hover:bg-foreground/5",
              hash === `#${s.id}` && "bg-foreground font-semibold text-background hover:bg-foreground",
            )}
          >
            {s.label}
          </a>
        ))}
      </nav>

      <Section id="reminders" title="Reminders" blurb="Where Kanban reminders are pushed, and the timezone every service reads your times in.">
        {online ? <ReminderSettings /> : offline("Reminder settings")}
      </Section>
      <Section id="budget" title="Budget" blurb="The fixed category lists, and your tags.">
        {online ? <BudgetSettings /> : offline("Budget settings")}
      </Section>
      <Section id="data" title="Data" blurb="Export your data as one file, and import an export back. Imports keep every record's id, so nothing is doubled.">
        {online ? <DataSettings /> : offline("Export and import")}
      </Section>
      <Section id="appearance" title="Appearance" blurb="The color scheme on this device.">
        <ThemePicker />
      </Section>
    </div>
  );
}

function Section({ id, title, blurb, children }: { id: string; title: string; blurb: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-10 scroll-mt-20 border-t border-border pt-6">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mb-6 mt-1 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{blurb}</p>
      {children}
    </section>
  );
}

function ThemePicker() {
  const [theme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Color scheme" className="grid gap-2 sm:grid-cols-2">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          // The new theme spreads out from the option picked.
          onClick={(e) => revealTheme(t.id, e.currentTarget)}
          className={cn(
            "flex min-h-14 items-center gap-3 rounded-xl border px-3.5 text-left transition-colors hover:bg-foreground/5",
            theme === t.id ? "border-foreground" : "border-border",
          )}
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border" style={{ background: t.swatches[0] }}>
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.swatches[1] }} />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">{t.label}</span>
            <span className="truncate text-xs text-muted-foreground">{t.blurb}</span>
          </span>
          {theme === t.id && <Check className="ml-auto h-4 w-4 shrink-0" aria-hidden />}
        </button>
      ))}
    </div>
  );
}
