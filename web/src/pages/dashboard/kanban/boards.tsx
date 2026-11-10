import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Pencil, Plus, Settings, SquareKanban, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  fetchKanbanBoards,
  createKanbanBoard,
  renameKanbanBoard,
  deleteKanbanBoard,
} from "@/lib/kanban";
import type { KanbanBoard } from "@/types/kanban";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const boardsKey = ["kanban", "boards"];

export default function KanbanBoardsPage() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleting, setDeleting] = useState<KanbanBoard | null>(null);
  const [actionError, setActionError] = useState("");

  const boardsQuery = useQuery({ queryKey: boardsKey, queryFn: fetchKanbanBoards });
  const refresh = () => queryClient.invalidateQueries({ queryKey: boardsKey });
  const fail = (fallback: string) => (err: unknown) =>
    setActionError(err instanceof Error ? err.message : fallback);

  const createMutation = useMutation({
    mutationFn: createKanbanBoard,
    onSuccess: () => {
      setNewName("");
      refresh();
    },
    onError: fail("Couldn't create this board"),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameKanbanBoard(id, name),
    onSuccess: () => {
      setRenamingId(null);
      refresh();
    },
    onError: fail("Couldn't rename this board"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteKanbanBoard(id),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
    onError: (err) => {
      setDeleting(null);
      fail("Couldn't delete this board")(err);
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (createMutation.isPending) return;
    if (!name) {
      setActionError("Name the board first.");
      return;
    }
    setActionError("");
    createMutation.mutate(name);
  };

  const startRename = (board: KanbanBoard) => {
    setActionError("");
    setRenamingId(board.id);
    setRenameName(board.name);
  };

  const handleRename = (id: string) => {
    const name = renameName.trim();
    if (renameMutation.isPending) return;
    if (!name) {
      setActionError("Name the board first.");
      return;
    }
    setActionError("");
    renameMutation.mutate({ id, name });
  };

  const boards = boardsQuery.data;
  const isEmpty = boards !== undefined && boards.length === 0;

  // The view's one create action: inside the empty state when there are no
  // boards yet, above the list otherwise.
  const createForm = (
    <form onSubmit={handleCreate} className="grid w-full gap-2">
      <Label htmlFor="kanban-new-board">New board</Label>
      <div className="flex gap-2">
        <Input
          id="kanban-new-board"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Homelab, Job hunt, Daily..."
        />
        <Button type="submit" disabled={createMutation.isPending} className="min-h-11">
          <Plus className="h-4 w-4" />
          Create
        </Button>
      </div>
    </form>
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Kanban / Boards
      </p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">Boards</h1>
        <div className="flex gap-1">
          <Button asChild variant="ghost" className="min-h-11">
            <Link to="/dashboard/kanban/reminders">
              <BellRing className="h-4 w-4" aria-hidden />
              Reminders
            </Link>
          </Button>
          <Button asChild variant="ghost" className="min-h-11">
            <Link to="/dashboard/kanban/settings">
              <Settings className="h-4 w-4" aria-hidden />
              Settings
            </Link>
          </Button>
        </div>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
        Move cards from Todo through In progress to Done. Boards are private to you.
      </p>

      {!isEmpty && <div className="mt-6">{createForm}</div>}

      {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}

      {boardsQuery.isLoading && (
        <div className="mt-6 divide-y divide-border border-y border-border" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-14 items-center">
              <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {boardsQuery.error && (
        <div className="mt-6">
          <p className="text-sm text-destructive">Couldn't load boards.</p>
          <Button variant="outline" className="mt-2 min-h-11" onClick={() => boardsQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {isEmpty && (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-xl border border-border p-6">
          <SquareKanban className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm leading-relaxed text-muted-foreground">
            No boards yet. A new board starts with Todo, Doing, and Done columns.
          </p>
          {createForm}
        </div>
      )}

      {boards && boards.length > 0 && (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {boards.map((board) => (
            <li key={board.id} className="flex min-h-14 items-center gap-3 py-2">
              {renamingId === board.id ? (
                <span className="flex flex-1 gap-2">
                  <Input
                    value={renameName}
                    onChange={(e) => setRenameName(e.target.value)}
                    aria-label="Board name"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRename(board.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <Button className="min-h-11" onClick={() => handleRename(board.id)}>
                    Save
                  </Button>
                  <Button variant="ghost" className="min-h-11" onClick={() => setRenamingId(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <>
                  <Link
                    to={`/dashboard/kanban/${board.id}`}
                    className="flex min-h-11 flex-1 items-center truncate font-medium hover:underline"
                  >
                    {board.name}
                  </Link>
                  <span className="hidden font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground sm:inline">
                    {formatDistanceToNow(new Date(board.created_at), { addSuffix: true })}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11"
                    aria-label={`Rename ${board.name}`}
                    onClick={() => startRename(board)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-11 w-11"
                    aria-label={`Delete ${board.name}`}
                    onClick={() => setDeleting(board)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete board</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{deleting?.name}” and everything on it permanently? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
