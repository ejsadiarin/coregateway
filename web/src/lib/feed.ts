import type { InfiniteData } from "@tanstack/react-query";
import { format, isSameDay, isSameYear, subDays } from "date-fns";
import type { BudgetKind, FeedFilter, FeedPage, Note, NoteLink } from "@/types/feed";
import type { Expense, Income } from "@/types/api";
import { budgetRecordOf, isBudgetLink } from "@/lib/feed-records";
import { describeSchedule, formatWall } from "@/lib/kanban-schedule";
import { columnOption } from "@/lib/kanban-columns";
import { formatPeso } from "@/lib/format";
import { apiBaseUrl } from "@/lib/api";

const notesUrl = `${apiBaseUrl}/api/coreban/notes`;

// The Feed's query key.
export const feedKey = ["coreban", "feed"];

// The most characters a note's text may hold (coreban's cap).
export const MAX_NOTE_LENGTH = 4000;

// Thrown when coreban refuses a note the owner can fix (400, 409); the
// message is coreban's own explanation.
export class NoteRequestError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "NoteRequestError";
  }
}

// Thrown when coreban answers 401: the session ended, so signing in again
// is the only way forward.
export class SessionExpiredError extends Error {
  constructor() {
    super("Your session has ended; sign in again");
    this.name = "SessionExpiredError";
  }
}

async function throwIfError(res: Response, op: string): Promise<void> {
  if (res.status === 401) throw new SessionExpiredError();
  if (res.status === 404) throw new Error("Note not found — it may have been deleted on another device");
  if (res.status === 400 || res.status === 409) {
    const body = await res.json().catch(() => null);
    throw new NoteRequestError(typeof body?.error === "string" ? body.error : `Couldn't ${op}`);
  }
  if (!res.ok) throw new Error(`Couldn't ${op} (error ${res.status})`);
}

// fetchFeed loads one page of the Feed: the newest notes, or with before,
// the ones placed earlier than that cursor, narrowed by filter.
export async function fetchFeed(before?: string, filter: FeedFilter = "all"): Promise<FeedPage> {
  const q = new URLSearchParams();
  if (before) q.set("before", before);
  if (filter !== "all") q.set("only", filter);
  const url = q.size ? `${notesUrl}?${q}` : notesUrl;
  const res = await fetch(url, { credentials: "include" });
  await throwIfError(res, "load the Feed");
  return res.json();
}

async function send(method: string, url: string, body: unknown, op: string): Promise<Note> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  await throwIfError(res, op);
  return res.json();
}

// postNote posts text, or uploads (by id) with the text as their caption.
export const postNote = ({ text, attachments }: { text: string; attachments?: string[] }) =>
  send("POST", notesUrl, attachments?.length ? { text, attachments } : { text }, "post this note");

export const editNoteText = (id: string, text: string) =>
  send("PATCH", `${notesUrl}/${id}`, { text }, "edit this note");

// setNoteArchived archives or restores a note. Archiving an expense or
// income note sends the content it last showed as its snapshot: the record
// was deleted in corefinance just before.
export const setNoteArchived = (id: string, archived: boolean, snapshot?: Expense | Income) =>
  send(
    "PATCH",
    `${notesUrl}/${id}`,
    snapshot ? { archived, snapshot } : { archived },
    archived ? "archive this note" : "restore this note",
  );

// postBudgetNote adds a note to the end of the Feed for an expense or
// income just created in corefinance.
export const postBudgetNote = (kind: BudgetKind, recordId: string) =>
  send("POST", notesUrl, { link: { kind, id: recordId } }, `add this ${kind}'s note`);

// saveSnapshot keeps what the Feed last showed of a record it found gone.
// coreban keeps only the first one any device sends.
export const saveSnapshot = (id: string, snapshot: Expense | Income) =>
  send("PATCH", `${notesUrl}/${id}`, { snapshot }, "save this note's last content");

