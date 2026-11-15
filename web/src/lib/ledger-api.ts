import { apiBaseUrl, throwApiError } from "@/lib/api";
import type { Cadence, LedgerKind, Priority, RawRule } from "@/lib/ledger";
import type { FeedPage, StaleEntry } from "@/lib/rule-review";

// Reads and writes the Expenses and Incomes pages need beyond lib/api:
// rules (paused ones too), every record's tags at once, and tagging.

const budget = `${apiBaseUrl}/api/budget`;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(budget + path, {
    credentials: "include",
    ...init,
    headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
  });
  if (!res.ok) {
    return throwApiError(res, `Request failed (error ${res.status})`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const rulesPath = (kind: LedgerKind) => (kind === "expense" ? "/recurring-expenses" : "/recurring-incomes");

export const fetchRules = (kind: LedgerKind) => call<RawRule[] | null>(`${rulesPath(kind)}?include=paused`).then((r) => r ?? []);

// RuleInput is the whole of a rule: corefinance replaces a rule on update.
export interface RuleInput {
  description: string;
  amount: number;
  currency: string;
  category_id?: string;
  notes?: string;
  priority: Priority;
  recurring_type: Cadence;
  start_date: string;
  end_date?: string;
  is_active?: boolean;
}

// SavedRule is a rule as a save returns it. An update that changed the
// schedule also lists the entries the new schedule no longer produces
// (corefinance ADR-0001).
export type SavedRule = RawRule & { stale_entries?: StaleEntry[] | null };

export const createRule = (kind: LedgerKind, rule: RuleInput) =>
  call<SavedRule>(rulesPath(kind), { method: "POST", body: JSON.stringify(rule) });

export const updateRule = (kind: LedgerKind, id: string, rule: RuleInput) =>
  call<SavedRule>(`${rulesPath(kind)}/${id}`, { method: "PUT", body: JSON.stringify(rule) });

// RULE_FEED_PAGE is the most entries one page of the rule-entry feed
// returns (corefinance caps page_size at 500).
export const RULE_FEED_PAGE = 500;

// fetchRuleFeed reads one page of the "what's new" feed of rule entries,
// after the cursor (from the start without one), with no filters.
export const fetchRuleFeed = (after?: string) =>
  call<FeedPage>(`/rule-entries/feed?page_size=${RULE_FEED_PAGE}${after ? `&after=${encodeURIComponent(after)}` : ""}`);

export interface TagLink {
  record_id: string;
  tag_id: string;
}

export const fetchTagLinks = () =>
  call<{ expenses: TagLink[] | null; incomes: TagLink[] | null }>("/tags/links").then((l) => ({
    expenses: l.expenses ?? [],
    incomes: l.incomes ?? [],
  }));

const recordPath = (kind: LedgerKind, id: string) => `/${kind === "expense" ? "expenses" : "incomes"}/${id}/tags`;

export const addTag = (kind: LedgerKind, recordId: string, tagId: string) =>
  call<void>(recordPath(kind, recordId), { method: "POST", body: JSON.stringify({ tag_id: tagId }) });

export const removeTag = (kind: LedgerKind, recordId: string, tagId: string) =>
  call<void>(`${recordPath(kind, recordId)}/${tagId}`, { method: "DELETE" });
