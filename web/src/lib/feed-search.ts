// Searching the Feed (coreban#18). coreban finds notes by what it holds;
// live expenses and incomes are in corefinance, so the web matches those
// and names them in the search (coreban ADR-0003 keeps their text out of
// coreban).
import type { BudgetKind } from "@/types/feed";
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
