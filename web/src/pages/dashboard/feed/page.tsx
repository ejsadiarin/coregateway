import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEntryTags, useKindCategories, useRules, useToggleSkip } from "@/hooks/use-ledger";
import { canSkip, entryOf } from "@/lib/ledger";
import { budgetChips } from "@/lib/feed-rail";
import { CategoryChip, RuleChip, StatusChip, TagChip } from "@/components/budget/ledger/chips";
import { FeedRail } from "./feed-rail";
import { useLocation, useNavigate } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowLeftRight,
  BanknoteArrowUp,
  BellRing,
  ChevronDown,
  Copy,
  MessageSquareText,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  SendHorizontal,
  SquareKanban,
  SkipForward,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  appendNote,
  archivePrompt,
  canErase,
  copyText,
  dayNet,
  deleteRecordPrompt,
  feedDays,
  deleteNote,
  editNoteText,
  enterSends,
  feedNotes,
  fetchFeed,
  isFeedData,
  linkKindName,
  linkSummary,
  MAX_NOTE_LENGTH,
  noteCopyText,
  notePreview,
  noteClock,
  feedKey,
  postNote,
  removeNote,
  replaceNote,
  saveSnapshot,
  searchFeed,
  setNoteArchived,
  splitLinks,
  type FeedData,
} from "@/lib/feed";
import { budgetRecordOf, deleteBudgetRecord, isBudgetLink } from "@/lib/feed-records";
import { budgetKeys, useTags } from "@/hooks/use-budget";
import type { FeedFilter, Note, NoteLink } from "@/types/feed";
import { syncAllBudgetNotes } from "@/lib/budget-sync";
import { formatPeso } from "@/lib/format";
import { useBudgetRecords, type CategoryName } from "./use-budget-records";
import { useBudgetSearch } from "./use-budget-search";
import { MAX_SEARCH_LENGTH, MAX_SEARCH_RECORDS } from "@/lib/feed-search";
import { useTouchDevice } from "@/hooks/use-touch-device";
import { useAuth } from "@/contexts/auth-context";
import { ExchangeDialog } from "@/components/exchange/exchange-compare";
import { AttachmentGrid, AttachmentViewer, UploadTray } from "./attachments";
import { useUploads } from "./use-uploads";
import { ATTACH_ACCEPT, MAX_ATTACHMENTS } from "@/lib/attachments";
import { takeSharedFiles } from "@/lib/shared-files";
import { cn } from "@/lib/utils";
import { AnimatePresence } from "motion/react";
import { EnterItem } from "@/components/ui/enter-item";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  type BudgetDialogState,
  type CardDialogState,
} from "./record-dialogs";
import { ReminderDialog, type ReminderDialogState } from "@/pages/dashboard/kanban/reminders";


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

// A live expense or income on its note: what it was, the signed amount,
// and its category, whether a rule made it, and a status other than
// posted.
function BudgetLine({ link, categoryName }: { link: NoteLink; categoryName?: CategoryName }) {
  const r = isBudgetLink(link) ? budgetRecordOf(link) : undefined;
  const kind = link.kind === "income" ? "income" : "expense";
  // The same queries as the Expenses and Incomes pages, so a record's chips
  // match its ledger row and are rarely fetched again.
  const rules = useRules(kind).data;
  const categories = useKindCategories(kind).data;
  const tagIds = useEntryTags(kind);
  const tags = useTags().data;
  const ctx = useMemo(
    () => ({
      ruleById: new Map((rules ?? []).map((x) => [x.id, x])),
      categoryById: new Map((categories ?? []).map((c) => [c.id, c])),
      tagById: new Map((tags ?? []).map((t) => [t.id, t])),
      tagIds,
    }),
    [rules, categories, tags, tagIds],
  );
  if (!r) return <LinkLine link={link} categoryName={categoryName} />;
  const chips = budgetChips(r, ctx);
  const income = link.kind === "income";
  const Icon = linkIcons[link.kind];
  const status = r.status ?? "posted";
  const muted = status !== "posted";
  return (
    <span className={cn("block min-w-0 text-left", muted && "opacity-60")}>
      <span className="flex min-w-0 items-start gap-2 text-sm leading-relaxed">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={linkKindName[link.kind]} />
        <span className="min-w-0 break-words">{r.description || linkKindName[link.kind]}</span>
        <span
          className={cn(
            "ml-auto shrink-0 pl-3 font-mono tabular-nums",
            income ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
            muted && "line-through",
          )}
        >
          {income ? "+" : "−"}
          {formatPeso(r.amount, r.currency)}
        </span>
      </span>
      {(chips.category || chips.rule || chips.tags.length > 0 || chips.status) && (
        <span className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
          <CategoryChip category={chips.category} icon />
          {chips.rule && <RuleChip>{chips.rule}</RuleChip>}
          {chips.tags.map((t) => (
            <TagChip key={t.id} tag={t} />
          ))}
          {chips.status && <StatusChip status={chips.status} />}
        </span>
      )}
    </span>
  );
}