export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${notesUrl}/${id}`, { method: "DELETE", credentials: "include" });
  await throwIfError(res, "delete this note");
}

// The Feed as React Query holds it: pages[0] is the newest page, and each
// later page goes further back in time.
export type FeedData = InfiniteData<FeedPage, unknown>;

// feedNotes reads the loaded pages back as one Feed, oldest first. A note
// that a refetch moved across a page boundary shows once.
export function feedNotes(data: FeedData | undefined): Note[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: Note[] = [];
  for (let i = data.pages.length - 1; i >= 0; i--) {
    for (const n of data.pages[i].notes) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}

function mapPages(data: FeedData | undefined, f: (page: FeedPage, i: number) => FeedPage): FeedData | undefined {
  return data && { ...data, pages: data.pages.map(f) };
}

// appendNote puts a just-posted note at the end of the Feed.
export const appendNote = (data: FeedData | undefined, note: Note) =>
  mapPages(data, (p, i) => (i === 0 ? { ...p, notes: [...p.notes, note] } : p));

// replaceNote swaps in a note's new state (edited, archived, restored).
export const replaceNote = (data: FeedData | undefined, note: Note) =>
  mapPages(data, (p) => ({ ...p, notes: p.notes.map((n) => (n.id === note.id ? note : n)) }));

// removeNote drops a permanently deleted note.
export const removeNote = (data: FeedData | undefined, id: string) =>
  mapPages(data, (p) => ({ ...p, notes: p.notes.filter((n) => n.id !== id) }));

// noteTime says when a note was posted, in the device's timezone: just
// the time today, with the day before that, and the year once it differs.
export function noteTime(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (isSameDay(at, now)) return format(at, "HH:mm");
  return format(at, isSameYear(at, now) ? "EEE d MMM, HH:mm" : "EEE d MMM yyyy, HH:mm");
}

// noteClock is the time of day a note was posted; the day it belongs to
// heads its group in the Feed (feedDays).
export const noteClock = (iso: string) => format(new Date(iso), "HH:mm");

// FeedDay is one day of the Feed: its notes in order, under a heading.
export interface FeedDay {
  key: string; // yyyy-MM-dd, local
  label: string;
  notes: Note[];
}

// dayLabel names a Feed day: Today, Yesterday, or the weekday and date,
// with the year once it differs.
export function dayLabel(at: Date, now: Date = new Date()): string {
  if (isSameDay(at, now)) return "Today";
  if (isSameDay(at, subDays(now, 1))) return "Yesterday";
  return format(at, isSameYear(at, now) ? "EEE, MMM d" : "EEE, MMM d, yyyy");
}

// feedDays groups notes (oldest first) by the local day they sit on.
export function feedDays(notes: Note[], now: Date = new Date()): FeedDay[] {
  const days: FeedDay[] = [];
  for (const n of notes) {
    const at = new Date(n.posted_at);
    const key = format(at, "yyyy-MM-dd");
    const last = days[days.length - 1];
    if (last?.key === key) last.notes.push(n);
    else days.push({ key, label: dayLabel(at, now), notes: [n] });
  }
  return days;
}

// dayNet is a day's income less its spending, over the live, posted budget
// records its notes show.
export function dayNet(notes: Note[]): { net: number; any: boolean } {
  let net = 0;
  let any = false;
  for (const n of notes) {
    const l = n.link;
    if (!isBudgetLink(l) || l.deleted) continue;
    const r = budgetRecordOf(l);
    if (!r || (r.status ?? "posted") !== "posted") continue;
    any = true;
    net += (l.kind === "income" ? 1 : -1) * Number(r.amount);
  }
  return { net, any };
}

// A piece of a note's text: plain, or a link to open (href set).
export interface TextPiece {
  text: string;
  href?: string;
}

// http(s) links and bare www addresses, not inside a longer word.
const linkPattern = /(?<![\w@./-])(?:https?:\/\/|www\.)[^\s<>"]+/gi;

// trimLink drops what ends a sentence or closes a bracket around a link
// rather than belonging to it, keeping a closing bracket the link opened
// itself (a Wikipedia "Go_(programming_language)").
function trimLink(url: string): string {
  for (;;) {
    const last = url.at(-1);
    if (last && ".,!?;:'".includes(last)) {
      url = url.slice(0, -1);
    } else if (last === ")" && url.split("(").length < url.split(")").length) {
      url = url.slice(0, -1);
    } else {
      return url;
    }
  }
}

// splitLinks cuts a note's text into plain pieces and links, so links can
// be tapped. Only http(s) links are made: nothing is fetched to preview
// them, and no other scheme (javascript:) can become a link.
export function splitLinks(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let at = 0;
  for (const m of text.matchAll(linkPattern)) {
    const url = trimLink(m[0]);
    const start = m.index;
    if (start > at) pieces.push({ text: text.slice(at, start) });
    pieces.push({ text: url, href: url.toLowerCase().startsWith("www.") ? `https://${url}` : url });
    at = start + url.length;
  }
  if (at < text.length) pieces.push({ text: text.slice(at) });
  return pieces.reduce<TextPiece[]>((out, p) => {
    const prev = out.at(-1);
    if (prev && !prev.href && !p.href) prev.text += p.text;
    else out.push({ ...p });
    return out;
  }, []);
}

// copyText puts text on the clipboard. The Clipboard API needs a secure
// context, which a phone on the tailnet over plain http is not, so it
// falls back to the older copy command there.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Couldn't copy this note");
}

// budgetDay shows the calendar day corefinance stores ("2026-11-12" or
// a midnight timestamp) without shifting it into another timezone.
function budgetDay(date: string, currentYear: number): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const day = new Date(y, m - 1, d);
  if (Number.isNaN(day.getTime())) return "";
  return format(day, y === currentYear ? "EEE d MMM" : "EEE d MMM yyyy");
}

