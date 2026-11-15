// The pure parts of the Feed's budget notes and its side rail: skipping one
// date of a rule entry, the chips a budget note shows, and the rail's
// calendar, coming-up list and month summary.

import { cadenceLabel, ruleLabel, type Cadence } from "@/lib/ledger";

type Status = "pending" | "posted" | "skipped";

// canSkip tells a record that can be skipped for its date alone: a rule
// entry. A record typed by hand is deleted instead.
export const canSkip = (r: { source_rule_id?: string | null }) => !!r.source_rule_id;

// skipStatus is the status to save to skip a record, or to undo a skip:
// undefined lets its date decide between posted and pending.
export const skipStatus = (current: Status | undefined): Status | undefined =>
  current === "skipped" ? undefined : "skipped";

// BudgetChips are the chips under a budget note: its category, the rule
// that made it ("Monthly · Spotify"; just "rule" once the rule is gone),
// its tags, and its status when that isn't posted.
export interface BudgetChips<C, T> {
  category: C | undefined;
  rule: string | undefined;
  tags: T[];
  status: "pending" | "skipped" | undefined;
}

// budgetChips works out a budget note's chips from its record and the
// owner's categories, rules and tags, as the ledger shows them.
export function budgetChips<C, T>(
  record: { id: string; category_id?: string | null; source_rule_id?: string | null; status?: Status },
  ctx: {
    categoryById: Map<string, C>;
    ruleById: Map<string, { description: string; cadence: Cadence }>;
    tagIds: Map<string, string[]>;
    tagById: Map<string, T>;
  },
): BudgetChips<C, T> {
  const ruleId = record.source_rule_id;
  const rule = ruleId ? ctx.ruleById.get(ruleId) : undefined;
  const status = record.status === "pending" || record.status === "skipped" ? record.status : undefined;
  return {
    category: record.category_id ? ctx.categoryById.get(record.category_id) : undefined,
    rule: !ruleId ? undefined : rule ? `${cadenceLabel(rule.cadence)} · ${rule.description}` : ruleLabel(ruleId, ctx.ruleById),
    tags: (ctx.tagIds.get(record.id) ?? []).flatMap((id) => {
      const t = ctx.tagById.get(id);
      return t ? [t] : [];
    }),
    status,
  };
}
