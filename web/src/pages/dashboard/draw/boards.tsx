import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fetchBoards, createBoard, renameBoard, deleteBoard } from "@/lib/draw";
import type { BoardSummary } from "@/types/draw";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export default function BoardsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [newTitle, setNewTitle] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleting, setDeleting] = useState<BoardSummary | null>(null);
  const [actionError, setActionError] = useState("");

  const boardsQuery = useQuery({ queryKey: ["boards"], queryFn: fetchBoards });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["boards"] });

  const fail = (fallback: string) => (err: unknown) =>
    setActionError(err instanceof Error ? err.message : fallback);

  const createMutation = useMutation({
    mutationFn: createBoard,
    onSuccess: (board) => {
      refresh();
      navigate(`/dashboard/draw/${board.id}`);
    },
    onError: fail("Couldn't create this board"),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameBoard(id, title),
    onSuccess: () => {
      setRenamingId(null);
      refresh();
    },
    onError: fail("Couldn't rename this board"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBoard(id),
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
    const title = newTitle.trim();
    if (createMutation.isPending) return;
    if (!title) {
      setActionError("Give the board a title first.");
      return;
    }
    setActionError("");
    createMutation.mutate(title);
  };

  const startRename = (board: BoardSummary) => {
    setActionError("");
    setRenamingId(board.id);
    setRenameTitle(board.title);
  };

  const handleRename = (id: string) => {
    const title = renameTitle.trim();
    if (renameMutation.isPending) return;
    if (!title) {
      setActionError("Give the board a title first.");
      return;
    }
    setActionError("");
    renameMutation.mutate({ id, title });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Boards</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Diagrams live here. Open one to draw — everything autosaves.
      </p>

      <form onSubmit={handleCreate} className="mt-4 flex gap-2">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New board title..."
          aria-label="New board title"
        />
        <Button type="submit" disabled={createMutation.isPending}>
          <Plus className="h-4 w-4" />
          New board
        </Button>
      </form>

      {actionError && <p className="mt-3 text-sm text-destructive">{actionError}</p>}

      {boardsQuery.isLoading && <p className="mt-6 text-sm text-muted-foreground">Loading boards...</p>}

      {boardsQuery.error && (
        <div className="mt-6">
          <p className="text-sm text-destructive">Couldn't load boards.</p>
          <Button variant="outline" className="mt-2" onClick={() => boardsQuery.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {boardsQuery.data && boardsQuery.data.length === 0 && (
        <p className="mt-6 text-sm text-muted-foreground">
          No boards yet — name one above to start drawing.
        </p>
      )}

      {boardsQuery.data && boardsQuery.data.length > 0 && (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {boardsQuery.data.map((board) => (
              <TableRow key={board.id}>
                <TableCell>
                  {renamingId === board.id ? (
                    <span className="flex gap-2">
                      <Input
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        aria-label="Board title"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(board.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                      />
                      <Button size="sm" onClick={() => handleRename(board.id)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <Link
                      to={`/dashboard/draw/${board.id}`}
                      className="font-medium hover:underline"
                    >
                      {board.title}
                    </Link>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(board.updated_at), { addSuffix: true })}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Rename ${board.title}`}
                    onClick={() => startRename(board)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${board.title}`}
                    onClick={() => setDeleting(board)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete board</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{deleting?.title}” permanently? The canvas and its doc are removed for
              every device. This cannot be undone.
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