// useEnterToSend gives a note's text box its keys: Enter sends on a
// desktop and types a line break on a touch device (see enterSends), with
// the on-screen key labelled to match; Escape runs onEscape, if given.
function useEnterToSend(send: () => void, onEscape?: () => void) {
  const touch = useTouchDevice();
  return {
    enterKeyHint: touch ? ("enter" as const) : ("send" as const),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && onEscape) return onEscape();
      const { key, shiftKey, ctrlKey, metaKey, keyCode, nativeEvent } = e;
      if (enterSends({ key, shiftKey, ctrlKey, metaKey, keyCode, isComposing: nativeEvent.isComposing }, touch)) {
        e.preventDefault();
        send();
      }
    },
  };
}

// What a live note's menu and taps can do.
interface NoteActions {
  copy: () => void;
  saveText: (text: string, done: () => void) => void;
  makeReminder: () => void;
  makeCard: () => void;
  openRecord: () => void;
  archive: () => void;
  // Deletes a live expense or income from corefinance; its note stays,
  // marked deleted (coreban ADR-0006).
  deleteRecord: () => void;
  // Skips a rule entry for its date alone, or undoes that; undefined for
  // a note that isn't a live rule entry.
  toggleSkip?: { skipped: boolean; run: () => void };
  erase: () => void;
}

