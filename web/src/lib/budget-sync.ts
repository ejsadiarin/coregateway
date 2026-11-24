import { format, isSameDay } from "date-fns";
import { apiBaseUrl, fetchExpenses, fetchIncomes } from "@/lib/api";
import type { Expense, Income } from "@/types/api";
import type { BudgetKind } from "@/types/feed";

// Every budget record has a note in the Feed, on its own date (coreban
// ADR-0005). coreban can't read corefinance, so the web sends it the
// records it reads and coreban creates the missing notes and moves the
// re-dated ones. Repeating a sync changes nothing.

const notesUrl = `${apiBaseUrl}/api/coreban/notes`;

// The most records coreban takes in one sync.
const SYNC_BATCH = 1000;

export interface SyncRecord {
  kind: BudgetKind;
  id: string;
  date: string; // YYYY-MM-DD
  posted_at: string; // RFC 3339
  // timed: posted_at is the record's own time, so coreban puts the note
  // exactly there, not just on the right date (coreban#30).
  timed?: true;
}

export interface SyncResult {
  created: number;
  moved: number;
}

// notePlace is where a record's note sits in the Feed: when it happened,
// if it has a time on its own date here (timed: coreban then keeps the note
// exactly there); else when it was entered, if that was on its own date;
// otherwise local noon of its date. coreban refuses a posted_at off the
// record's date, so a time that reads as another day here (the owner
// travelling) falls back too.
function notePlace(date: string, createdAt: string, occurredAt?: string | null): { at: Date; timed: boolean } {
  const day = new Date(`${date}T12:00:00`);
  const onDay = (t?: string | null) => (t && isSameDay(new Date(t), day) ? new Date(t) : undefined);
  const own = onDay(occurredAt);
  return { at: own ?? onDay(createdAt) ?? day, timed: !!own };
}

const rfc3339 = (at: Date) => format(at, "yyyy-MM-dd'T'HH:mm:ssXXX");

export function budgetPostedAt(date: string, createdAt: string, occurredAt?: string | null): string {
  return rfc3339(notePlace(date, createdAt, occurredAt).at);
}

export function syncRecordOf(kind: BudgetKind, r: Expense | Income): SyncRecord {
  const date = ("expense_date" in r ? r.expense_date : r.date).slice(0, 10);
  const { at, timed } = notePlace(date, r.created_at, r.occurred_at);
  return { kind, id: r.id, date, posted_at: rfc3339(at), ...(timed && { timed: true as const }) };
}

// notYet tells a record dated after today: its note waits for its date,
// so it never sits below what is posted today.
export const notYet = (r: SyncRecord, today: string = format(new Date(), "yyyy-MM-dd")) => r.date > today;

export function chunk<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

const timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const rows = <T>(r: unknown): T[] => (Array.isArray(r) ? (r as T[]) : ((r as { data?: T[] })?.data ?? []));

// syncBudgetNotes sends records to coreban in batches and adds up what it
// created and moved.
// Records dated after today are left for a later sync (notYet).
export async function syncBudgetNotes(records: SyncRecord[]): Promise<SyncResult> {
  const total: SyncResult = { created: 0, moved: 0 };
  for (const batch of chunk(records.filter((r) => !notYet(r)), SYNC_BATCH)) {
    const res = await fetch(`${notesUrl}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ timezone: timezone(), records: batch }),
    });
    if (!res.ok) throw new Error(`Couldn't sync budget notes (error ${res.status})`);
    const r: SyncResult = await res.json();
    total.created += r.created;
    total.moved += r.moved;
  }
  return total;
}

// The most records one corefinance list request returns here; the sync
// reads page after page until a short one.
const PAGE = 1000;

export async function readAll<T>(read: (page: number) => Promise<unknown>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const got = rows<T>(await read(page));
    out.push(...got);
    if (got.length < PAGE) return out;
  }
}

// syncAllBudgetNotes reads every expense and income from corefinance and
// syncs their notes.
export async function syncAllBudgetNotes(): Promise<SyncResult> {
  const [expenses, incomes] = await Promise.all([
    readAll<Expense>((page) => fetchExpenses({ page, page_size: PAGE })),
    readAll<Income>((page) => fetchIncomes({ page, page_size: PAGE })),
  ]);
  return syncBudgetNotes([
    ...expenses.map((e) => syncRecordOf("expense", e)),
    ...incomes.map((i) => syncRecordOf("income", i)),
  ]);
}

// deleteBudgetNote removes the note of a record just deleted from the
// Budget page. A note posted from the Feed stays and keeps the record's
// snapshot (409), and a record without a note (404) needs nothing.
export async function deleteBudgetNote(kind: BudgetKind, id: string): Promise<void> {
  const res = await fetch(`${notesUrl}/records/${kind}/${id}`, { method: "DELETE", credentials: "include" });
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`Couldn't remove this ${kind}'s note (error ${res.status})`);
  }
}