// linkKindName names each kind of linked record as the owner reads it.
export const linkKindName: Record<NoteLink["kind"], string> = {
  reminder: "Reminder",
  card: "Card",
  expense: "Expense",
  income: "Income",
};

// linkSummary is the one line a linked note shows about its record: what
// it is, and when (a reminder's next send, a budget record's day) or where
// (a card's board, column, and status; a budget record's category). Times
// are the owner's wall clock, as coreban renders them; a budget record's
// day is the calendar day corefinance stores.
export function linkSummary(
  link: NoteLink,
  currentYear: number,
  categoryName: (id: string) => string | undefined = () => undefined,
): { title: string; detail: string } {
  let title: string;
  let detail = "";
  if (isBudgetLink(link)) {
    const r = budgetRecordOf(link);
    title = linkKindName[link.kind];
    if (r) {
      title = [formatPeso(r.amount, r.currency), r.description].filter(Boolean).join(" · ");
      const day = "expense_date" in r ? r.expense_date : r.date;
      detail = [
        r.category_id && categoryName(r.category_id),
        day && budgetDay(day, currentYear),
        r.recurring_type !== "one-time" && r.recurring_type,
      ]
        .filter(Boolean)
        .join(" · ");
    }
  } else if (link.kind === "reminder") {
    const r = link.reminder;
    title = r?.message ?? "Reminder";
    if (r) {
      const at = r.next_fire_at ?? (r.schedule.kind === "once" ? r.schedule.at : null);
      detail = at ? formatWall(at, currentYear) : describeSchedule(r.schedule);
    }
  } else {
    const c = link.card;
    title = c?.title ?? "Card";
    if (c) {
      const where = columnOption({ name: c.column_name, status: c.status });
      detail = `${c.board_name} · ${where}${c.archived_at ? " · archived" : ""}`;
    }
  }
  return { title: link.deleted ? `${title} (deleted)` : title, detail };
}

// archivePrompt is the confirmation archiving a note needs, naming what
// happens to its record, or null when only the note changes (a plain note,
// a record already gone, a card already archived).
export function archivePrompt(note: Note): string | null {
  const link = note.link;
  if (!link || link.deleted) return null;
  if (link.kind === "reminder" && link.reminder) {
    return `Archive this note and delete its reminder \u201c${link.reminder.message}\u201d? The reminder can't be brought back.`;
  }
  if (link.kind === "card" && link.card && !link.card.archived_at) {
    return `Archive this note and archive its card \u201c${link.card.title}\u201d? Restore the note to bring the card back.`;
  }
  if (isBudgetLink(link)) {
    const r = budgetRecordOf(link);
    const what = r
      ? ` \u201c${r.description || linkKindName[link.kind]}\u201d (${formatPeso(r.amount, r.currency)})`
      : "";
    return `Archive this note and delete its ${link.kind}${what}? The ${link.kind} can't be brought back.`;
  }
  return null;
}

// notePreview is the one line a collapsed note shows: its text, a linked
// note's record, or what its attachments are when it has no caption.
export function notePreview(
  note: Note,
  currentYear: number,
  categoryName?: (id: string) => string | undefined,
): string {
  if (note.link) return linkSummary(note.link, currentYear, categoryName).title;
  if (note.text || !note.attachments?.length) return note.text;
  const count = (kind: string) => note.attachments!.filter((a) => a.kind === kind).length;
  return [
    [count("image"), "image"],
    [count("video"), "video"],
  ]
    .filter(([n]) => n)
    .map(([n, what]) => `${n} ${what}${n === 1 ? "" : "s"}`)
    .join(", ");
}

// noteCopyText is what Copy puts on the clipboard: a plain note's text
// (never its attachments), or
// a linked note's one-line summary.
export function noteCopyText(
  note: Note,
  currentYear: number,
  categoryName?: (id: string) => string | undefined,
): string {
  if (!note.link) return note.text;
  const { title, detail } = linkSummary(note.link, currentYear, categoryName);
  return detail ? `${title} · ${detail}` : title;
}

// enterSends says whether a key press in a note's text box sends it. On a
// desktop Enter sends, leaving Shift+Enter to type a line break. A touch
// device's keyboard has no Shift+Enter, so there Enter is a line break and
// the Send or Save button sends. Ctrl+Enter or Cmd+Enter sends anywhere, for
// a hardware keyboard on a tablet. The Enter that confirms an IME word
// never sends (Safari flags it only by keyCode 229).
export function enterSends(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; isComposing: boolean; keyCode: number },
  touchDevice: boolean,
): boolean {
  if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return false;
  return e.ctrlKey || e.metaKey || (!touchDevice && !e.shiftKey);
}
