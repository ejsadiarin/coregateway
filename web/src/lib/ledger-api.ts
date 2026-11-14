import { apiBaseUrl } from "@/lib/api";
import type { Cadence, LedgerKind, Priority, RawRule } from "@/lib/ledger";

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
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || body?.message || `Request failed (error ${res.status})`);
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

export const createRule = (kind: LedgerKind, rule: RuleInput) =>
  call<RawRule>(rulesPath(kind), { method: "POST", body: JSON.stringify(rule) });

export const updateRule = (kind: LedgerKind, id: string, rule: RuleInput) =>
  call<RawRule>(`${rulesPath(kind)}/${id}`, { method: "PUT", body: JSON.stringify(rule) });

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
