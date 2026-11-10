import { Fragment, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Archive, ArrowLeft, MoreHorizontal, Plus } from "lucide-react";
import {
  fetchKanbanBoard,
  createKanbanCard,
  editKanbanCard,
  moveKanbanCard,
  deleteKanbanCard,
  fetchKanbanArchivedCards,
  fetchKanbanSettings,
  addKanbanColumn,
  editKanbanColumn,
  moveKanbanColumn,
  deleteKanbanColumn,
  KanbanBoardNotFoundError,
  KanbanRequestError,
} from "@/lib/kanban";
import type {
  KanbanBoard,
  KanbanCard,
  KanbanCardEdit,
  KanbanColumn,
  KanbanColumnEdit,
  KanbanDue,
  KanbanStatus,
} from "@/types/kanban";
import { formatDue, isOverdue, toInputValue } from "@/pages/dashboard/kanban/schedule";
import { dropIndex, moveCard } from "@/pages/dashboard/kanban/drop";
import { cn } from "@/lib/utils";
import { markdownProseClass } from "@/lib/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const statusLabel: Record<KanbanStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

const statuses = Object.keys(statusLabel) as KanbanStatus[];

// errorText is what to tell the owner about a failed request: coreban's own
// explanation when it refused one (such as removing a board's last Done
// column), else the error's message.
const errorText = (err: unknown, fallback: string) =>
  err instanceof KanbanRequestError && err.detail ? err.detail : err instanceof Error ? err.message : fallback;

const statusDot: Record<KanbanStatus, string> = {
  todo: "bg-muted-foreground",
  in_progress: "bg-primary",
  done: "bg-[var(--chart-2)]",
};

type Move = { cardId: string; columnId: string; index: number };

// DueLabel is how a card shows its due on the board.
type DueLabel = { text: string; overdue: boolean };
type DropTarget = { columnId: string; index: number };

const cardClass =
  "min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

// clientY of the mouse press or first touch that started a drag.
function pointerY(event: Event): number {
  if ("touches" in event) return (event as TouchEvent).touches[0]?.clientY ?? 0;
  return (event as MouseEvent).clientY;
}

