import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  createKanbanCard,
  createKanbanReminder,
  editKanbanReminder,
  fetchKanbanBoard,
  fetchKanbanBoards,
  fetchKanbanSettings,
  KanbanRequestError,
  type FeedNote,
} from "@/lib/kanban";
import type { KanbanReminder } from "@/types/kanban";
import { ReminderForm } from "@/pages/dashboard/kanban/reminders";
import { reminderEdit } from "@/pages/dashboard/kanban/schedule";
import { columnOption } from "@/pages/dashboard/kanban/columns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// What the reminder dialog is doing: capturing a new reminder from the
// Feed (pre-filled with text, linked to note), or editing a linked one.
export type ReminderDialogState =
  | { mode: "new"; text: string; note: FeedNote }
  | { mode: "edit"; reminder: KanbanReminder };

export function ReminderDialog({
  state,
  onClose,
  onSaved,
}: {
  state: ReminderDialogState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const settingsQuery = useQuery({ queryKey: ["kanban", "settings"], queryFn: fetchKanbanSettings });
  const timezone = settingsQuery.data?.timezone;
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{state?.mode === "edit" ? "Edit reminder" : "New reminder"}</DialogTitle>
          <DialogDescription>
            {state?.mode === "edit"
              ? "Changes show on the Reminders page too."
              : "Saved to your reminders, with a note in the Feed that shows it."}
          </DialogDescription>
        </DialogHeader>
        {state?.mode === "new" && (
          <ReminderForm
            timezone={timezone}
            initialMessage={state.text}
            messageLabel="Message"
            submitLabel="Save"
            onCancel={onClose}
            onSaved={onSaved}
            save={(message, schedule) => createKanbanReminder({ message, schedule, note: state.note })}
          />
        )}
        {state?.mode === "edit" && (
          <ReminderForm
            timezone={timezone}
            initial={state.reminder}
            submitLabel="Save"
            onCancel={onClose}
            onSaved={onSaved}
            save={(message, schedule) =>
              editKanbanReminder(state.reminder.id, reminderEdit(state.reminder.schedule, message, schedule))
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// What the card dialog captures: a new card titled from text, linked to note.
export type CardDialogState = { text: string; note: FeedNote };

export function CardDialog({
  state,
  onClose,
  onSaved,
}: {
  state: CardDialogState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New card</DialogTitle>
          <DialogDescription>Added to a board, with a note in the Feed that shows it.</DialogDescription>
        </DialogHeader>
        {state && <CardForm key={state.note} state={state} onCancel={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({ state, onCancel, onSaved }: { state: CardDialogState; onCancel: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(state.text);
  const [chosenBoard, setBoardId] = useState("");
  const [chosenColumn, setColumnId] = useState("");
  const [missingTitle, setMissingTitle] = useState(false);

  const boardsQuery = useQuery({ queryKey: ["kanban", "boards"], queryFn: fetchKanbanBoards });
  const boards = boardsQuery.data ?? [];
  const boardId = chosenBoard || boards[0]?.id || "";
  const boardQuery = useQuery({
    queryKey: ["kanban", "board", boardId],
    queryFn: () => fetchKanbanBoard(boardId),
    enabled: boardId !== "",
  });
  const columns = boardQuery.data?.columns ?? [];
  const columnId = columns.some((c) => c.id === chosenColumn) ? chosenColumn : (columns[0]?.id ?? "");

  const mutation = useMutation({
    mutationFn: () => createKanbanCard(boardId, columnId, title.trim(), state.note),
    onSuccess: onSaved,
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    if (!title.trim()) {
      setMissingTitle(true);
      return;
    }
    setMissingTitle(false);
    mutation.mutate();
  };

  if (boardsQuery.isSuccess && boards.length === 0) {
    return (
      <div className="grid gap-3">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cards live on a board, and you have none yet. Make a board first, then capture the card here.
        </p>
        <Button asChild variant="outline" className="min-h-11 justify-self-start">
          <Link to="/dashboard/kanban">
            <Plus className="h-4 w-4" aria-hidden />
            Make a board
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="feed-card-title">Title</Label>
        <Input
          id="feed-card-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={missingTitle || undefined}
          className="min-h-11"
          autoFocus
        />
        {missingTitle && <p className="text-sm text-destructive">Give the card a title first.</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="feed-card-board">Board</Label>
          <Select value={boardId} onValueChange={setBoardId} disabled={boards.length === 0}>
            <SelectTrigger id="feed-card-board" className="min-h-11">
              <SelectValue placeholder="Loading boards…" />
            </SelectTrigger>
            <SelectContent>
              {boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="feed-card-column">Column</Label>
          <Select value={columnId} onValueChange={setColumnId} disabled={columns.length === 0}>
            <SelectTrigger id="feed-card-column" className="min-h-11">
              <SelectValue placeholder="Loading columns…" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {columnOption(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {(boardsQuery.error || boardQuery.error) && (
        <p className="text-sm text-destructive">Couldn't load your boards. Close this and try again.</p>
      )}
      {mutation.error && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof KanbanRequestError && mutation.error.detail
            ? mutation.error.detail
            : "Couldn't add this card."}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="min-h-11" disabled={mutation.isPending || !columnId}>
          Save
        </Button>
      </div>
    </form>
  );
}
