import { Fragment, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, Plus } from "lucide-react";
import {
  fetchKanbanBoard,
  createKanbanCard,
  editKanbanCard,
  moveKanbanCard,
  KanbanBoardNotFoundError,
} from "@/lib/kanban";
import type { KanbanBoard, KanbanCard, KanbanCardEdit, KanbanColumn, KanbanStatus } from "@/types/kanban";
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

const statusLabel: Record<KanbanStatus, string> = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};

const statusDot: Record<KanbanStatus, string> = {
  todo: "bg-muted-foreground",
  in_progress: "bg-primary",
  done: "bg-[var(--chart-2)]",
};

type Move = { cardId: string; columnId: string; index: number };
type DropTarget = { columnId: string; index: number };

export default function KanbanBoardPage() {
  const { boardId = "" } = useParams();
  const queryClient = useQueryClient();
  const boardKey = ["kanban", "board", boardId];
  const [actionError, setActionError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const boardQuery = useQuery({
    queryKey: boardKey,
    queryFn: () => fetchKanbanBoard(boardId),
    retry: (count, err) => !(err instanceof KanbanBoardNotFoundError) && count < 3,
  });
  const fail = (fallback: string) => (err: unknown) =>
    setActionError(err instanceof Error ? err.message : fallback);
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

  const endDrag = () => {
    setDraggingId(null);
    setDropTarget(null);
  };

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
        <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">
          {boardQuery.data?.name ?? <span className="inline-block h-8 w-48 animate-pulse rounded bg-muted" />}
        </h1>
        <p className="mt-2 hidden max-w-[65ch] text-sm leading-relaxed text-muted-foreground md:block">
          Drag cards between columns to change their status, or up and down to set priority. With a
          card focused, Alt + arrow keys move it.
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

      <div className="mt-6 flex min-h-0 flex-1 snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4 md:snap-none md:px-6">
        {boardQuery.isLoading &&
          [0, 1, 2].map((i) => (
            <div key={i} className="h-64 w-[85vw] max-w-80 shrink-0 animate-pulse rounded-xl bg-muted md:w-72" aria-busy="true" />
          ))}
        {columns.map((column) => (
          <ColumnView
            key={column.id}
            column={column}
            draggingId={draggingId}
            dropIndexHere={dropTarget?.columnId === column.id ? dropTarget.index : null}
            onDragStartCard={setDraggingId}
            onDragEndCard={endDrag}
            onDragOverIndex={(index) => setDropTarget({ columnId: column.id, index })}
            onDragLeaveColumn={() =>
              setDropTarget((t) => (t?.columnId === column.id ? null : t))
            }
            onDrop={(index) => {
              if (draggingId) requestMove({ cardId: draggingId, columnId: column.id, index });
              endDrag();
            }}
            onOpenCard={setEditingId}
            onCardKey={handleCardKey}
          />
        ))}
      </div>

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
  onDragStartCard,
  onDragEndCard,
  onDragOverIndex,
  onDragLeaveColumn,
  onDrop,
  onOpenCard,
  onCardKey,
}: {
  column: KanbanColumn;
  draggingId: string | null;
  dropIndexHere: number | null;
  onDragStartCard: (id: string) => void;
  onDragEndCard: () => void;
  onDragOverIndex: (index: number) => void;
  onDragLeaveColumn: () => void;
  onDrop: (index: number) => void;
  onOpenCard: (id: string) => void;
  onCardKey: (e: React.KeyboardEvent, card: KanbanCard) => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const cards = column.cards ?? [];

  // The slot under the pointer among this column's cards, the dragged one
  // left out (the index coreban's move takes).
  const indexAt = (clientY: number) => {
    const els = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []);
    const mids = els
      .filter((el) => el.dataset.cardId !== draggingId)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      });
    return dropIndex(mids, clientY);
  };

  const indicator = <li aria-hidden className="h-0.5 rounded-full bg-primary" />;
  let slot = 0;

  return (
    <section
      aria-label={`${column.name} (${statusLabel[column.status]})`}
      className="flex w-[85vw] max-w-80 shrink-0 snap-start flex-col rounded-xl border border-border bg-muted/30 md:w-72"
      onDragOver={(e) => {
        if (!draggingId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const index = indexAt(e.clientY);
        if (index !== dropIndexHere) onDragOverIndex(index);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragLeaveColumn();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(indexAt(e.clientY));
      }}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDot[column.status])} aria-hidden />
        <h2 className="flex-1 truncate text-sm font-semibold">{column.name}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {statusLabel[column.status]} · <span className="tabular-nums">{cards.length}</span>
        </span>
      </header>

      <ol ref={listRef} className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.map((card) => {
          const dragged = card.id === draggingId;
          const before = !dragged && dropIndexHere === slot ? indicator : null;
          if (!dragged) slot++;
          return (
            <Fragment key={card.id}>
              {before}
              <li data-card-id={card.id}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", card.id);
                    onDragStartCard(card.id);
                  }}
                  onDragEnd={onDragEndCard}
                  onClick={() => onOpenCard(card.id)}
                  onKeyDown={(e) => onCardKey(e, card)}
                  aria-label={`${card.title}, ${statusLabel[card.status]}. Open to edit; Alt + arrow keys move it.`}
                  className={cn(
                    "min-h-11 w-full cursor-grab rounded-lg border border-border bg-background px-3 py-2 text-left text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-opacity hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
                    dragged && "opacity-40",
                  )}
                >
                  <span className="line-clamp-3 break-words">{card.title}</span>
                  {card.description.trim() !== "" && (
                    <span className="mt-1 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Notes
                    </span>
                  )}
                </button>
              </li>
            </Fragment>
          );
        })}
        {dropIndexHere !== null && dropIndexHere >= slot && indicator}
      </ol>

    </section>
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
  const [error, setError] = useState("");

  const saveMutation = useMutation({
    mutationFn: (edit: KanbanCardEdit) => editKanbanCard(boardId, card!.id, edit),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Couldn't save this card"),
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!card || saveMutation.isPending) return;
    const t = title.trim();
    if (!t) {
      setError("A card needs a title.");
      return;
    }
    const edit: KanbanCardEdit = {};
    if (t !== card.title) edit.title = t;
    if (description !== card.description) edit.description = description;
    if (Object.keys(edit).length === 0) {
      onClose();
      return;
    }
    setError("");
    saveMutation.mutate(edit);
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

          <DialogFooter>
            <Button type="button" variant="ghost" className="min-h-11" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="min-h-11" disabled={saveMutation.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
