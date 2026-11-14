import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchCategories, fetchIncomeCategories } from "@/lib/api";
import { deleteNote, saveSnapshot } from "@/lib/feed";
import {
  budgetRecordIds,
  fetchBudgetRecords,
  loadShown,
  rememberShown,
  saveShown,
  showBudget,
} from "@/lib/feed-records";
import { budgetKeys } from "@/hooks/use-budget";
import type { Note, ShownRecord } from "@/types/feed";

// Names a budget record's category from its id, when it has one.
export type CategoryName = (id: string) => string | undefined;

// useBudgetRecords fills the Feed's expense and income notes in from
// corefinance, in one batch for the loaded Feed. The previous batch stays
// on screen while the next loads; only ids a batch was asked for can read
// as deleted. What it shows is remembered on this device, so a record
// deleted elsewhere still leaves its content on its note, and that content
// is saved once as the note's snapshot (onSnapshot gets the saved note).
// A note the sync made goes with its record instead (coreban ADR-0005):
// it is deleted, and onRemoved gets its id.
export function useBudgetRecords(
  feed: Note[],
  queryKey: readonly unknown[],
  onSnapshot: (note: Note) => void,
  onRemoved: (id: string) => void,
): { notes: Note[]; categoryName: CategoryName } {
  const ids = budgetRecordIds(feed);
  const enabled = ids.expense.length + ids.income.length > 0;
  const records = useQuery({
    queryKey: [...queryKey, "budget", ids],
    queryFn: () => fetchBudgetRecords(ids),
    enabled,
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: budgetKeys.categoriesList(),
    queryFn: fetchCategories,
    staleTime: 300000,
    enabled,
  });
  const incomeCategories = useQuery({
    queryKey: [...budgetKeys.categories(), "income"],
    queryFn: fetchIncomeCategories,
    staleTime: 300000,
    enabled,
  });
  const categoryName: CategoryName = (id) =>
    (categories.data?.find((c) => c.id === id) ?? incomeCategories.data?.find((c) => c.id === id))?.name;

  const [shown, setShown] = useState(loadShown);
  const shownNotes = feed.map((n) => showBudget(n, records.data, shown));

  const data = records.data;
  useEffect(() => {
    if (!data) return;
    const live: ShownRecord[] = [
      ...[...data.expense.values()].map((record) => ({ kind: "expense" as const, record })),
      ...[...data.income.values()].map((record) => ({ kind: "income" as const, record })),
    ];
    if (live.length === 0) return;
    setShown((prev) => {
      const next = rememberShown(prev, live);
      saveShown(next);
      return next;
    });
  }, [data]);

  // Each note's snapshot is sent at most once per batch read: a failed one
  // waits for the next batch (the note reads deleted meanwhile), so a
  // phone offline or a note erased elsewhere never retries on every render.
  const sent = useRef<{ batch: unknown; ids: Set<string> }>({ batch: undefined, ids: new Set() });
  useEffect(() => {
    if (sent.current.batch !== data) sent.current = { batch: data, ids: new Set() };
    shownNotes.forEach(({ note, snapshot }, i) => {
      if (sent.current.ids.has(note.id)) return;
      const gone = note.link?.deleted && !feed[i].link?.deleted;
      if (gone && note.origin === "budget") {
        sent.current.ids.add(note.id);
        deleteNote(note.id).then(() => onRemoved(note.id), () => {});
        return;
      }
      if (!snapshot) return;
      sent.current.ids.add(note.id);
      saveSnapshot(note.id, snapshot).then(onSnapshot, () => {});
    });
  });

  return { notes: shownNotes.map((s) => s.note), categoryName };
}
