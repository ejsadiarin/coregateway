import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BellOff, BellRing, Pencil, Trash2 } from "lucide-react";
import {
  fetchKanbanReminders,
  fetchKanbanSettings,
  createKanbanReminder,
  editKanbanReminder,
  deleteKanbanReminder,
  KanbanRequestError,
} from "@/lib/kanban";
import type { KanbanReminder, KanbanScheduleInput, KanbanWeekday } from "@/types/kanban";
import {
  describeSchedule,
  fieldsOf,
  reminderStatus,
  scheduleOf,
  weekdayNames,
  zoneLabel,
  type ReminderStatus,
  type ScheduleField,
  type ScheduleFields,
} from "@/pages/dashboard/kanban/schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const remindersKey = ["kanban", "reminders"];
const settingsKey = ["kanban", "settings"];

const toneClass: Record<ReminderStatus["tone"], string> = {
  pending: "text-muted-foreground",
  warning: "text-[var(--chart-4)]",
  done: "text-muted-foreground",
  error: "text-destructive",
};

export default function KanbanRemindersPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<KanbanReminder | null>(null);
  const [actionError, setActionError] = useState("");

  const remindersQuery = useQuery({ queryKey: remindersKey, queryFn: () => fetchKanbanReminders() });
  const settingsQuery = useQuery({ queryKey: settingsKey, queryFn: fetchKanbanSettings });
  const refresh = () => queryClient.invalidateQueries({ queryKey: remindersKey });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteKanbanReminder(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError: (err) => {
      setDeleting(null);
      setActionError(err instanceof Error ? err.message : "Couldn't delete this reminder");
    },
  });

  const timezone = settingsQuery.data?.timezone;
  const noTarget = settingsQuery.data !== undefined && settingsQuery.data.ntfy_topic === null;
  const reminders = remindersQuery.data;
  const year = new Date().getFullYear();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <Link
        to="/dashboard/kanban"
        className="inline-flex min-h-11 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" aria-hidden />
        Kanban / Reminders
      </Link>
      <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">Reminders</h1>
      <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        Pushed to your phone through ntfy at the moment you choose.
      </p>

      {noTarget && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-border p-4 text-sm leading-relaxed">
          <BellOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            No notification target yet, so reminders won't be sent.{" "}
            <Link to="/dashboard/kanban/settings" className="underline underline-offset-4 hover:text-primary">
              Set one in Settings
            </Link>
            ; anything that came due meanwhile is then sent once, marked late.
          </span>
        </p>
      )}

      <div className="mt-6">
        <ReminderForm
          timezone={timezone}
          submitLabel="Add"
          onSaved={refresh}
          save={(message, schedule) => createKanbanReminder({ message, schedule })}
        />
      </div>

      {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}

      {remindersQuery.isLoading && (
        <div className="mt-6 divide-y divide-border border-y border-border" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-16 items-center">
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {remindersQuery.error && (
        <div className="mt-6">
          <p className="text-sm text-destructive">Couldn't load reminders.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={() => remindersQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {reminders && reminders.length === 0 && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-border p-6">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            No reminders yet. Add one above, like "Renew the cert" for next Monday at 09:00.
          </p>
        </div>
      )}

      {reminders && reminders.length > 0 && (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {reminders.map((r) => {
            const status = reminderStatus(r, year);
            return (
              <li key={r.id} className="py-3">
                {editingId === r.id ? (
                  <ReminderForm
                    timezone={timezone}
                    initial={r}
                    submitLabel="Save"
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null);
                      refresh();
                    }}
                    save={(message, schedule) => {
                      const before = scheduleOf(fieldsOf(r.schedule));
                      const changed = !("schedule" in before) || JSON.stringify(before.schedule) !== JSON.stringify(schedule);
                      // Only a changed schedule reschedules (and re-arms) it.
                      return editKanbanReminder(r.id, { message, ...(changed && { schedule }) });
                    }}
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{r.message}</p>
                      {r.card && (
                        <Link
                          to={`/dashboard/kanban/${r.card.board_id}`}
                          className="mt-1 inline-flex min-h-11 items-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        >
                          On card: {r.card.title}
                        </Link>
                      )}
                      <p className="mt-1 font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground">
                        {describeSchedule(r.schedule)}
                      </p>
                      <p className={`mt-1 font-mono text-xs tabular-nums ${toneClass[status.tone]}`}>{status.text}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={`Edit reminder: ${r.message}`}
                      onClick={() => {
                        setActionError("");
                        setEditingId(r.id);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-11 min-w-11"
                      aria-label={`Delete reminder: ${r.message}`}
                      onClick={() => {
                        setActionError("");
                        setDeleting(r);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this reminder?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleting?.message}" stops for good. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteMutation.mutate(deleting.id);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// fieldOf names the form field a coreban 400 detail is about, if any.
function fieldOf(detail: string): "message" | ScheduleField | null {
  if (detail.startsWith("message")) return "message";
  const field = /^schedule\.(at|time|weekdays|days|from)\b/.exec(detail)?.[1];
  return (field as ScheduleField | undefined) ?? null;
}

const kindLabels: Record<ScheduleFields["kind"], string> = {
  once: "Once",
  daily: "Daily",
  weekly: "On chosen days",
  every: "Every few days",
};

// ReminderForm adds a reminder, or edits one (initial, with onCancel).
// secondary renders its submit as a secondary action, for a view whose
// primary action is elsewhere (the card editor's Save).
export function ReminderForm({
  timezone,
  initial,
  submitLabel,
  save,
  onSaved,
  onCancel,
  secondary = false,
  messageLabel,
}: {
  timezone: string | undefined;
  initial?: KanbanReminder;
  submitLabel: string;
  save: (message: string, schedule: KanbanScheduleInput) => Promise<KanbanReminder>;
  onSaved: () => void;
  onCancel?: () => void;
  secondary?: boolean;
  messageLabel?: string;
}) {
  const [message, setMessage] = useState(initial?.message ?? "");
  const [fields, setFields] = useState(() => fieldsOf(initial?.schedule));
  const [missing, setMissing] = useState<{ field: ScheduleField; error: string } | null>(null);
  const idPrefix = onCancel ? "kanban-edit-reminder" : "kanban-new-reminder";
  const set = (patch: Partial<ScheduleFields>) => setFields((f) => ({ ...f, ...patch }));

  const mutation = useMutation({
    mutationFn: ({ message, schedule }: { message: string; schedule: KanbanScheduleInput }) => save(message, schedule),
    onSuccess: () => {
      if (!onCancel) {
        setMessage("");
        setFields(fieldsOf());
      }
      onSaved();
    },
  });

  const detail = mutation.error instanceof KanbanRequestError ? mutation.error.detail : "";
  const field = fieldOf(detail);
  // coreban names fields the API's way ("schedule.time …"); say it plainly.
  const plain = detail.replace(/^schedule\.(\w+)/, "This").replace(/^message/, "The message");
  const errorFor = (f: ScheduleField) => (missing?.field === f ? missing.error : field === f ? plain : "");
  const messageError = field === "message" ? plain : "";
  const otherError =
    mutation.error && !field ? detail || (onCancel ? "Couldn't save this reminder." : "Couldn't add this reminder.") : "";
  const zoneNote = timezone ? `In ${zoneLabel(timezone)}, your Kanban timezone.` : "In your Kanban timezone.";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    const read = scheduleOf(fields);
    if (!("schedule" in read)) {
      setMissing(read);
      return;
    }
    setMissing(null);
    mutation.mutate({ message, schedule: read.schedule });
  };

  const fieldError = (f: ScheduleField) => {
    const text = errorFor(f);
    return text && <p className="text-sm text-destructive">{text}</p>;
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-message`}>{messageLabel ?? (onCancel ? "Message" : "New reminder")}</Label>
        <Textarea
          id={`${idPrefix}-message`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={messageError ? true : undefined}
          rows={2}
          className="min-h-11"
          autoFocus={!!onCancel}
        />
        {messageError && <p className="text-sm text-destructive">{messageError}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-kind`}>Repeat</Label>
        <Select value={fields.kind} onValueChange={(v) => set({ kind: v as ScheduleFields["kind"] })}>
          <SelectTrigger id={`${idPrefix}-kind`} className="min-h-11 sm:max-w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(kindLabels) as ScheduleFields["kind"][]).map((k) => (
              <SelectItem key={k} value={k}>
                {kindLabels[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fields.kind === "once" ? (
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-at`}>When</Label>
          <Input
            id={`${idPrefix}-at`}
            type="datetime-local"
            value={fields.at}
            onChange={(e) => set({ at: e.target.value })}
            aria-describedby={`${idPrefix}-zone`}
            aria-invalid={errorFor("at") ? true : undefined}
            className="min-h-11 font-mono tabular-nums sm:max-w-64"
          />
          <p id={`${idPrefix}-zone`} className="text-xs leading-relaxed text-muted-foreground">
            {zoneNote}
          </p>
          {fieldError("at")}
        </div>
      ) : (
        <>
          {fields.kind === "weekly" && (
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">Days</legend>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(weekdayNames) as KanbanWeekday[]).map((d) => {
                  const on = fields.weekdays.includes(d);
                  return (
                    <Button
                      key={d}
                      type="button"
                      variant={on ? "secondary" : "outline"}
                      aria-pressed={on}
                      className="min-h-11 min-w-11 font-mono text-xs"
                      onClick={() =>
                        set({ weekdays: on ? fields.weekdays.filter((x) => x !== d) : [...fields.weekdays, d] })
                      }
                    >
                      {weekdayNames[d]}
                    </Button>
                  );
                })}
              </div>
              {fieldError("weekdays")}
            </fieldset>
          )}
          {fields.kind === "every" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-days`}>Every how many days</Label>
                <Input
                  id={`${idPrefix}-days`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  value={fields.days}
                  onChange={(e) => set({ days: e.target.value })}
                  aria-invalid={errorFor("days") ? true : undefined}
                  className="min-h-11 font-mono tabular-nums"
                />
                {fieldError("days")}
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`${idPrefix}-from`}>Counting from</Label>
                <Input
                  id={`${idPrefix}-from`}
                  type="date"
                  value={fields.from}
                  onChange={(e) => set({ from: e.target.value })}
                  aria-describedby={`${idPrefix}-from-help`}
                  aria-invalid={errorFor("from") ? true : undefined}
                  className="min-h-11 font-mono tabular-nums"
                />
                <p id={`${idPrefix}-from-help`} className="text-xs leading-relaxed text-muted-foreground">
                  Leave empty to start today.
                </p>
                {fieldError("from")}
              </div>
            </div>
          )}
          <div className="grid gap-2">
            <Label htmlFor={`${idPrefix}-time`}>Time of day</Label>
            <Input
              id={`${idPrefix}-time`}
              type="time"
              value={fields.time}
              onChange={(e) => set({ time: e.target.value })}
              aria-describedby={`${idPrefix}-zone`}
              aria-invalid={errorFor("time") ? true : undefined}
              className="min-h-11 font-mono tabular-nums sm:max-w-40"
            />
            <p id={`${idPrefix}-zone`} className="text-xs leading-relaxed text-muted-foreground">
              {zoneNote} Missed while coreban is down, it waits for the next one.
            </p>
            {fieldError("time")}
          </div>
        </>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant={onCancel || secondary ? "outline" : "default"}
          className="min-h-11"
          disabled={mutation.isPending}
        >
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {otherError && <p className="text-sm text-destructive">{otherError}</p>}
      </div>
    </form>
  );
}
