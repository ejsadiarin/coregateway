import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  BanknoteArrowUp,
  BellRing,
  ChevronDown,
  Copy,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  SendHorizontal,
  SquareKanban,
  Trash2,
  Wallet,
} from "lucide-react";
import {
  appendNote,
  archivePrompt,
  copyText,
  deleteNote,
  editNoteText,
  feedNotes,
  fetchFeed,
  linkKindName,
  linkSummary,
  MAX_NOTE_LENGTH,
  noteCopyText,
  noteTime,
  feedKey,
  postNote,
  removeNote,
  replaceNote,
  setNoteArchived,
  splitLinks,
  type FeedData,
} from "@/lib/feed";
import { budgetRecordOf, deleteBudgetRecord, isBudgetLink } from "@/lib/feed-records";
import { budgetKeys } from "@/hooks/use-budget";
import type { Note, NoteLink } from "@/types/feed";
import { useBudgetRecords, type CategoryName } from "./use-budget-records";
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
import {
  BudgetDialog,
  CardDialog,
  ReminderDialog,
  type BudgetDialogState,
  type CardDialogState,
  type ReminderDialogState,
} from "./record-dialogs";


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

const linkIcons = { reminder: BellRing, card: SquareKanban, expense: ReceiptText, income: BanknoteArrowUp };

