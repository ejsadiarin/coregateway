import { Link } from "react-router-dom";
import { Pencil, Trash2 } from "lucide-react";
import type { KanbanReminder } from "@/types/kanban";
import { describeSchedule, formatWall, reminderNote, reminderWhen, type ReminderStatus } from "@/lib/kanban-schedule";
import { occurrenceNote, type Occurrence } from "@/lib/reminder-calendar";
import { Button } from "@/components/ui/button";

const toneClass: Record<ReminderStatus["tone"], string> = {
  pending: "text-muted-foreground",
  warning: "text-[var(--chart-4)]",
  done: "text-muted-foreground",
  error: "text-destructive",
};

// ReminderRow is one reminder in a list: when it next reaches the owner (or
// last did, or the calendar's occurrence) first, then its message, card,
// schedule, and any status worth saying beyond that time (paused, late,
// couldn't send).
export function ReminderRow({
  reminder: r,
  occurrence,
  onEdit,
  onDelete,
}: {
  reminder: KanbanReminder;
  occurrence?: Occurrence;
  onEdit: (r: KanbanReminder) => void;
  onDelete: (r: KanbanReminder) => void;
}) {
  const year = new Date().getFullYear();
  const when = occurrence ? occurrence.at : reminderWhen(r);
  const note = occurrence ? occurrenceNote(occurrence) : reminderNote(r);
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-xs tabular-nums text-muted-foreground">{when ? formatWall(when, year) : "Not sent"}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{r.message}</p>
        {r.card && (
          <Link
            to={`/dashboard/kanban/${r.card.board_id}?card=${r.card.id}`}
            className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            On card: {r.card.title}
          </Link>
        )}
        <p className="mt-1 font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground">
          {describeSchedule(r.schedule)}
        </p>
        {note && <p className={`mt-1 font-mono text-xs ${toneClass[note.tone]}`}>{note.text}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="min-h-11 min-w-11"
        aria-label={`Edit reminder: ${r.message}`}
        onClick={() => onEdit(r)}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="min-h-11 min-w-11"
        aria-label={`Delete reminder: ${r.message}`}
        onClick={() => onDelete(r)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
