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
import type { KanbanReminder } from "@/types/kanban";
import { reminderStatus, toInputValue, zoneLabel, type ReminderStatus } from "@/pages/dashboard/kanban/schedule";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

  const remindersQuery = useQuery({ queryKey: remindersKey, queryFn: fetchKanbanReminders });
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
          save={(v) => createKanbanReminder({ message: v.message, schedule: { kind: "once", at: v.at } })}
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
                    initial={{ message: r.message, at: toInputValue(r.schedule.at) }}
                    submitLabel="Save"
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null);
                      refresh();
                    }}
                    save={(v) =>
                      editKanbanReminder(r.id, {
                        message: v.message,
                        // Only a new moment reschedules (and re-arms) it.
                        ...(v.at !== toInputValue(r.schedule.at) && { schedule: { kind: "once", at: v.at } }),
                      })
                    }
                  />
                ) : (
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{r.message}</p>
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

interface ReminderValues {
  message: string;
  // datetime-local value, read by coreban in the owner's timezone.
  at: string;
}

// fieldOf names the form field a coreban 400 detail is about, if any.
function fieldOf(detail: string): "message" | "at" | null {
  if (detail.startsWith("message")) return "message";
  if (detail.startsWith("schedule.at")) return "at";
  return null;
}

function ReminderForm({
  timezone,
  initial = { message: "", at: "" },
  submitLabel,
  save,
  onSaved,
  onCancel,
}: {
  timezone: string | undefined;
  initial?: ReminderValues;
  submitLabel: string;
  save: (v: ReminderValues) => Promise<KanbanReminder>;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [atMissing, setAtMissing] = useState("");
  const idPrefix = onCancel ? "kanban-edit-reminder" : "kanban-new-reminder";

  const mutation = useMutation({
    mutationFn: save,
    onSuccess: () => {
      if (!onCancel) setValues(initial);
      onSaved();
    },
  });

  const detail = mutation.error instanceof KanbanRequestError ? mutation.error.detail : "";
  const field = fieldOf(detail);
  const messageError = field === "message" ? detail.replace(/^message/, "The message") : "";
  const atError = field === "at" ? detail.replace(/^schedule\.at/, "The time") : atMissing;
  const otherError =
    mutation.error && !field ? detail || (onCancel ? "Couldn't save this reminder." : "Couldn't add this reminder.") : "";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    if (!values.at) {
      setAtMissing("Choose when it should reach you.");
      return;
    }
    setAtMissing("");
    mutation.mutate(values);
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-message`}>{onCancel ? "Message" : "New reminder"}</Label>
        <Textarea
          id={`${idPrefix}-message`}
          value={values.message}
          onChange={(e) => setValues({ ...values, message: e.target.value })}
          aria-invalid={messageError ? true : undefined}
          rows={2}
          className="min-h-11"
          autoFocus={!!onCancel}
        />
        {messageError && <p className="text-sm text-destructive">{messageError}</p>}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-at`}>When</Label>
        <Input
          id={`${idPrefix}-at`}
          type="datetime-local"
          value={values.at}
          onChange={(e) => setValues({ ...values, at: e.target.value })}
          aria-describedby={`${idPrefix}-at-help`}
          aria-invalid={atError ? true : undefined}
          className="min-h-11 font-mono tabular-nums sm:max-w-64"
        />
        <p id={`${idPrefix}-at-help`} className="text-xs leading-relaxed text-muted-foreground">
          {timezone ? `In ${zoneLabel(timezone)}, your Kanban timezone.` : "In your Kanban timezone."}
        </p>
        {atError && <p className="text-sm text-destructive">{atError}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant={onCancel ? "outline" : "default"} className="min-h-11" disabled={mutation.isPending}>
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