// A linked note's record on one line: its icon, what it is, and when or
// where. A deleted record is muted and marked "(deleted)".
function LinkLine({ link, categoryName, className }: { link: NoteLink; categoryName?: CategoryName; className?: string }) {
  const { title, detail } = linkSummary(link, new Date().getFullYear(), categoryName);
  const Icon = linkIcons[link.kind];
  return (
    <span className={cn("flex min-w-0 items-start gap-2 text-left text-sm leading-relaxed", className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-label={linkKindName[link.kind]} />
      <span className="min-w-0">
        <span className={cn("block break-words", link.deleted && "text-muted-foreground")}>{title}</span>
        {detail && (
          <span className="block font-mono text-[11px] tabular-nums tracking-wide text-muted-foreground">{detail}</span>
        )}
      </span>
    </span>
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

// What a live note's menu and taps can do.
interface NoteActions {
  copy: () => void;
  saveText: (text: string, done: () => void) => void;
  makeReminder: () => void;
  makeCard: () => void;
  openRecord: () => void;
  archive: () => void;
  erase: () => void;
}

function NoteMenu({ note, actions, onEditText }: { note: Note; actions: NoteActions; onEditText: () => void }) {
  const link = note.link;
  const item = "min-h-11 gap-2";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Note actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {!link && (
          <>
            <DropdownMenuItem className={item} onSelect={actions.makeReminder}>
              <BellRing className="h-4 w-4" aria-hidden />
              Make reminder
            </DropdownMenuItem>
            <DropdownMenuItem className={item} onSelect={actions.makeCard}>
              <SquareKanban className="h-4 w-4" aria-hidden />
              Make card
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className={item} onSelect={actions.copy}>
          <Copy className="h-4 w-4" aria-hidden />
          Copy
        </DropdownMenuItem>
        {!link && (
          <DropdownMenuItem className={item} onSelect={onEditText}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit text
          </DropdownMenuItem>
        )}
        {link && !link.deleted && (
          <DropdownMenuItem className={item} onSelect={actions.openRecord}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit {link.kind}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className={item} onSelect={actions.archive}>
          <Archive className="h-4 w-4" aria-hidden />
          Archive
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className={`${item} text-destructive focus:text-destructive`} onSelect={actions.erase}>
          <Trash2 className="h-4 w-4" aria-hidden />
          Permanently delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const bubble =
  "min-w-0 max-w-[85%] rounded-xl border border-border bg-card px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

function NoteTime({ note, className }: { note: Note; className?: string }) {
  return (
    <time
      dateTime={note.created_at}
      className={cn(
        "mt-1 block font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {noteTime(note.created_at)}
    </time>
  );
}

function LiveNote({
  note,
  actions,
  saving,
  categoryName,
}: {
  note: Note;
  actions: NoteActions;
  saving: boolean;
  categoryName: CategoryName;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = () => {
    if (draft === null || saving) return;
    if (draft.trim() === note.text) return setDraft(null);
    actions.saveText(draft, () => setDraft(null));
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

  const link = note.link;
  return (
    <div className="flex items-start justify-end gap-1">
      {link ? (
        link.deleted ? (
          <div className={bubble}>
            <LinkLine link={link} categoryName={categoryName} />
            <NoteTime note={note} className="text-right" />
          </div>
        ) : (
          <button type="button" onClick={actions.openRecord} className={cn(bubble, "hover:border-primary/40")}>
            <LinkLine link={link} categoryName={categoryName} />
            <NoteTime note={note} className="text-right" />
          </button>
        )
      ) : (
        <div className={bubble}>
          <NoteText text={note.text} />
          <NoteTime note={note} className="text-right" />
        </div>
      )}
      <NoteMenu note={note} actions={actions} onEditText={() => setDraft(note.text)} />
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
  categoryName,
}: {
  note: Note;
  onRestore: () => void;
  onDelete: () => void;
  restoring: boolean;
  categoryName: CategoryName;
}) {
  const [open, setOpen] = useState(false);
  const preview = note.link ? linkSummary(note.link, new Date().getFullYear(), categoryName).title : note.text;
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
        <span className="min-w-0 flex-1 truncate text-sm">{!open && preview}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-border px-3 pb-2 pt-2">
          {note.link ? (
            <LinkLine link={note.link} categoryName={categoryName} className="text-muted-foreground" />
          ) : (
            <NoteText text={note.text} className="text-muted-foreground" />
          )}
          <NoteTime note={note} />
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
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState("");
  const [status, setStatus] = useState("");
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [archiving, setArchiving] = useState<{ note: Note; prompt: string } | null>(null);
  const [reminderDialog, setReminderDialog] = useState<ReminderDialogState | null>(null);
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null);
  const [budgetDialog, setBudgetDialog] = useState<BudgetDialogState | null>(null);
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
  const feed = feedNotes(feedQuery.data);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feedQuery;
  const pageCount = feedQuery.data?.pages.length ?? 0;

  const update = (f: (data: FeedData | undefined) => FeedData | undefined) =>
    queryClient.setQueryData<FeedData>(feedKey, f);

  const { notes, categoryName } = useBudgetRecords(feed, feedKey, (saved) => update((d) => replaceNote(d, saved)));

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

  // A note just shared from another app (the share route passes its id):
  // once it shows, it is scrolled into view, even if a cached Feed opened
  // first and the note only arrived with the refetch.
  // The id is then dropped from history, so a reload opens as usual.
  const location = useLocation();
  const shared = (location.state as { shared?: string } | null)?.shared;
  useEffect(() => {
    if (!shared || !notes.some((n) => n.id === shared)) return;
    scroller.current?.querySelector(`[data-note-id="${CSS.escape(shared)}"]`)?.scrollIntoView({ block: "end" });
    navigate(location.pathname, { replace: true, state: null });
  }, [shared, notes, navigate, location.pathname]);

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

  // Archiving a live expense or income note deletes the record in
  // corefinance first, then archives the note with what it last showed.
  // Never the other way round: if the second step fails, the next load
  // finds the record gone and the note reads deleted.
  const archiveMutation = useMutation({
    mutationFn: async ({ note, archived }: { note: Note; archived: boolean }) => {
      const link = note.link;
      if (archived && isBudgetLink(link) && !link.deleted) {
        await deleteBudgetRecord(link.kind, link.record_id);
        return setNoteArchived(note.id, true, budgetRecordOf(link));
      }
      return setNoteArchived(note.id, archived);
    },
    onSuccess: (note) => {
      update((d) => replaceNote(d, note));
      // Archiving or restoring may have archived, restored, or deleted the
      // note's record: let its own pages read it afresh.
      if (isBudgetLink(note.link)) queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      else if (note.link) queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
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

  // A record was saved from the Feed: re-read the Feed (its note is new,
  // converted, or shows the edit) and the record's own pages.
  const recordSaved = (captured: boolean) => {
    setReminderDialog(null);
    setCardDialog(null);
    setBudgetDialog(null);
    if (captured) {
      setDraft("");
      toBottom.current = true;
    }
    queryClient.invalidateQueries({ queryKey: feedKey });
    queryClient.invalidateQueries({ queryKey: ["kanban"] });
    queryClient.invalidateQueries({ queryKey: budgetKeys.all });
  };

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

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(""), 2000);
    return () => clearTimeout(t);
  }, [status]);

  const actionsFor = (note: Note): NoteActions => ({
    copy: () =>
      copyText(noteCopyText(note, new Date().getFullYear(), categoryName)).then(
        () => setStatus("Copied."),
        fail("Couldn't copy this note"),
      ),
    saveText: (text, done) => {
      setActionError("");
      editMutation.mutate({ id: note.id, text, done });
    },
    makeReminder: () => setReminderDialog({ mode: "new", text: note.text, note: note.id }),
    makeCard: () => setCardDialog({ text: note.text, note: note.id }),
    openRecord: () => {
      const link = note.link;
      if (!link || link.deleted) return;
      if (link.kind === "reminder" && link.reminder) setReminderDialog({ mode: "edit", reminder: link.reminder });
      // An archived card has no editor on its board; open the board itself.
      if (link.kind === "card" && link.card) {
        const c = link.card;
        navigate(`/dashboard/kanban/${c.board_id}${c.archived_at ? "" : `?card=${c.id}`}`);
      }
      if (link.kind === "expense" && link.expense) setBudgetDialog({ mode: "edit", kind: "expense", record: link.expense });
      if (link.kind === "income" && link.income) setBudgetDialog({ mode: "edit", kind: "income", record: link.income });
    },
    archive: () => {
      const prompt = archivePrompt(note);
      if (prompt) setArchiving({ note, prompt });
      else archiveMutation.mutate({ note, archived: true });
    },
    erase: () => setDeleting(note),
  });

  const isEmpty = feedQuery.isSuccess && notes.length === 0;
  const captureText = draft.trim();

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
              No notes yet. Type a thought, a todo, or a link below and it lands here, newest last. Turn one into a
              reminder or a card whenever you like.
            </p>
          </div>
        )}

        {notes.length > 0 && (
          <ol className="grid grid-cols-1 gap-3">
            {notes.map((note) => (
              <li key={note.id} data-note-id={note.id}>
                {note.archived_at ? (
                  <ArchivedNote
                    note={note}
                    restoring={archiveMutation.isPending}
                    onRestore={() => archiveMutation.mutate({ note, archived: false })}
                    onDelete={() => setDeleting(note)}
                    categoryName={categoryName}
                  />
                ) : (
                  <LiveNote
                    note={note}
                    saving={editMutation.isPending}
                    actions={actionsFor(note)}
                    categoryName={categoryName}
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
        <div className="flex gap-2 pb-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setReminderDialog({ mode: "new", text: captureText, note: "new" })}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Reminder
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setCardDialog({ text: captureText, note: "new" })}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Card
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setBudgetDialog({ mode: "new", text: captureText })}
          >
            <Wallet className="h-4 w-4" aria-hidden />
            Budget
          </Button>
        </div>
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

      <ReminderDialog
        state={reminderDialog}
        onClose={() => setReminderDialog(null)}
        onSaved={() => recordSaved(reminderDialog?.mode === "new" && reminderDialog.note === "new")}
      />
      <CardDialog
        state={cardDialog}
        onClose={() => setCardDialog(null)}
        onSaved={() => recordSaved(cardDialog?.note === "new")}
      />
      <BudgetDialog
        state={budgetDialog}
        onClose={() => setBudgetDialog(null)}
        onSaved={(warning) => {
          recordSaved(budgetDialog?.mode === "new");
          if (warning) setActionError(warning);
        }}
      />

      <AlertDialog open={archiving !== null} onOpenChange={(open) => !open && setArchiving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive note</AlertDialogTitle>
            <AlertDialogDescription>{archiving?.prompt}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (archiving) archiveMutation.mutate({ note: archiving.note, archived: true });
                setArchiving(null);
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete note</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.link && !deleting.link.deleted
                ? `Erase this note for good? Its ${deleting.link.kind} stays; only the note goes. This cannot be undone.`
                : "Erase this note for good? Archive it instead to keep it. This cannot be undone."}
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
