import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronDown, Copy, MessageSquareText, MoreHorizontal, Pencil, SendHorizontal, Trash2 } from "lucide-react";
import {
  appendNote,
  copyText,
  deleteNote,
  editNoteText,
  feedNotes,
  fetchFeed,
  MAX_NOTE_LENGTH,
  noteTime,
  postNote,
  removeNote,
  replaceNote,
  setNoteArchived,
  splitLinks,
  type FeedData,
} from "@/lib/feed";
import type { Note } from "@/types/feed";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

const feedKey = ["coreban", "feed"];

// A note's text with its links tappable. Links open in a new tab and are
// never fetched to preview them.
function NoteText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words text-sm leading-relaxed", className)}>
      {splitLinks(text).map((piece, i) =>
        piece.href ? (
          <a
            key={i}
            href={piece.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2 [overflow-wrap:anywhere]"
          >
            {piece.text}
          </a>
        ) : (
          <span key={i}>{piece.text}</span>
        ),
      )}
    </p>
  );
}

// sendOnEnter runs send on Enter, leaving Shift+Enter (and an IME still
// composing a word) to type a line break.
const sendOnEnter = (send: () => void) => (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
    e.preventDefault();
    send();
  }
};

function LiveNote({
  note,
  onCopy,
  onSaveText,
  onArchive,
  onDelete,
  saving,
}: {
  note: Note;
  onCopy: () => void;
  onSaveText: (text: string, done: () => void) => void;
  onArchive: () => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null || saving) return;
    if (draft.trim() === note.text) return setDraft(null);
    onSaveText(draft, () => setDraft(null));
  };

  if (draft !== null) {
    return (
      <div className="ml-auto grid w-full max-w-[85%] gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setDraft(null);
            else sendOnEnter(save)(e);
          }}
          aria-label="Note text"
          className="min-h-11 [field-sizing:content] max-h-60"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button className="min-h-11" onClick={save} disabled={saving || !draft.trim()}>
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-end gap-1">
      <div className="min-w-0 max-w-[85%] rounded-xl border border-border bg-card px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <NoteText text={note.text} />
        <time
          dateTime={note.created_at}
          className="mt-1 block text-right font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground"
        >
          {noteTime(note.created_at)}
        </time>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Note actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={onCopy}>
            <Copy className="h-4 w-4" aria-hidden />
            Copy
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => setDraft(note.text)}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit text
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={onArchive}>
            <Archive className="h-4 w-4" aria-hidden />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11 gap-2 text-destructive focus:text-destructive" onSelect={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden />
            Permanently delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// An archived note stays in its place, collapsed. Opening it shows its
