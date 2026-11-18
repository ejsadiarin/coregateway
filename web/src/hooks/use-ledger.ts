import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createExpense, createIncome, createTag, fetchExpenseCategories, fetchExpenses, fetchIncomeCategories, fetchIncomes, isUnknownCategoryError } from "@/lib/api";
import { readAll, syncBudgetNotes, syncRecordOf } from "@/lib/budget-sync";
import { feedKey } from "@/lib/feed";
import { entryOf, ruleOf, skipStatus, today, withHues, type Cadence, type Entry, type LedgerKind, type Priority, type Rule } from "@/lib/ledger";
import { ruleReviewKey } from "@/hooks/use-rule-review";
import { editToPickCategory } from "@/lib/category-error";
import { addTag, createRule, fetchRules, fetchTagLinks, removeTag, updateRule, type RuleInput } from "@/lib/ledger-api";
import {
  budgetKeys,
  categoryListKey,
  GuestBlockedError,
  invalidateMoneyReads,
  saveFailureMessage,
  useCreateExpense,
  useCreateIncome,
  useDeleteExpense,
  useDeleteIncome,
  useUpdateExpense,
  useUpdateIncome,
} from "@/hooks/use-budget";
import { useAuth } from "@/contexts/auth-context";
import { useToast } from "@/components/ui/toast";
import type { Category, Expense, Income, Tag } from "@/types/api";

// The data behind the Expenses and Incomes pages: every entry of one kind,
// its rules (paused ones too), its categories and the tags on each entry.

const recordsKey = (kind: LedgerKind) => [...(kind === "expense" ? budgetKeys.expenses() : budgetKeys.incomes()), "all"] as const;
const rulesKey = (kind: LedgerKind) =>
  [...(kind === "expense" ? budgetKeys.recurringExpenses() : budgetKeys.recurringIncomes()), "withPaused"] as const;
const tagLinksKey = [...budgetKeys.tags(), "links"] as const;
const PAGE = 1000;

export function useEntries(kind: LedgerKind) {
  return useQuery<Entry[]>({
    queryKey: recordsKey(kind),
    queryFn: async () => {
      const rows =
        kind === "expense"
          ? await readAll<Expense>((page) => fetchExpenses({ page, page_size: PAGE }))
          : await readAll<Income>((page) => fetchIncomes({ page, page_size: PAGE }));
      return rows.map((r) => entryOf(kind, r));
    },
    staleTime: 60000,
  });
}

export function useRules(kind: LedgerKind) {
  return useQuery<Rule[]>({
    queryKey: rulesKey(kind),
    queryFn: async () => (await fetchRules(kind)).map((r) => ruleOf(kind, r)),
    staleTime: 60000,
  });
}

export function useKindCategories(kind: LedgerKind) {
  return useQuery<Category[]>({
    queryKey: categoryListKey(kind),
    queryFn: async () => (await (kind === "expense" ? fetchExpenseCategories() : fetchIncomeCategories())) ?? [],
    // Each category gets a color of its own here, so every chip agrees.
    select: withHues,
    staleTime: 300000,
  });
}

// useEntryTags maps each entry of a kind to the ids of its tags.
export function useEntryTags(kind: LedgerKind) {
  const q = useQuery({ queryKey: tagLinksKey, queryFn: fetchTagLinks, staleTime: 60000 });
  const byRecord = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of (kind === "expense" ? q.data?.expenses : q.data?.incomes) ?? []) {
      m.set(l.record_id, [...(m.get(l.record_id) ?? []), l.tag_id]);
    }
    return m;
  }, [q.data, kind]);
  return byRecord;
}

// EntryInput is what the new-entry sheet collects for a single entry.
export interface EntryInput {
  description: string;
  amount: number;
  currency: string;
  date: string;
  categoryId?: string;
  priority: Priority;
  notes: string;
  marker?: string;
  status?: Entry["status"];
  ruleId?: string;
}

// TagPick is a tag picked in the sheet: an existing one, or a new name.
export type TagPick = { id: string; name: string } | { id?: undefined; name: string };

function body(kind: LedgerKind, e: EntryInput) {
  const shared = {
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    category_id: e.categoryId,
    notes: [e.marker, e.notes].filter(Boolean).join(" ") || undefined,
    priority: e.priority,
    recurring_type: "one-time" as const,
    status: e.status ?? (e.date > today() ? "pending" : "posted"),
    source_rule_id: e.ruleId,
  };
  return kind === "expense" ? { ...shared, expense_date: e.date, is_debt: false } : { ...shared, date: e.date };
}

