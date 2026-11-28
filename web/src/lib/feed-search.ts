// Searching the Feed (coreban#18). coreban finds notes by what it holds;
// live expenses and incomes are in corefinance, so the web matches those
// and names them in the search (coreban ADR-0003 keeps their text out of
// coreban).
import type { BudgetKind, FeedFilter, Note } from "@/types/feed";
import type { FeedData } from "@/lib/feed";
import { today, type Entry } from "@/lib/ledger";

// coreban's caps on one search.
export const MAX_SEARCH_LENGTH = 200;
export const MAX_SEARCH_RECORDS = 1000;

export interface RecordRef {
  kind: BudgetKind;
  id: string;
}

// searchWords splits a search into its words, every one of which must match.
export const searchWords = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);

// searchAmount is a word as it would look in an amount ("₱1,250" is
// "1250"), or empty for one that isn't a number.
function searchAmount(word: string): string {
  const digits = word.replace(/[₱,]/g, "");
  return /^[\d.]*\d[\d.]*$/.test(digits) ? digits : "";
}

function matches(e: Entry, words: string[], categoryName: (id: string) => string | undefined): boolean {
  const text = [e.description, e.notes, e.categoryId && categoryName(e.categoryId)].filter(Boolean).join("\n").toLowerCase();
  const amount = e.amount.toFixed(2);
  return words.every((w) => {
    if (text.includes(w)) return true;
    const digits = searchAmount(w);
    return digits !== "" && amount.includes(digits);
  });
}

// matchRecords finds the expenses and incomes showing every word of q in
// their description, notes, category or amount: the newest
// MAX_SEARCH_RECORDS of them, and how many there were. A record dated after
// today has no note yet, so it is never one of them.
export function matchRecords(
  q: string,
  entries: Entry[],
  categoryName: (id: string) => string | undefined,
  now: string = today(),
): { records: RecordRef[]; total: number } {
  const words = searchWords(q);
  if (words.length === 0) return { records: [], total: 0 };
  const hits = entries
    .filter((e) => e.date <= now && matches(e, words, categoryName))
    .sort((a, b) => b.date.localeCompare(a.date));
  return { records: hits.slice(0, MAX_SEARCH_RECORDS).map(({ kind, id }) => ({ kind, id })), total: hits.length };
}

// searchSavedNotes is the Feed's search with no connection: only the notes
// saved on this device (the Feed's cached views), each found by every word
// of q in its text, its reminder or its card, or for a budget note by its
// record being one of records (matchRecords over the saved budget). It
// follows the Feed's filter and archive toggle; oldest first, like the Feed.
export function searchSavedNotes(
  saved: FeedData[],
  q: string,
  { filter, withArchived, records }: { filter: FeedFilter; withArchived: boolean; records: RecordRef[] },
): Note[] {
  const words = searchWords(q);
  if (words.length === 0) return [];
  const budget = new Set(records.map((r) => `${r.kind}:${r.id}`));
  const found = new Map<string, Note>();
  for (const data of saved) {
    for (const page of data.pages) {
      for (const n of page.notes) {
        if (found.has(n.id) || (n.archived_at && !withArchived)) continue;
        const l = n.link;
        const isBudget = l?.kind === "expense" || l?.kind === "income";
        if ((filter === "budget" && !isBudget) || (filter === "notes" && isBudget)) continue;
        const hit =
          l?.kind === "expense" || l?.kind === "income"
            ? budget.has(`${l.kind}:${l.record_id}`)
            : noteMatches(n, words);
        if (hit) found.set(n.id, n);
      }
    }
  }
  return [...found.values()].sort((a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at));
}

function noteMatches(n: Note, words: string[]): boolean {
  const l = n.link;
  const text = [n.text, l?.kind === "reminder" && l.reminder?.message, l?.kind === "card" && l.card?.title]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}