function NoteMenu({ note, actions, onEditText }: { note: Note; actions: NoteActions; onEditText: () => void }) {
  const link = note.link;
  const item = "min-h-11 gap-2";
  // A note with attachments stays a plain note, and Copy copies text only.
  const convertible = !link && !note.attachments?.length;
  const copyable = !!link || note.text !== "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Note actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {convertible && (
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
        {copyable && (
          <DropdownMenuItem className={item} onSelect={actions.copy}>
            <Copy className="h-4 w-4" aria-hidden />
            Copy
          </DropdownMenuItem>
        )}
        {!link && (
          <DropdownMenuItem className={item} onSelect={onEditText}>
            <Pencil className="h-4 w-4" aria-hidden />
            {note.attachments?.length ? "Edit caption" : "Edit text"}
          </DropdownMenuItem>
        )}
        {link && !link.deleted && (
          <DropdownMenuItem className={item} onSelect={actions.openRecord}>
            <Pencil className="h-4 w-4" aria-hidden />
            Edit {link.kind}
          </DropdownMenuItem>
        )}
        {actions.toggleSkip && (
          <DropdownMenuItem className={item} onSelect={actions.toggleSkip.run}>
            <SkipForward className="h-4 w-4" aria-hidden />
            {actions.toggleSkip.skipped ? "Undo skip" : "Skip this date"}
          </DropdownMenuItem>
        )}
        {isBudgetLink(link) && !link.deleted ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={`${item} text-destructive focus:text-destructive`}
              onSelect={actions.deleteRecord}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              Delete {link.kind}
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem className={item} onSelect={actions.archive}>
            <Archive className="h-4 w-4" aria-hidden />
            Archive
          </DropdownMenuItem>
        )}
        {canErase(note) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className={`${item} text-destructive focus:text-destructive`} onSelect={actions.erase}>
              <Trash2 className="h-4 w-4" aria-hidden />
              Permanently delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const bubble =
  "min-w-0 max-w-[85%] rounded-xl border border-border bg-card px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]";

function NoteTime({ note, className }: { note: Note; className?: string }) {
  return (
    <time
      dateTime={note.posted_at}
      className={cn(
        "mt-1 block font-mono text-[10px] uppercase tabular-nums tracking-[0.18em] text-muted-foreground",
        className,
      )}
    >
      {noteClock(note.posted_at)}
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
  const [viewing, setViewing] = useState<number | null>(null);
  const captioned = (note.attachments?.length ?? 0) > 0;
  const save = () => {
    if (draft === null || saving) return;
    if (draft.trim() === note.text) return setDraft(null);
    actions.saveText(draft, () => setDraft(null));
  };
  const keys = useEnterToSend(save, () => setDraft(null));

  if (draft !== null) {
    return (
      <div className="ml-auto grid w-full max-w-[85%] gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          {...keys}
          aria-label={captioned ? "Caption" : "Note text"}
          className="min-h-11 [field-sizing:content] max-h-60"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="min-h-11" onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button className="min-h-11" onClick={save} disabled={saving || (!captioned && !draft.trim())}>
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
        link.deleted && isBudgetLink(link) ? (
          // A deleted expense or income: one muted line, its last content.
          <div className="min-w-0 max-w-[85%] truncate rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground">
            {linkSummary(link, new Date().getFullYear(), categoryName).title}
          </div>
        ) : link.deleted ? (
          <div className={bubble}>
            <LinkLine link={link} categoryName={categoryName} />
            <NoteTime note={note} className="text-right" />
          </div>
        ) : (
          <button type="button" onClick={actions.openRecord} className={cn(bubble, "hover:border-primary/40")}>
            {isBudgetLink(link) ? (
              <BudgetLine link={link} categoryName={categoryName} />
            ) : (
              <LinkLine link={link} categoryName={categoryName} />
            )}
            {note.origin !== "budget" && <NoteTime note={note} className="text-right" />}
          </button>
        )
      ) : (
        <div className={cn(bubble, note.attachments?.length && "w-full p-1.5 pb-2")}>
          {note.attachments?.length ? (
            <AttachmentGrid attachments={note.attachments} onOpen={setViewing} />
          ) : null}
          {note.text && <NoteText text={note.text} className={cn(note.attachments?.length && "px-1.5 pt-1.5")} />}
          <NoteTime note={note} className={cn("text-right", note.attachments?.length && "px-1.5")} />
        </div>
      )}
      {captioned && (
        <AttachmentViewer
          attachments={note.attachments!}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
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
  const [viewing, setViewing] = useState<number | null>(null);
  const preview = notePreview(note, new Date().getFullYear(), categoryName);
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
            <>
              {note.attachments?.length ? (
                <>
                  <AttachmentGrid attachments={note.attachments} onOpen={setViewing} />
                  <AttachmentViewer
                    attachments={note.attachments}
                    index={viewing}
                    onIndex={setViewing}
                    onClose={() => setViewing(null)}
                  />
                </>
              ) : null}
              {note.text && <NoteText text={note.text} className="text-muted-foreground" />}
            </>
          )}
          <NoteTime note={note} />
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            {canErase(note) && (
              <Button variant="ghost" className="min-h-11 text-destructive hover:text-destructive" onClick={onDelete}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Permanently delete
              </Button>
            )}
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
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { isGuest } = useAuth();
  const uploads = useUploads(setActionError);
  // How far the view sat from the bottom before older notes loaded above
  // it, so it stays on the same note; null scrolls to the newest note.
  const keepFromBottom = useRef<number | null>(null);
  const toBottom = useRef(true);
  // Held at the bottom after opening there, while budget records and images
  // still load in and grow the Feed, until the reader scrolls or jumps.
  const pinned = useRef(false);

  // All notes, only the owner's own (plain, reminder, card), or only the
  // budget's; each keeps its own pages.
  const [filter, setFilter] = useState<FeedFilter>("all");
  // Archived notes are hidden unless asked for (coreban ADR-0006).
  const [showArchived, setShowArchived] = useState(false);

  // The search box, when open, and what is typed in it. The Feed follows a
  // moment after typing stops; with nothing typed it is the whole Feed.
  const [query, setQuery] = useState<string | null>(null);
  const searchOpen = query !== null;
  const typed = (query ?? "").trim();
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSettled(typed), 300);
    return () => clearTimeout(t);
  }, [typed]);
  const term = typed && settled;
  const searching = term !== "";
  const budget = useBudgetSearch(term, searching && filter !== "notes");

  const key = useMemo(
    () =>
      searching
        ? [...feedKey, "search", term, filter, showArchived, budget.records]
        : [...feedKey, filter, showArchived],
    [searching, term, filter, showArchived, budget.records],
  );
  const feedQuery = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      searching
        ? searchFeed(term, budget.records, pageParam, filter, showArchived)
        : fetchFeed(pageParam, filter, showArchived),
    enabled: !budget.loading,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.older ?? undefined,
  });
  const feed = feedNotes(feedQuery.data);
  const { hasNextPage, isFetchingNextPage, fetchNextPage, isPending: feedPending } = feedQuery;
  const pageCount = feedQuery.data?.pages.length ?? 0;

  const update = (f: (data: FeedData | undefined) => FeedData | undefined) =>
    queryClient.setQueryData<FeedData>(key, f);
  // A changed or deleted note changes in every view that has it: the Feed
  // under a search, and its filters.
  const updateAll = (f: (data: FeedData | undefined) => FeedData | undefined) =>
    queryClient.setQueriesData<FeedData>({ queryKey: feedKey, predicate: (q) => isFeedData(q.state.data) }, f);

  const { notes, categoryName } = useBudgetRecords(
    feed,
    key,
    (saved) => updateAll((d) => replaceNote(d, saved)),
    (id) => updateAll((d) => removeNote(d, id)),
  );
  // A note archived just now leaves the view at once.
  const days = feedDays(showArchived ? notes : notes.filter((n) => !n.archived_at));
  // Each note's place counted from the newest, so the bottom of the Feed,
  // where it opens, arrives first.
  const fromNewest = useMemo(() => {
    const ids = days.flatMap((d) => d.notes.map((n) => n.id));
    return new Map(ids.map((id, i) => [id, ids.length - 1 - i]));
  }, [days]);

  // Every budget record has a note on its own date (coreban ADR-0005):
  // opening the Feed sends coreban what corefinance holds, and re-reads
  // the Feed if that added or moved any.
  useEffect(() => {
    if (isGuest) return;
    syncAllBudgetNotes().then(
      (r) => {
        if (r.created || r.moved) queryClient.invalidateQueries({ queryKey: feedKey });
      },
      () => {},
    );
  }, [isGuest, queryClient]);

  // Tapping a day in the rail's calendar moves the Feed there, loading
  // older pages until that day (or the first day after it) is in. The jump
  // is instant: a smooth scroll could pass the top and load another page
  // mid-way, which keeps the view where the scroll had got to.
  const noteDays = useMemo(() => new Set(days.map((d) => d.key)), [days]);
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  useEffect(() => {
    if (!jumpTo || feedPending) return;
    const oldest = days[0]?.key;
    if (hasNextPage && (!oldest || oldest > jumpTo)) {
      if (!isFetchingNextPage) fetchNextPage();
      return;
    }
    const target = days.find((d) => d.key >= jumpTo) ?? days[days.length - 1];
    pinned.current = false;
    if (target) document.getElementById(`feed-day-${target.key}`)?.scrollIntoView({ block: "start" });
    setJumpTo(null);
  }, [jumpTo, feedPending, days, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const toggleArchived = () => {
    toBottom.current = true;
    setShowArchived((v) => !v);
  };
  const pickFilter = (f: FeedFilter) => {
    toBottom.current = true;
    setFilter(f);
  };

  // Results, and the Feed after them, open on the newest note. This runs
  // before the layout effect below that does the scrolling.
  useLayoutEffect(() => {
    toBottom.current = true;
    keepFromBottom.current = null;
  }, [term]);
  const searchButton = useRef<HTMLButtonElement>(null);
  const closeSearch = () => {
    toBottom.current = true;
    setQuery(null);
  };
  const pickDay = (date: string) => {
    setQuery(null);
    setJumpTo(date);
  };

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
      pinned.current = true;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  });

  // Content that grows without a render (an image loading) keeps a pinned
  // Feed at the bottom too. The reader's own scroll lets go of it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const release = () => {
      pinned.current = false;
    };
    const follow = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    const resized = new ResizeObserver(follow);
    const watch = () => {
      resized.disconnect();
      for (const child of Array.from(el.children)) resized.observe(child);
    };
    watch();
    const added = new MutationObserver(watch);
    added.observe(el, { childList: true });
    el.addEventListener("wheel", release, { passive: true });
    el.addEventListener("touchmove", release, { passive: true });
    el.addEventListener("keydown", release);
    return () => {
      resized.disconnect();
      added.disconnect();
      el.removeEventListener("wheel", release);
      el.removeEventListener("touchmove", release);
      el.removeEventListener("keydown", release);
    };
  }, []);

  // A note just shared from another app (the share route passes its id):
  // once it shows, it is scrolled into view, even if a cached Feed opened
  // first and the note only arrived with the refetch.
  // The id is then dropped from history, so a reload opens as usual.
  const location = useLocation();
  // What opened the Feed: a note just shared (its id), or shared files
  // waiting with their caption.
  const opened = (location.state ?? {}) as { shared?: string; sharedFiles?: string; caption?: string };
  const shared = opened.shared;

  // Images and videos shared from another app (the share route passes
  // where the service worker keeps them): they wait in the chat box as if
  // picked here, with the shared text as their caption. Taken once; the
  // state is then dropped, so a reload doesn't bring them back.
  const sharedFiles = opened.sharedFiles;
  const sharedCaption = opened.caption ?? "";
  const takenShare = useRef<string | null>(null);
  const addShared = useRef<(files: File[]) => void>(() => {});
  // Whether the Feed is still open: shared files read after it closed are
  // never uploaded.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  useEffect(() => {
    if (!sharedFiles || takenShare.current === sharedFiles) return;
    takenShare.current = sharedFiles;
    navigate(location.pathname, { replace: true, state: null });
    if (sharedCaption) setDraft(sharedCaption);
    const lost = "Couldn't open the shared images or videos; share them again.";
    takeSharedFiles(sharedFiles).then(
      (files) => {
        if (!open.current) return;
        if (files.length === 0) return setActionError(lost);
        if (isGuest) return setActionError("Demo accounts can't attach images or videos.");
        addShared.current(files);
      },
      () => open.current && setActionError(lost),
    );
  }, [sharedFiles, sharedCaption, navigate, location.pathname, isGuest]);
  useEffect(() => {
    if (!shared || !notes.some((n) => n.id === shared)) return;
    pinned.current = false;
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
    mutationFn: (v: { text: string; attachments?: string[]; keys?: string[] }) => postNote(v),
    onSuccess: (note, { keys }) => {
      setDraft("");
      if (keys) uploads.posted(keys);
      toBottom.current = true;
      // A posted note isn't a budget note: the Budget view doesn't show it.
      if (filter === "budget") queryClient.invalidateQueries({ queryKey: feedKey });
      else update((d) => appendNote(d, note));
    },
    onError: fail("Couldn't post this note"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string; done: () => void }) => editNoteText(id, text),
    onSuccess: (note, { done }) => {
      done();
      updateAll((d) => replaceNote(d, note));
    },
    onError: fail("Couldn't edit this note"),
  });

  // Archiving hides the note and, in coreban, archives its card or deletes
  // its reminder. A live expense or income note offers Delete instead
  // (coreban ADR-0006).
  const archiveMutation = useMutation({
    mutationFn: async ({ note, archived }: { note: Note; archived: boolean }) => {
      return setNoteArchived(note.id, archived);
    },
    onSuccess: (note) => {
      updateAll((d) => replaceNote(d, note));
      // Archiving or restoring may have archived, restored, or deleted the
      // note's record: let its own pages read it afresh.
      if (isBudgetLink(note.link)) queryClient.invalidateQueries({ queryKey: budgetKeys.all });
      else if (note.link) queryClient.invalidateQueries({ queryKey: ["kanban"] });
    },
    onError: fail("Couldn't change this note"),
  });

  // Deleting a live expense or income from the Feed: the record leaves
  // corefinance first (ADR-0003), then the note keeps what it last showed.
  const [removing, setRemoving] = useState<{ note: Note; prompt: string } | null>(null);
  const deleteRecordMutation = useMutation({
    mutationFn: async (note: Note) => {
      const link = note.link;
      if (!isBudgetLink(link) || link.deleted) return note;
      const last = budgetRecordOf(link);
      await deleteBudgetRecord(link.kind, link.record_id);
      return last ? saveSnapshot(note.id, last) : note;
    },
    onSuccess: (note) => {
      updateAll((d) => replaceNote(d, note));
      queryClient.invalidateQueries({ queryKey: budgetKeys.all });
    },
    onError: fail("Couldn't delete this record"),
  });

  // Skipping a rule entry from its note sets that one record's status,
  // as the ledger does; the note then shows the record as skipped.
  const skip = useToggleSkip();
  const skipActionFor = (note: Note): NoteActions["toggleSkip"] => {
    const link = note.link;
    if (!isBudgetLink(link) || link.deleted) return undefined;
    const record = budgetRecordOf(link);
    if (!record || !canSkip(record)) return undefined;
    return {
      skipped: record.status === "skipped",
      run: () => void skip.toggle(entryOf(link.kind, record)),
    };
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNote(id),
    onSuccess: (_, id) => {
      setDeleting(null);
      updateAll((d) => removeNote(d, id));
    },
    onError: (err) => {
      setDeleting(null);
      fail("Couldn't delete this note")(err);
    },
  });

  // landed is the note of a record just saved from the sheet: once it shows
  // it is brought into view and flashes where it landed (.feed-landed).
  const [landed, setLanded] = useState<string | null>(null);
  useEffect(() => {
    if (!landed) return;
    const li = scroller.current?.querySelector(`[data-note-id="${CSS.escape(landed)}"]`);
    if (!li) return;
    li.scrollIntoView({ block: "nearest" });
    const t = window.setTimeout(() => setLanded(null), 1600);
    return () => window.clearTimeout(t);
  }, [landed, notes]);

  // The budget sheet closes itself once its save shows done; the note it
  // landed flashes after that, not under the sheet.
  const pendingLanded = useRef<string | null>(null);

  // A record was saved from the Feed: re-read the Feed (its note is new,
  // converted, or shows the edit) and the record's own pages.
  const recordSaved = (captured: boolean) => {
    setReminderDialog(null);
    setCardDialog(null);
    if (captured) {
      setDraft("");
      toBottom.current = true;
    }
    queryClient.invalidateQueries({ queryKey: feedKey });
    queryClient.invalidateQueries({ queryKey: ["kanban"] });
    queryClient.invalidateQueries({ queryKey: budgetKeys.all });
  };

  // addFiles takes picked or shared files into the chat box, up to the
  // note's limit, saying how many it left out.
  const addFiles = (picked: File[]) => {
    if (picked.length === 0) return;
    setActionError("");
    const dropped = uploads.add(picked);
    if (dropped > 0) setActionError(`A note holds at most ${MAX_ATTACHMENTS} attachments; ${dropped} left out.`);
  };
  addShared.current = addFiles;

  const pendingFiles = uploads.files.length > 0;
  // A note with attachments posts once every one is up; its text is their
  // caption and may be blank.
  const canSend = !postMutation.isPending && (pendingFiles ? uploads.ready : draft.trim() !== "");
  const send = () => {
    const text = draft.trim();
    if (!canSend) return;
    if ([...text].length > MAX_NOTE_LENGTH) {
      setActionError(`A note holds at most ${MAX_NOTE_LENGTH} characters.`);
      return;
    }
    setActionError("");
    postMutation.mutate({ text, attachments: uploads.sending?.ids, keys: uploads.sending?.keys });
    input.current?.focus();
  };
  const keys = useEnterToSend(send);

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
    deleteRecord: () => {
      const prompt = deleteRecordPrompt(note);
      if (prompt) setRemoving({ note, prompt });
    },
    toggleSkip: skipActionFor(note),
    erase: () => setDeleting(note),
  });

  const isEmpty = feedQuery.isSuccess && notes.length === 0;
  const captureText = draft.trim();

  return (
    // A wide screen gives the Feed two thirds and the rail the rest (#22).
    <div className="mx-auto flex h-full w-full max-w-3xl gap-6 lg:max-w-[1400px] lg:pr-6">
    <div className="flex min-w-0 flex-[2] flex-col">
      {/* The list scrolls under a line, like the one above the composer,
          so a note never looks sliced into the filter chips. */}
      <div className="border-b border-border px-4 pt-4 pb-3 md:px-6 md:pt-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold leading-none tracking-tighter md:text-4xl">Feed</h1>
          <Button
            ref={searchButton}
            type="button"
            variant="ghost"
            size="icon"
            className="-my-2 h-11 w-11 shrink-0"
            aria-label={searchOpen ? "Close search" : "Search"}
            aria-expanded={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : setQuery(""))}
          >
            {searchOpen ? <X className="h-4 w-4" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />}
          </Button>
        </div>
        {searchOpen && (
          <form role="search" className="mt-3" onSubmit={(e) => e.preventDefault()}>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                closeSearch();
                searchButton.current?.focus();
              }}
              aria-label="Search the Feed"
              placeholder="Search notes, reminders, cards, budget"
              maxLength={MAX_SEARCH_LENGTH}
              enterKeyHint="search"
              autoFocus
              className="h-11 [&::-webkit-search-cancel-button]:hidden"
            />
            {searching && budget.failed && (
              <p className="pt-2 text-sm text-muted-foreground">
                Your budget couldn't be read, so expenses and incomes aren't included.
              </p>
            )}
            {searching && budget.total > MAX_SEARCH_RECORDS && (
              <p className="pt-2 text-sm text-muted-foreground">
                Too many budget records match: showing the newest {MAX_SEARCH_RECORDS.toLocaleString()} of{" "}
                {budget.total.toLocaleString()}.
              </p>
            )}
          </form>
        )}
        <div role="group" aria-label="Show" className="mt-3 flex gap-2">
          {(
            [
              ["all", "All"],
              ["notes", "Notes"],
              ["budget", "Budget"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              aria-pressed={filter === value}
              className="min-h-9 rounded-full px-4"
              onClick={() => pickFilter(value)}
            >
              {label}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            variant={showArchived ? "default" : "ghost"}
            aria-pressed={showArchived}
            className="ml-auto min-h-9 rounded-full px-3"
            onClick={toggleArchived}
          >
            <Archive className="h-4 w-4" aria-hidden />
            Archived
          </Button>
        </div>
      </div>

      <div
        ref={scroller}
        role="log"
        aria-label="Feed"
        aria-busy={feedQuery.isPending || isFetchingNextPage}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
      >
        {hasNextPage && (
          <div ref={top} className="flex h-11 items-center justify-center">
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
        )}
        {feedQuery.isSuccess && !hasNextPage && !searching && notes.length > 0 && (
          <p className="pb-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Start of your Feed
          </p>
        )}

        {(feedQuery.isLoading || budget.loading) && (
          <div className="grid gap-3">
            {budget.loading && <p className="text-sm text-muted-foreground">Reading your budget to search it too…</p>}
            {[0, 1, 2].map((i) => (
              <div key={i} className="ml-auto h-14 w-2/3 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        )}

        {feedQuery.error && (
          <div>
            <p className="text-sm text-destructive">{searching ? "Couldn't search the Feed." : "Couldn't load the Feed."}</p>
            <Button variant="outline" className="mt-2 min-h-11" onClick={() => feedQuery.refetch()}>
              Retry
            </Button>
          </div>
        )}

        {isEmpty && searching && (
          <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">No notes match “{term}”.</p>
        )}

        {isEmpty && !searching && (
          <div className="flex h-full flex-col items-start justify-end gap-3 pb-2">
            <MessageSquareText className="h-6 w-6 text-muted-foreground" aria-hidden />
            <p className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
              No notes yet. Type a thought, a todo, or a link below and it lands here, newest last. Turn one into a
              reminder or a card whenever you like.
            </p>
          </div>
        )}

        {notes.length > 0 && (
          <div className="grid grid-cols-1 gap-3">
            {days.map((day) => {
              const { net, any } = dayNet(day.notes);
              return (
                <section key={day.key} id={`feed-day-${day.key}`} aria-label={day.label} className="grid scroll-mt-4 grid-cols-1 gap-3">
                  <div className="flex items-center gap-3 py-1">
                    <span className="h-px flex-1 bg-border" />
                    <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {day.label}
                      {/* A search shows part of a day, so no net for it. */}
                      {any && !searching && (
                        <span className="tabular-nums">
                          {" "}
                          · net {net < 0 ? "\u2212" : "+"}
                          {formatPeso(Math.abs(net))}
                        </span>
                      )}
                    </h2>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <ol className="grid grid-cols-1 gap-3">
                    <AnimatePresence>
                    {day.notes.map((note) => (
                      <EnterItem
                        key={note.id}
                        index={fromNewest.get(note.id) ?? 0}
                        layout
                        data-note-id={note.id}
                        className={cn(note.id === landed && "feed-landed")}
                      >
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
                      </EnterItem>
                    ))}
                    </AnimatePresence>
                  </ol>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className={cn("px-4 md:px-6", !searchOpen && "border-t border-border pb-3 pt-2")}
      >
        {actionError && <p className="pb-2 text-sm text-destructive">{actionError}</p>}
        <p role="status" className="sr-only">
          {status}
        </p>
        {status && <p className="pb-2 text-sm text-muted-foreground">{status}</p>}
        {/* The chat box waits, with what is in it, while the search is open. */}
        <div className={cn(searchOpen && "hidden")}>
        <div className="flex gap-2 overflow-x-auto pb-2">
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
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            aria-label="Exchange rates"
            onClick={() => setExchangeOpen(true)}
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden />
            FX
          </Button>
        </div>
        <UploadTray
          files={uploads.files}
          onRemove={uploads.remove}
          onRetry={uploads.retry}
          locked={postMutation.isPending}
        />
        <div className="flex items-end gap-2">
          {!isGuest && (
            <>
              <input
                ref={picker}
                type="file"
                accept={ATTACH_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  const picked = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  addFiles(picked);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 shrink-0"
                aria-label="Attach images or videos"
                disabled={uploads.files.length >= MAX_ATTACHMENTS}
                onClick={() => picker.current?.click()}
              >
                <Paperclip className="h-4 w-4" aria-hidden />
              </Button>
            </>
          )}
          <Textarea
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            {...keys}
            aria-label="New note"
            placeholder={pendingFiles ? "Add a caption" : "Write a note"}
            rows={1}
            className="min-h-11 max-h-40 resize-none [field-sizing:content]"
          />
          <Button type="submit" className="min-h-11 shrink-0" disabled={!canSend}>
            <SendHorizontal className="h-4 w-4" aria-hidden />
            Send
          </Button>
        </div>
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
      <ExchangeDialog open={exchangeOpen} onOpenChange={setExchangeOpen} />
      <BudgetDialog
        state={budgetDialog}
        onClose={() => {
          setBudgetDialog(null);
          if (pendingLanded.current) setLanded(pendingLanded.current);
          pendingLanded.current = null;
        }}
        onSaved={(warning, noteId) => {
          recordSaved(budgetDialog?.mode === "new");
          if (warning) setActionError(warning);
          pendingLanded.current = noteId ?? null;
        }}
      />

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removing?.note.link?.kind}</AlertDialogTitle>
            <AlertDialogDescription>{removing?.prompt}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing) deleteRecordMutation.mutate(removing.note);
                setRemoving(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
    <FeedRail noteDays={noteDays} onPickDay={pickDay} />
    </div>
  );
}