// useSaveEntry creates or updates an entry and sets its tags.
export function useSaveEntry(kind: LedgerKind) {
  const qc = useQueryClient();
  const { isGuest } = useAuth();
  const createE = useCreateExpense();
  const updateE = useUpdateExpense();
  const createI = useCreateIncome();
  const updateI = useUpdateIncome();

  return useMutation({
    mutationFn: async ({
      id,
      input,
      tags,
      hadTags = [],
      fromFeed = false,
    }: {
      id?: string;
      input: EntryInput;
      tags?: TagPick[];
      hadTags?: string[];
      // A new entry captured in the Feed gets the note the Feed posts for
      // it, not a synced one.
      fromFeed?: boolean;
    }) => {
      const b = body(kind, input);
      let record: Expense | Income;
      if (fromFeed && !id) {
        if (isGuest) throw new GuestBlockedError();
        record = kind === "expense" ? await createExpense(b as Parameters<typeof createExpense>[0]) : await createIncome(b as Parameters<typeof createIncome>[0]);
        qc.invalidateQueries({ queryKey: budgetKeys.all });
      } else if (kind === "expense") {
        // The cast drops the income-only shape; body() built an expense.
        record = id
          ? await updateE.mutateAsync({ id, data: b as Parameters<typeof updateE.mutateAsync>[0]["data"] })
          : await createE.mutateAsync(b as Parameters<typeof createE.mutateAsync>[0]);
      } else {
        record = id
          ? await updateI.mutateAsync({ id, data: b as Parameters<typeof updateI.mutateAsync>[0]["data"] })
          : await createI.mutateAsync(b as Parameters<typeof createI.mutateAsync>[0]);
      }
      if (tags) {
        const want: string[] = [];
        for (const t of tags) want.push(t.id ?? (await createTag({ name: t.name })).id);
        for (const t of want) if (!hadTags.includes(t)) await addTag(kind, record.id, t);
        for (const t of hadTags) if (!want.includes(t)) await removeTag(kind, record.id, t);
      }
      return record;
    },
    onError: (error) => {
      // A refused category is gone from the fixed list; read it again so the
      // next pick can only name a current one.
      if (isUnknownCategoryError(error)) qc.invalidateQueries({ queryKey: categoryListKey(kind) });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: budgetKeys.tags() });
    },
  });
}

export function useDeleteEntry(kind: LedgerKind) {
  const e = useDeleteExpense();
  const i = useDeleteIncome();
  return kind === "expense" ? e : i;
}

// useSaveRule creates a rule or replaces one (edit, pause, resume, end).
// A new rule due today makes today's entry at once, so the entries and the
// Feed read again.
export function useSaveRule(kind: LedgerKind) {
  const qc = useQueryClient();
  const { isGuest } = useAuth();
  return useMutation({
    mutationFn: ({ id, rule }: { id?: string; rule: RuleInput }) => {
      if (isGuest) throw new GuestBlockedError();
      return id ? updateRule(kind, id, rule) : createRule(kind, rule);
    },
    onError: (error) => {
      if (isUnknownCategoryError(error)) qc.invalidateQueries({ queryKey: categoryListKey(kind) });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: kind === "expense" ? budgetKeys.recurringExpenses() : budgetKeys.recurringIncomes() });
      await qc.invalidateQueries({ queryKey: recordsKey(kind) });
      // A save runs the materialize pass, which can write rule entries.
      qc.invalidateQueries({ queryKey: ruleReviewKey });
      invalidateMoneyReads(qc);
      // Today's new entry gets its Feed note.
      const records = qc.getQueryData<Entry[]>(recordsKey(kind)) ?? [];
      const fresh = records.filter((r) => r.ruleId && r.createdAt > new Date(Date.now() - 60000).toISOString());
      if (fresh.length) {
        syncBudgetNotes(
          fresh.map((r) =>
            syncRecordOf(kind, kind === "expense"
              ? ({ id: r.id, expense_date: r.date, created_at: r.createdAt } as Expense)
              : ({ id: r.id, date: r.date, created_at: r.createdAt } as Income)),
          ),
        )
          .then(() => qc.invalidateQueries({ queryKey: feedKey }))
          .catch(() => {});
      }
    },
  });
}

// ruleInput is the whole of a rule to send back with some fields changed.
export function ruleInput(r: Rule, change: Partial<RuleInput> = {}): RuleInput {
  return {
    description: r.description,
    amount: r.amount,
    currency: r.currency,
    category_id: r.categoryId,
    notes: r.notes || undefined,
    priority: r.priority,
    recurring_type: r.cadence as Cadence,
    start_date: r.startDate,
    end_date: r.endDate,
    is_active: r.active,
    ...change,
  };
}

// entryInput is the whole of an entry to save back with some fields
// changed, such as its status to skip it.
export function entryInput(e: Entry, change: Partial<EntryInput> = {}): EntryInput {
  return {
    description: e.description,
    amount: e.amount,
    currency: e.currency,
    date: e.date,
    categoryId: e.categoryId,
    priority: e.priority,
    notes: e.notes,
    marker: e.marker,
    status: e.status,
    ruleId: e.ruleId,
    ...change,
  };
}

// useToggleSkip skips a rule entry for its date alone, or undoes that
// (skipStatus), from any page: the Feed, an entry's popup, "New from your
// rules". It says what went wrong itself and resolves whether it worked.
export function useToggleSkip() {
  const qc = useQueryClient();
  const { showToast } = useToast();
  const saveExpense = useSaveEntry("expense");
  const saveIncome = useSaveEntry("income");
  const toggle = async (e: Entry): Promise<boolean> => {
    const save = e.kind === "expense" ? saveExpense : saveIncome;
    try {
      await save.mutateAsync({ id: e.id, input: entryInput(e, { status: skipStatus(e.status) }) });
      // The note shows the record's new status even if its sync is slow.
      qc.invalidateQueries({ queryKey: feedKey });
      return true;
    } catch (err) {
      showToast(saveFailureMessage(err, "Couldn't do that: ", editToPickCategory("entry")), "error");
      return false;
    }
  };
  return { toggle, pending: saveExpense.isPending || saveIncome.isPending };
}

// tagsOf names the tags of an entry.
export function tagsOf(ids: string[] | undefined, tags: Tag[] | undefined): Tag[] {
  if (!ids?.length || !tags) return [];
  const byId = new Map(tags.map((t) => [t.id, t]));
  return ids.map((id) => byId.get(id)).filter((t): t is Tag => !!t);
}
