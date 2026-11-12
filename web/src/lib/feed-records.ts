// Budget records (expenses and incomes) linked from the Feed. They live in
// corefinance, so the Feed reads them there in one batch, remembers on this
// device what it last showed of each, and hands coreban that content as a
// note's snapshot once it finds the record gone (ADR-0003).
import type { BudgetKind, Note, NoteLink, ShownRecord } from "@/types/feed";
import type { Expense, Income } from "@/types/api";
import { apiBaseUrl, fetchExpensesByIds, fetchIncomesByIds } from "@/lib/api";

// isBudgetLink tells a budget record's link from a reminder's or card's.
export const isBudgetLink = (link: NoteLink | null | undefined): link is Extract<NoteLink, { kind: BudgetKind }> =>
  link?.kind === "expense" || link?.kind === "income";

// budgetRecordOf is the expense or income a link shows, once the Feed has it.
export function budgetRecordOf(link: NoteLink): Expense | Income | undefined {
  if (link.kind === "expense") return link.expense;
  if (link.kind === "income") return link.income;
  return undefined;
}

// budgetRecordIds lists the expenses and incomes the Feed must read from
// corefinance: every linked one coreban doesn't already know is gone.
export function budgetRecordIds(notes: Note[]): Record<BudgetKind, string[]> {
  const ids: Record<BudgetKind, string[]> = { expense: [], income: [] };
  for (const n of notes) {
    const l = n.link;
    if (isBudgetLink(l) && !l.deleted) ids[l.kind].push(l.record_id);
  }
  return ids;
}

// BudgetRecords is one batch read from corefinance: the records it
// returned, and every id it was asked for. An id asked for and not
// returned was deleted.
export interface BudgetRecords {
  asked: Set<string>;
  expense: Map<string, Expense>;
  income: Map<string, Income>;
}

// fetchBudgetRecords reads the Feed's linked expenses and incomes from
// corefinance, a hundred at a time.
export async function fetchBudgetRecords(ids: Record<BudgetKind, string[]>): Promise<BudgetRecords> {
  const [expenses, incomes] = await Promise.all([
    ids.expense.length ? fetchExpensesByIds(ids.expense) : [],
    ids.income.length ? fetchIncomesByIds(ids.income) : [],
  ]);
  return {
    asked: new Set([...ids.expense, ...ids.income]),
    expense: new Map(expenses.map((e) => [e.id, e])),
    income: new Map(incomes.map((i) => [i.id, i])),
  };
}

// deleteBudgetRecord deletes an expense or income in corefinance, the
// first of the two steps of archiving its note. One already gone counts.
export async function deleteBudgetRecord(kind: BudgetKind, id: string): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/budget/${kind}s/${encodeURIComponent(id)}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 404) throw new Error(`Couldn't delete this ${kind} (error ${res.status})`);
}

// Shown is what the Feed last showed of each budget record, by id.
export type Shown = Record<string, ShownRecord>;

// rememberShown adds records the Feed just showed, keeping at most cap:
// the most recently shown ones. It relies on object keys keeping insertion
// order, which holds for ids that aren't integers (UUIDs).
export function rememberShown(prev: Shown, records: ShownRecord[], cap = 300): Shown {
  const next: Shown = { ...prev };
  for (const r of records) {
    delete next[r.record.id];
    next[r.record.id] = r;
  }
  const ids = Object.keys(next);
  for (const id of ids.slice(0, Math.max(0, ids.length - cap))) delete next[id];
  return next;
}

// Where Shown lives in localStorage.
export const SHOWN_KEY = "coreban.feed.shown";

// loadShown and saveShown keep Shown on this device, so a record deleted
// while the Feed was closed still leaves its last content behind.
export function loadShown(): Shown {
  try {
    return JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

export function saveShown(shown: Shown): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
  } catch {
    // Storage full or blocked: the Feed works without it.
  }
}

// showBudget fills a budget note in from corefinance's batch read. A
// record it asked for and didn't get is gone: the note reads deleted,
// showing what the Feed last showed of it, which is also the snapshot to
// save (if there is one). Other notes come back as they are.
export function showBudget(
  note: Note,
  records: BudgetRecords | undefined,
  shown: Shown,
): { note: Note; snapshot?: Expense | Income } {
  const l = note.link;
  if (!isBudgetLink(l) || l.deleted || !records?.asked.has(l.record_id)) {
    return { note };
  }
  const live = l.kind === "expense" ? records.expense.get(l.record_id) : records.income.get(l.record_id);
  if (live) return { note: { ...note, link: { ...l, [l.kind]: live } as NoteLink } };
  const last = shown[l.record_id];
  const snapshot = last?.kind === l.kind ? last.record : undefined;
  const link = { kind: l.kind, deleted: true, record_id: l.record_id, ...(snapshot && { [l.kind]: snapshot }) };
  return { note: { ...note, link: link as NoteLink }, snapshot };
}