// last content, with Restore and Permanently delete.
function ArchivedNote({
  note,
  onRestore,
  onDelete,
  restoring,
}: {
  note: Note;
  onRestore: () => void;
  onDelete: () => void;
  restoring: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ml-auto w-full max-w-[85%] rounded-xl border border-dashed border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-muted-foreground"
      >
        <Archive className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em]">Archived</span>
        <span className="min-w-0 flex-1 truncate text-sm">{!open && note.text}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-2 pt-2">
          <NoteText text={note.text} className="text-muted-foreground" />
          <time
            dateTime={note.created_at}
            className="mt-1 block font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground"
          >
            {noteTime(note.created_at)}
          </time>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Permanently delete
            </Button>
            <Button variant="outline" className="min-h-11" onClick={onRestore} disabled={restoring}>
              Restore
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function FeedPage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState<Note | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // How far the view sat from the bottom before older notes loaded above
  // it, so it stays on the same note; null scrolls to the newest note.
  const keepFromBottom = useRef<number | null>(null);
  const toBottom = useRef(true);

  const feedQuery = useInfiniteQuery({
    queryKey: feedKey,
    queryFn: ({ pageParam }) => fetchFeed(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.older ?? undefined,
  });
  const notes = feedNotes(feedQuery.data);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feedQuery;
  const pageCount = feedQuery.data?.pages.length ?? 0;

  const update = (f: (data: FeedData | undefined) => FeedData | undefined) =>
    queryClient.setQueryData<FeedData>(feedKey, f);
  const fail = (fallback: string) => (err: unknown) =>
    setActionError(err instanceof Error ? err.message : fallback);

  // Opens on the newest note; keeps the reader's place when older notes
  // load above; follows a just-posted note to the bottom.
  const shownPages = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const olderLoaded = pageCount > shownPages.current;
    shownPages.current = pageCount;
    // The anchor waits for the older page itself: the render that starts
    // fetching it changes nothing above the reader yet.
    if (keepFromBottom.current !== null) {
      if (!olderLoaded) return;
      el.scrollTop = el.scrollHeight - keepFromBottom.current;
      keepFromBottom.current = null;
    } else if (toBottom.current && notes.length > 0) {
      el.scrollTop = el.scrollHeight;
      toBottom.current = false;
    }
  });

  // Loads the page before the oldest one shown once the reader scrolls up
  // to it. Re-observing after each page fires again if the top is still in
  // view, so a short Feed keeps filling the screen.
  useEffect(() => {
    const el = scroller.current;
    const sentinel = top.current;
    if (!el || !sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetchingNextPage) {
          keepFromBottom.current = el.scrollHeight - el.scrollTop;
          fetchNextPage();
        }
      },
      { root: el, rootMargin: "200px 0px 0px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, pageCount]);

  const postMutation = useMutation({
    mutationFn: postNote,
    onSuccess: (note) => {
      setDraft("");
      toBottom.current = true;
      update((d) => appendNote(d, note));
    },
    onError: fail("Couldn't post this note"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string; done: () => void }) => editNoteText(id, text),
    onSuccess: (note, { done }) => {
      done();
      update((d) => replaceNote(d, note));
    },
    onError: fail("Couldn't edit this note"),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) => setNoteArchived(id, archived),
    onSuccess: (note) => update((d) => replaceNote(d, note)),
    onError: fail("Couldn't change this note"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: (_, id) => {
      setDeleting(null);
      update((d) => removeNote(d, id));
    },
    onError: (err) => {
      setDeleting(null);
      fail("Couldn't delete this note")(err);
    },
  });

  const send = () => {
    const text = draft.trim();
    if (!text || postMutation.isPending) return;
    if ([...text].length > MAX_NOTE_LENGTH) {
      setActionError(`A note holds at most ${MAX_NOTE_LENGTH} characters.`);
      return;
    }
    setActionError("");
    postMutation.mutate(text);
    input.current?.focus();
  };

  const copy = (note: Note) => {
    copyText(note.text).then(
      () => setStatus("Copied."),
      fail("Couldn't copy this note"),
    );
  };

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 2000);
    return () => clearTimeout(t);
  }, [status]);

  const isEmpty = feedQuery.isSuccess && notes.length === 0;

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">Feed</h1>
      </div>

      <div
        ref={scroller}
        role="log"
        aria-label="Feed"
        aria-busy={feedQuery.isLoading || isFetchingNextPage}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
      >
        {hasNextPage && (
          <div ref={top} className="flex h-11 items-center justify-center">
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
        )}
        {feedQuery.isSuccess && !hasNextPage && notes.length > 0 && (
          <p className="pb-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Start of your Feed
          </p>
        )}

        {feedQuery.isLoading && (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="ml-auto h-14 w-2/3 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {feedQuery.error && (
          <div>
            <p className="text-sm text-destructive">Couldn't load the Feed.</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => feedQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {isEmpty && (
          <div className="flex h-full flex-col items-start justify-end gap-3 pb-2">
            <MessageSquareText className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
              No notes yet. Type a thought, a todo, or a link below and it lands here, newest last.
            </p>
          </div>
        )}

        {notes.length > 0 && (
          <ol className="grid gap-3">
            {notes.map((note) => (
              <li key={note.id}>
                {note.archived_at ? (
                  <ArchivedNote
                    note={note}
                    restoring={archiveMutation.isPending}
                    onRestore={() => archiveMutation.mutate({ id: note.id, archived: false })}
                    onDelete={() => setDeleting(note)}
                  />
                ) : (
                  <LiveNote
                    note={note}
                    saving={editMutation.isPending}
                    onCopy={() => copy(note)}
                    onSaveText={(text, done) => {
                      setActionError("");
                      editMutation.mutate({ id: note.id, text, done });
                    }}
                    onArchive={() => archiveMutation.mutate({ id: note.id, archived: true })}
                    onDelete={() => setDeleting(note)}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="border-t border-border px-4 pb-3 pt-2 md:px-6"
      >
        {actionError && <p className="pb-2 text-sm text-destructive">{actionError}</p>}
        <p role="status" className="sr-only">
          {status}
        </p>
        {status && <p className="pb-2 text-sm text-muted-foreground">{status}</p>}
        <div className="flex items-end gap-2">
          <Textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={sendOnEnter(send)}
            aria-label="New note"
            placeholder="Write a note"
            rows={1}
            className="min-h-11 max-h-40 resize-none [field-sizing:content]"
          />
          <Button type="submit" className="min-h-11" disabled={!draft.trim() || postMutation.isPending}>
            <SendHorizontal className="h-4 w-4" aria-hidden />
            Send
          </Button>
        </div>
      </form>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete note</AlertDialogTitle>
            <AlertDialogDescription>
              Erase this note for good? Archive it instead to keep it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMutation.mutate(deleting.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Permanently delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
