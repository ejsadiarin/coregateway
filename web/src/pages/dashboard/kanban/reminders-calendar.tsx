import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { KanbanReminder } from "@/types/kanban";
import { formatDay } from "@/lib/kanban-schedule";
import { monthGrid, occurrencesInMonth, shiftMonth, type Occurrence } from "@/lib/reminder-calendar";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ReminderRow } from "@/pages/dashboard/kanban/reminder-row";

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
// Column heads, Monday first; screen readers get each day's full name from its cell.
const weekdayHeads = ["M", "T", "W", "T", "F", "S", "S"];

const monthTitle = (month: string) => `${monthNames[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;


// RemindersCalendar shows a month of occurrences: a grid with a mark on
// each day something is sent (or was), and the chosen day's sends below it.
// today is the owner's today (YYYY-MM-DD); newAt is the moment a reminder
// added on a day starts at.
export function RemindersCalendar({
  reminders,
  today,
  newAt,
  onNew,
  onEdit,
  onDelete,
}: {
  reminders: KanbanReminder[];
  today: string;
  newAt: (date: string) => string;
  onNew: (at: string) => void;
  onEdit: (r: KanbanReminder) => void;
  onDelete: (r: KanbanReminder) => void;
}) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const year = Number(today.slice(0, 4));
  const byDay = occurrencesInMonth(reminders, month);
  const chosen = byDay.get(selected) ?? [];

  // Moving months keeps the chosen day in view: today in its own month, else the 1st.
  const goTo = (m: string) => {
    setMonth(m);
    setSelected(m === today.slice(0, 7) ? today : `${m}-01`);
  };

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1">
        <h2 className="flex-1 text-base font-semibold tracking-tight" aria-live="polite">
          {monthTitle(month)}
        </h2>
        <Button variant="ghost" className="min-h-11" disabled={selected === today} onClick={() => goTo(today.slice(0, 7))}>
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Previous month"
          onClick={() => goTo(shiftMonth(month, -1))}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label="Next month"
          onClick={() => goTo(shiftMonth(month, 1))}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1" role="group" aria-label={`Days of ${monthTitle(month)}`}>
        {weekdayHeads.map((d, i) => (
          <div
            key={i}
            aria-hidden
            className="pb-1 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {monthGrid(month).map((date, i) =>
          date ? (
            <DayCell
              key={date}
              date={date}
              occurrences={byDay.get(date) ?? []}
              today={date === today}
              past={date < today}
              selected={date === selected}
              label={formatDay(date, year)}
              onSelect={() => setSelected(date)}
            />
          ) : (
            <div key={`pad-${i}`} aria-hidden />
          ),
        )}
      </div>

      <section aria-labelledby="reminders-day" className="mt-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="reminders-day" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {formatDay(selected, year)}
            {selected === today && " · Today"}
          </h2>
          {/* A past day takes no new reminders: they'd be late as soon as they're made. */}
          {selected >= today && (
            <Button variant="outline" className="min-h-11" onClick={() => onNew(newAt(selected))}>
              <Plus className="h-4 w-4" aria-hidden />
              <span>
                Add<span className="sr-only"> a reminder on {formatDay(selected, year)}</span>
              </span>
            </Button>
          )}
        </div>
        {chosen.length === 0 ? (
          <p className="mt-2 border-y border-border py-6 text-sm text-muted-foreground">
            {selected < today ? "Nothing was sent this day." : "Nothing to send this day."}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {chosen.map((o) => (
              <li key={`${o.reminder.id}-${o.at}-${o.sent}`}>
                <ReminderRow reminder={o.reminder} occurrence={o} onEdit={onEdit} onDelete={onDelete} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayCell({
  date,
  occurrences,
  today,
  past,
  selected,
  label,
  onSelect,
}: {
  date: string;
  occurrences: Occurrence[];
  today: boolean;
  past: boolean;
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  const count = occurrences.length;
  const failed = occurrences.some((o) => o.sent && o.reminder.last_delivery?.error);
  // A day whose sends are all held (paused) or already done reads quieter.
  const quiet = occurrences.every((o) => o.sent || o.reminder.paused);
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${label}${count ? `, ${count} ${count === 1 ? "reminder" : "reminders"}` : ""}`}
      onClick={onSelect}
      className={cn(
        "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg py-1 font-mono text-sm tabular-nums transition-colors hover:bg-muted",
        past && "text-muted-foreground",
        today && "font-semibold text-primary",
        selected && "bg-primary font-semibold text-primary-foreground hover:bg-primary/90",
      )}
    >
      <span aria-hidden>{Number(date.slice(8))}</span>
      <span aria-hidden className="flex h-1.5 items-center gap-0.5">
        {occurrences.slice(0, 3).map((o, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              selected
                ? "bg-primary-foreground"
                : failed
                  ? "bg-destructive"
                  : quiet
                    ? "bg-muted-foreground/60"
                    : "bg-primary",
            )}
          />
        ))}
      </span>
    </button>
  );
}
