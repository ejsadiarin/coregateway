import type { Entry, Rule } from "@/lib/ledger";

// Reviewing what recurring rules wrote (corefinance ADR-0001): the pure
// parts behind the ledgers' "New from your rules" section and the report a
// rule save gives after a schedule change.

// StaleEntry is one of a rule's entries its new schedule no longer
// produces, as a rule save returns it. needs_review marks one the owner had
// edited: corefinance keeps it as it is, for them to decide.
export interface StaleEntry {
  id: string;
  date: string;
  status: string;
  needs_review: boolean;
}

export interface StaleReport {
  // review are the edited entries the owner should skip or keep.
  review: StaleEntry[];
  // skipped counts the untouched entries corefinance skipped itself.
  skipped: number;
}

// staleReport is what a rule save's stale entries tell the owner.
export function staleReport(stale: StaleEntry[] | null | undefined): StaleReport {
  const all = stale ?? [];
  return {
    review: all.filter((e) => e.needs_review),
    skipped: all.filter((e) => !e.needs_review && e.status === "skipped").length,
  };
}

// FeedPage is one page of corefinance's "what's new" feed of rule entries
// (GET /rule-entries/feed), as far as reviewing needs it.
export interface FeedPage {
  entries: { kind: "expense" | "income"; id: string }[];
  next: string;
}

// readFeedSince reads the feed after the cursor (from its start without
// one) page after page until a short page, which reaches the feed's end.
// It returns the ids of one kind's entries, in the order they were
// written, and the cursor to read on from next time.
export async function readFeedSince(
  after: string | undefined,
  fetchPage: (after?: string) => Promise<FeedPage>,
  kind: "expense" | "income",
  pageSize: number,
): Promise<{ ids: string[]; next: string | undefined }> {
  const ids: string[] = [];
  let cursor = after;
  for (;;) {
    const page = await fetchPage(cursor);
    for (const e of page.entries) if (e.kind === kind) ids.push(e.id);
    // A cursor that doesn't move would read the same page forever.
    const stuck = page.next === cursor;
    cursor = page.next;
    if (page.entries.length < pageSize || stuck) return { ids, next: cursor };
  }
}

// The review cursor is where the owner last marked a kind's rule entries
// reviewed, kept in this browser only: reviewing on one device leaves
// another as it was. Storage can be missing or throw (a private window,
// blocked site data); then every visit is a first visit.
type CursorStore = Pick<Storage, "getItem" | "setItem">;

const cursorKey = (kind: "expense" | "income") => `rule-review-cursor:${kind}`;

export function loadCursor(kind: "expense" | "income", store: CursorStore | undefined): string | undefined {
  try {
    return store?.getItem(cursorKey(kind)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveCursor(kind: "expense" | "income", cursor: string, store: CursorStore | undefined): void {
  try {
    store?.setItem(cursorKey(kind), cursor);
  } catch {
    // Not kept: the next visit is a first visit.
  }
}

// RuleGroup is one rule's new entries. rule is undefined once the rule
// itself is gone.
export interface RuleGroup {
  ruleId: string;
  rule: Rule | undefined;
  entries: Entry[];
}

// groupNewByRule finds the new entries in the ledger's live entries, so an
// edit or a skip shows at once, and groups them by the rule that made
// them: newest date first within a group, and the group with the newest
// entry first. A new entry no longer in the ledger (deleted) is left out.
export function groupNewByRule(newIds: string[], entries: Entry[], rules: Rule[]): RuleGroup[] {
  const isNew = new Set(newIds);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const groups = new Map<string, RuleGroup>();
  for (const e of entries) {
    if (!isNew.has(e.id) || !e.ruleId) continue;
    let g = groups.get(e.ruleId);
    if (!g) groups.set(e.ruleId, (g = { ruleId: e.ruleId, rule: ruleById.get(e.ruleId), entries: [] }));
    g.entries.push(e);
  }
  const newestFirst = (a: Entry, b: Entry) => b.date.localeCompare(a.date);
  const out = [...groups.values()];
  for (const g of out) g.entries.sort(newestFirst);
  return out.sort((a, b) => newestFirst(a.entries[0], b.entries[0]));
}