export default function KanbanBoardPage() {
  const { boardId = "" } = useParams();
  const queryClient = useQueryClient();
  const boardKey = ["kanban", "board", boardId];
  const [actionError, setActionError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // The column dialog: adding one ("new"), editing one, or closed.
  const [columnDialog, setColumnDialog] = useState<KanbanColumn | "new" | null>(null);
  const [archivedOpen, setArchivedOpen] = useState(false);
  // The pointer's clientY during a drag. Tracked directly rather than as
  // start + dnd-kit's delta, which also counts any auto-scroll since the drag
  // began and so drifts from the viewport rects the drop slot is measured in.
  const dragPointerY = useRef(0);
  // Each column's card list, measured to find the slot under the pointer.
  const lists = useRef(new Map<string, HTMLElement>());

  // Mouse drags start after 5px of movement, so a click still opens the
  // editor. Touch drags start after a short press-and-hold, so a swipe
  // still scrolls the columns.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const boardQuery = useQuery({
    queryKey: boardKey,
    queryFn: () => fetchKanbanBoard(boardId),
    retry: (count, err) => !(err instanceof KanbanBoardNotFoundError) && count < 3,
  });
  const settingsQuery = useQuery({ queryKey: ["kanban", "settings"], queryFn: fetchKanbanSettings });
  const fail = (fallback: string) => (err: unknown) => setActionError(errorText(err, fallback));

  // A completed card's due is never overdue: the work is finished.
  const year = new Date().getFullYear();
  const dueLabel = (card: KanbanCard): DueLabel | null => {
    if (!card.due) return null;
    const tz = settingsQuery.data?.timezone;
    return {
      text: `Due ${formatDue(card.due, year)}`,
      overdue: card.status !== "done" && tz !== undefined && isOverdue(card.due, new Date(), tz),
    };
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: boardKey });

  // Moves apply to the cached board at once and roll back if coreban refuses.
  const moveMutation = useMutation({
    mutationFn: ({ cardId, columnId, index }: Move) => moveKanbanCard(boardId, cardId, columnId, index),
    onMutate: async ({ cardId, columnId, index }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const prev = queryClient.getQueryData<KanbanBoard>(boardKey);
      if (prev?.columns) {
        queryClient.setQueryData<KanbanBoard>(boardKey, {
          ...prev,
          columns: moveCard(prev.columns, cardId, columnId, index),
        });
      }
      return { prev };
    },
    onError: (err, _move, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(boardKey, ctx.prev);
      fail("Couldn't move this card")(err);
    },
    onSettled: refresh,
  });

  const columns = boardQuery.data?.columns ?? [];

  // Column moves and deletes from a column's menu; refusals show above the board.
  const columnMutation = useMutation({
    mutationFn: async (op: { kind: "move"; column: KanbanColumn; index: number } | { kind: "delete"; column: KanbanColumn }) => {
      if (op.kind === "move") await moveKanbanColumn(boardId, op.column.id, op.index);
      else await deleteKanbanColumn(boardId, op.column.id);
    },
    onMutate: () => setActionError(""),
    onError: fail("Couldn't change this column"),
    onSettled: refresh,
  });

  // requestMove skips drops that leave the card where it already is.
  const requestMove = (move: Move) => {
    if (moveCard(columns, move.cardId, move.columnId, move.index) === columns) return;
    setActionError("");
    moveMutation.mutate(move);
  };

  const editing = columns.flatMap((c) => c.cards ?? []).find((k) => k.id === editingId) ?? null;

  // Alt+arrows move the focused card: up/down within its column, left/right
  // to the neighbouring column at the same height.
  const handleCardKey = (e: React.KeyboardEvent, card: KanbanCard) => {
    if (!e.altKey) return;
    const col = columns.findIndex((c) => c.id === card.column_id);
    const index = (columns[col]?.cards ?? []).findIndex((k) => k.id === card.id);
    const target =
      e.key === "ArrowUp" ? { col, index: index - 1 }
      : e.key === "ArrowDown" ? { col, index: index + 1 }
      : e.key === "ArrowLeft" ? { col: col - 1, index }
      : e.key === "ArrowRight" ? { col: col + 1, index }
      : null;
    if (!target || target.index < 0 || !columns[target.col]) return;
    e.preventDefault();
    requestMove({ cardId: card.id, columnId: columns[target.col].id, index: target.index });
  };

  // Capture on window runs before dnd-kit's own move handling for the same
  // event, so the slot is computed from this move, not the last one.
  useEffect(() => {
    if (!draggingId) return;
    const onMouse = (e: MouseEvent) => {
      dragPointerY.current = e.clientY;
    };
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) dragPointerY.current = e.touches[0].clientY;
    };
    window.addEventListener("mousemove", onMouse, { capture: true });
    window.addEventListener("touchmove", onTouch, { capture: true, passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouse, { capture: true });
      window.removeEventListener("touchmove", onTouch, { capture: true });
    };
  }, [draggingId]);

  const endDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

  // The drop the pointer is over: the column under it, and the slot among
  // that column's cards with the dragged one left out (the index coreban's
  // move takes).
  const dropTargetOf = (e: DragMoveEvent | DragEndEvent): DropTarget | null => {
    if (!e.over) return null;
    const columnId = String(e.over.id);
    const mids = Array.from(lists.current.get(columnId)?.querySelectorAll<HTMLElement>("[data-card-id]") ?? [])
      .filter((el) => el.dataset.cardId !== e.active.id)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });
    return { columnId, index: dropIndex(mids, dragPointerY.current) };
  };

  const handleDragStart = (e: DragStartEvent) => {
    dragPointerY.current = pointerY(e.activatorEvent);
    setActionError("");
    setDraggingId(String(e.active.id));
  };

  const handleDragMove = (e: DragMoveEvent) => {
    const next = dropTargetOf(e);
    setDropTarget((t) => (t?.columnId === next?.columnId && t?.index === next?.index ? t : next));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const target = dropTargetOf(e);
    if (target) requestMove({ cardId: String(e.active.id), ...target });
    endDrag();
  };

  const cardTitle = (id: UniqueIdentifier) =>
    columns.flatMap((c) => c.cards ?? []).find((k) => k.id === id)?.title ?? "card";
  const columnName = (id: UniqueIdentifier) => columns.find((c) => c.id === id)?.name ?? "column";
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${cardTitle(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${cardTitle(active.id)} is over ${columnName(over.id)}.`
        : `${cardTitle(active.id)} is not over a column.`,
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${cardTitle(active.id)} in ${columnName(over.id)}.` : `Dropped ${cardTitle(active.id)}.`,
    onDragCancel: ({ active }) => `Stopped moving ${cardTitle(active.id)}.`,
  };
  const draggingCard = draggingId ? columns.flatMap((c) => c.cards ?? []).find((k) => k.id === draggingId) : undefined;

  if (boardQuery.error instanceof KanbanBoardNotFoundError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
        <p className="text-sm text-muted-foreground">{boardQuery.error.message}.</p>
        <Button asChild variant="outline" className="mt-3 min-h-11">
          <Link to="/dashboard/kanban">Back to boards</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col py-6">
      <div className="px-4 md:px-6">
        <Link
          to="/dashboard/kanban"
          className="inline-flex min-h-11 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          Kanban / Boards
        </Link>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">
            {boardQuery.data?.name ?? <span className="inline-block h-8 w-48 animate-pulse rounded bg-muted" />}
          </h1>
          <Button variant="ghost" className="min-h-11" onClick={() => setArchivedOpen(true)}>
            <Archive className="h-4 w-4" aria-hidden />
            Archived
          </Button>
        </div>
        <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
          Drag cards between columns to change their status, or up and down to set priority. On
          touch, press and hold a card to pick it up.
          <span className="hidden md:inline"> With a card focused, Alt + arrow keys move it.</span>
        </p>
        {columns.length > 0 && (
          <NewCardForm boardId={boardId} columns={columns} onCreated={refresh} onError={fail} />
        )}
        {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}
      </div>

      {boardQuery.error && !(boardQuery.error instanceof KanbanBoardNotFoundError) && (
        <div className="mt-6 px-4 md:px-6">
          <p className="text-sm text-destructive">Couldn't load this board.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={() => boardQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={endDrag}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: "Open the card to edit it. Alt + arrow keys move it between and within columns.",
          },
        }}
      >
        <div className="mt-6 flex min-h-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:snap-none md:px-6">
          {boardQuery.isLoading &&
            [0, 1, 2].map((i) => (
              <div key={i} className="h-64 w-[85vw] max-w-80 shrink-0 animate-pulse rounded-xl bg-muted md:w-72" aria-busy="true" />
            ))}
          {columns.map((column, i) => (
            <ColumnView
              key={column.id}
              column={column}
              draggingId={draggingId}
              dropIndexHere={dropTarget?.columnId === column.id ? dropTarget.index : null}
              listRef={(el) => {
                if (el) lists.current.set(column.id, el);
                else lists.current.delete(column.id);
              }}
              onOpenCard={setEditingId}
              onCardKey={handleCardKey}
              dueLabel={dueLabel}
              menu={
                <ColumnMenu
                  column={column}
                  index={i}
                  count={columns.length}
                  onEdit={() => {
                    setActionError("");
                    setColumnDialog(column);
                  }}
                  onMove={(index) => columnMutation.mutate({ kind: "move", column, index })}
                  onDelete={() => columnMutation.mutate({ kind: "delete", column })}
                />
              }
            />
          ))}
          {columns.length > 0 && (
            <Button
              variant="outline"
              className="min-h-11 shrink-0 snap-start self-start border-dashed"
              onClick={() => {
                setActionError("");
                setColumnDialog("new");
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add column
            </Button>
          )}
        </div>
        {/* No drop animation: the optimistic move already shows the card in its new place. */}
        <DragOverlay dropAnimation={null}>
          {draggingCard && (
            <div className={cn(cardClass, "cursor-grabbing ring-2 ring-ring")}>
              <span className="line-clamp-3 break-words">{draggingCard.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ArchivedDialog
        boardId={boardId}
        open={archivedOpen}
        columns={columns}
        onClose={() => setArchivedOpen(false)}
        onChanged={refresh}
      />

      <ColumnDialog
        key={columnDialog === "new" ? "new" : (columnDialog?.id ?? "none")}
        boardId={boardId}
        column={columnDialog}
        onClose={() => setColumnDialog(null)}
        onSaved={refresh}
      />

      <CardEditor
        key={editing?.id ?? "none"}
        boardId={boardId}
        card={editing}
        columns={columns}
        onClose={() => setEditingId(null)}
        onSaved={refresh}
        onMove={(columnId) =>
          editing && requestMove({ cardId: editing.id, columnId, index: Number.MAX_SAFE_INTEGER })
        }
      />
    </div>
  );
}

function ColumnView({
  column,
  draggingId,
  dropIndexHere,
  listRef,
  onOpenCard,
  onCardKey,
  dueLabel,
  menu,
}: {
  column: KanbanColumn;
  draggingId: string | null;
  dropIndexHere: number | null;
  listRef: (el: HTMLOListElement | null) => void;
  onOpenCard: (id: string) => void;
  onCardKey: (e: React.KeyboardEvent, card: KanbanCard) => void;
  dueLabel: (card: KanbanCard) => DueLabel | null;
  menu: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const cards = column.cards ?? [];
  const indicator = <li aria-hidden className="h-0.5 rounded-full bg-primary" />;
  let slot = 0;

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.name} (${statusLabel[column.status]})`}
      className="flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/30 md:w-72"
    >
      <header className="flex items-center gap-2 pb-1 pl-3 pr-1 pt-1">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDot[column.status])} aria-hidden />
        <h2 className="flex-1 truncate text-sm font-semibold">{column.name}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {statusLabel[column.status]} · <span className="tabular-nums">{cards.length}</span>
        </span>
        {menu}
      </header>

      <ol ref={listRef} className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.map((card) => {
          const dragged = card.id === draggingId;
          const before = !dragged && dropIndexHere === slot ? indicator : null;
          if (!dragged) slot++;
          return (
            <Fragment key={card.id}>
              {before}
              <CardItem card={card} due={dueLabel(card)} dragged={dragged} onOpen={onOpenCard} onKey={onCardKey} />
            </Fragment>
          );
        })}
        {dropIndexHere !== null && dropIndexHere >= slot && indicator}
      </ol>
    </section>
  );
}

function CardItem({
  card,
  due,
  dragged,
  onOpen,
  onKey,
}: {
  card: KanbanCard;
  due: DueLabel | null;
  dragged: boolean;
  onOpen: (id: string) => void;
  onKey: (e: React.KeyboardEvent, card: KanbanCard) => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: card.id });
  return (
    <li data-card-id={card.id}>
      <button
        ref={setNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        onClick={() => onOpen(card.id)}
        onKeyDown={(e) => onKey(e, card)}
        aria-label={`${card.title}, ${statusLabel[card.status]}${due ? `, ${due.text}${due.overdue ? ", overdue" : ""}` : ""}`}
        className={cn(
          cardClass,
          "cursor-grab select-none transition-opacity [-webkit-touch-callout:none] hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          dragged && "opacity-40",
        )}
      >
        <span className="line-clamp-3 break-words">{card.title}</span>
        {(due || card.description.trim() !== "") && (
          <span className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {due && <span className={cn("tabular-nums", due.overdue && "text-destructive")}>{due.text}</span>}
            {card.description.trim() !== "" && <span>Notes</span>}
          </span>
        )}
      </button>
    </li>
  );
}

// NewCardForm is the board's one create action: a title and the column the
// card starts in (the first column by default).
function NewCardForm({
  boardId,
  columns,
  onCreated,
  onError,
}: {
  boardId: string;
  columns: KanbanColumn[];
  onCreated: () => void;
  onError: (fallback: string) => (err: unknown) => void;
}) {
  const [title, setTitle] = useState("");
  const [chosenColumnId, setColumnId] = useState("");
  const [missingTitle, setMissingTitle] = useState(false);
  // The first column until one is chosen, or if the chosen one is gone.
  const columnId = columns.some((c) => c.id === chosenColumnId) ? chosenColumnId : columns[0].id;
  const createMutation = useMutation({
    mutationFn: (t: string) => createKanbanCard(boardId, columnId, t),
    onSuccess: () => {
      setTitle("");
      onCreated();
    },
    onError: onError("Couldn't create this card"),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (createMutation.isPending) return;
    setMissingTitle(!t);
    if (t) createMutation.mutate(t);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-6 grid max-w-3xl gap-2">
      <Label htmlFor="kanban-new-card">New card</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id="kanban-new-card"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={missingTitle || undefined}
          className="min-h-11 flex-1"
        />
        <div className="flex gap-2">
          <Select value={columnId} onValueChange={setColumnId}>
            <SelectTrigger aria-label="Column for the new card" className="min-h-11 flex-1 sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {columns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {statusLabel[c.status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={createMutation.isPending} className="min-h-11">
            <Plus className="h-4 w-4" />
            Create
          </Button>
        </div>
      </div>
      {missingTitle && <p className="text-sm text-destructive">Give the card a title first.</p>}
    </form>
  );
}

function CardEditor({
  boardId,
  card,
  columns,
  onClose,
  onSaved,
  onMove,
}: {
  boardId: string;
  card: KanbanCard | null;
  columns: KanbanColumn[];
  onClose: () => void;
  onSaved: () => void;
  onMove: (columnId: string) => void;
}) {
  const [title, setTitle] = useState(card?.title ?? "");
  const [description, setDescription] = useState(card?.description ?? "");
  const initialDue = dueFields(card?.due ?? null);
  const [dueKind, setDueKind] = useState(initialDue.kind);
  const [dueValue, setDueValue] = useState(initialDue.value);
  const [dueError, setDueError] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = () => {
    onSaved();
    onClose();
  };
  const saveMutation = useMutation({
    mutationFn: (edit: KanbanCardEdit) => editKanbanCard(boardId, card!.id, edit),
    onSuccess: done,
    onError: (err) => setError(errorText(err, "Couldn't save this card")),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteKanbanCard(boardId, card!.id),
    onSuccess: done,
    onError: (err) => {
      setConfirmDelete(false);
      setError(errorText(err, "Couldn't delete this card"));
    },
  });

  // pendingEdit is what the form changed, or null (with the problem shown)
  // when it can't be saved as it stands.
  const pendingEdit = (): KanbanCardEdit | null => {
    if (!card) return null;
    const t = title.trim();
    setError(t ? "" : "A card needs a title.");
    setDueError(
      dueKind === "none" || dueValue ? "" : dueKind === "date" ? "Pick a day, or choose No due." : "Pick a day and time, or choose No due.",
    );
    if (!t || (dueKind !== "none" && !dueValue)) return null;
    const edit: KanbanCardEdit = {};
    if (t !== card.title) edit.title = t;
    if (description !== card.description) edit.description = description;
    if (dueKind !== initialDue.kind || dueValue !== initialDue.value) {
      edit.due = dueKind === "none" ? null : dueKind === "date" ? { date: dueValue } : { at: dueValue };
    }
    return edit;
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveMutation.isPending) return;
    const edit = pendingEdit();
    if (!edit) return;
    if (Object.keys(edit).length === 0) {
      onClose();
      return;
    }
    saveMutation.mutate(edit);
  };

  // Archiving keeps any edits made in the form.
  const handleArchive = () => {
    if (saveMutation.isPending) return;
    const edit = pendingEdit();
    if (edit) saveMutation.mutate({ ...edit, archived: true });
  };

  return (
    <Dialog open={card !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSave} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit card</DialogTitle>
            <DialogDescription>
              Status: {card ? statusLabel[card.status] : ""}, from its column.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor="kanban-card-title">Title</Label>
            <Input
              id="kanban-card-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-11"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="kanban-card-column">Column</Label>
            <Select value={card?.column_id} onValueChange={onMove}>
              <SelectTrigger id="kanban-card-column" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} · {statusLabel[c.status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="kanban-card-due-kind">Due</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={dueKind}
                onValueChange={(v) => {
                  const kind = v as DueKind;
                  // Keep the day already picked; a new time starts at 09:00.
                  const day = dueValue.slice(0, 10);
                  setDueValue(kind === "date" ? day : kind === "at" && day ? `${day}T${dueValue.slice(11, 16) || "09:00"}` : "");
                  setDueKind(kind);
                  setDueError("");
                }}
              >
                <SelectTrigger id="kanban-card-due-kind" className="min-h-11 sm:w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No due</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="at">Date and time</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {dueKind !== "none" && (
              <div className="grid gap-2">
                <Label htmlFor="kanban-card-due-value" className="text-xs text-muted-foreground">
                  {dueKind === "date" ? "Day" : "Day and time, in your Kanban timezone"}
                </Label>
                <Input
                  id="kanban-card-due-value"
                  type={dueKind === "date" ? "date" : "datetime-local"}
                  value={dueValue}
                  onChange={(e) => setDueValue(e.target.value)}
                  aria-invalid={dueError ? true : undefined}
                  className="min-h-11 font-mono tabular-nums sm:max-w-64"
                />
              </div>
            )}
            {dueError && <p className="text-sm text-destructive">{dueError}</p>}
          </div>

          <Tabs defaultValue="write" className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="kanban-card-description">Description</Label>
              <TabsList>
                <TabsTrigger value="write">Write</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="write" className="mt-0">
              <Textarea
                id="kanban-card-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Markdown: notes, links, `commands`…"
                spellCheck={false}
                className="min-h-48 font-mono text-xs leading-relaxed"
              />
            </TabsContent>
            <TabsContent value="preview" className="mt-0">
              <div className={cn("min-h-48 rounded-md border border-border p-3", markdownProseClass)}>
                {description.trim() === "" ? (
                  <p className="text-xs text-muted-foreground">Nothing to preview yet.</p>
                ) : (
                  <ReactMarkdown>{description}</ReactMarkdown>
                )}
              </div>
            </TabsContent>
          </Tabs>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={saveMutation.isPending}
                onClick={handleArchive}
              >
                Archive
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={saveMutation.isPending}>
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
      <ConfirmDeleteCard
        card={confirmDelete ? card : null}
        pending={deleteMutation.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMutation.mutate()}
      />
    </Dialog>
  );
}

type DueKind = "none" | "date" | "at";

// dueFields splits a due into the editor's kind and input value.
function dueFields(due: KanbanDue | null): { kind: DueKind; value: string } {
  if (!due) return { kind: "none", value: "" };
  return "at" in due ? { kind: "at", value: toInputValue(due.at) } : { kind: "date", value: due.date };
}

function ConfirmDeleteCard({
  card,
  pending,
  onCancel,
  onConfirm,
}: {
  card: KanbanCard | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={card !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this card?</AlertDialogTitle>
          <AlertDialogDescription>
            "{card?.title}" is removed for good. To hide it but keep it, archive it instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ArchivedDialog lists the board's archived cards to restore or delete.
function ArchivedDialog({
  boardId,
  open,
  columns,
  onClose,
  onChanged,
}: {
  boardId: string;
  open: boolean;
  columns: KanbanColumn[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const archivedKey = ["kanban", "board", boardId, "archived"];
  const [deleting, setDeleting] = useState<KanbanCard | null>(null);
  const [error, setError] = useState("");
  const archivedQuery = useQuery({
    queryKey: archivedKey,
    queryFn: () => fetchKanbanArchivedCards(boardId),
    enabled: open,
  });
  const changed = () => {
    queryClient.invalidateQueries({ queryKey: archivedKey });
    onChanged();
  };
  const restoreMutation = useMutation({
    mutationFn: (id: string) => editKanbanCard(boardId, id, { archived: false }),
    onMutate: () => setError(""),
    onSuccess: changed,
    onError: (err) => setError(errorText(err, "Couldn't restore this card")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteKanbanCard(boardId, id),
    onMutate: () => setError(""),
    onSuccess: changed,
    onError: (err) => setError(errorText(err, "Couldn't delete this card")),
    onSettled: () => setDeleting(null),
  });
  const columnName = (id: string) => columns.find((c) => c.id === id)?.name ?? "";
  const cards = archivedQuery.data;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Archived cards</DialogTitle>
          <DialogDescription>Hidden from the board but kept. Restoring puts a card at the bottom of its column.</DialogDescription>
        </DialogHeader>
        {archivedQuery.isLoading && <div className="h-14 animate-pulse rounded bg-muted" aria-busy="true" />}
        {archivedQuery.error && <p className="text-sm text-destructive">Couldn't load archived cards.</p>}
        {cards && cards.length === 0 && (
          <p className="text-sm leading-relaxed text-muted-foreground">Nothing archived. Archive a card from its editor.</p>
        )}
        {cards && cards.length > 0 && (
          <ul className="divide-y divide-border border-y border-border">
            {cards.map((k) => (
              <li key={k.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{k.title}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {columnName(k.column_id)} · {statusLabel[k.status]}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={restoreMutation.isPending}
                  onClick={() => restoreMutation.mutate(k.id)}
                >
                  Restore
                </Button>
                <Button
                  variant="ghost"
                  className="min-h-11 text-destructive hover:text-destructive"
                  onClick={() => setDeleting(k)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
      <ConfirmDeleteCard
        card={deleting}
        pending={deleteMutation.isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
      />
    </Dialog>
  );
}

// ColumnMenu holds a column's actions. Refusals (a column still holding
// cards, a board's last column of a status) come back from coreban.
function ColumnMenu({
  column,
  index,
  count,
  onEdit,
  onMove,
  onDelete,
}: {
  column: KanbanColumn;
  index: number;
  count: number;
  onEdit: () => void;
  onMove: (index: number) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label={`${column.name} column actions`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={onEdit}>
          Edit column
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" disabled={index === 0} onSelect={() => onMove(index - 1)}>
          Move left
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" disabled={index === count - 1} onSelect={() => onMove(index + 1)}>
          Move right
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive" onSelect={onDelete}>
          Delete column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ColumnDialog adds a column ("new") or renames one and changes its status.
function ColumnDialog({
  boardId,
  column,
  onClose,
  onSaved,
}: {
  boardId: string;
  column: KanbanColumn | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = column === "new" ? null : column;
  const [name, setName] = useState(existing?.name ?? "");
  const [status, setStatus] = useState<KanbanStatus>(existing?.status ?? "in_progress");
  const [nameError, setNameError] = useState("");
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: (edit: KanbanColumnEdit) =>
      existing
        ? editKanbanColumn(boardId, existing.id, edit)
        : addKanbanColumn(boardId, { name: edit.name!, status: edit.status! }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => setError(errorText(err, "Couldn't save this column")),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (saveMutation.isPending) return;
    const n = name.trim();
    setNameError(n ? "" : "A column needs a name.");
    if (!n) return;
    // Adding sends both; editing sends only what changed.
    const edit: KanbanColumnEdit = {};
    if (n !== existing?.name) edit.name = n;
    if (status !== existing?.status) edit.status = status;
    if (Object.keys(edit).length === 0) {
      onClose();
      return;
    }
    setError("");
    saveMutation.mutate(edit);
  };

  return (
    <Dialog open={column !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSave} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{existing ? "Edit column" : "Add column"}</DialogTitle>
            <DialogDescription>
              A column's status is its cards' status. Every board keeps at least one Todo, In progress, and Done
              column.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="kanban-column-name">Name</Label>
            <Input
              id="kanban-column-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={nameError ? true : undefined}
              className="min-h-11"
            />
            {nameError && <p className="text-sm text-destructive">{nameError}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="kanban-column-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as KanbanStatus)}>
              <SelectTrigger id="kanban-column-status" className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((st) => (
                  <SelectItem key={st} value={st}>
                    {statusLabel[st]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* coreban's refusals here are about the status: the board's last column of one. */}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={saveMutation.isPending}>
              {existing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
