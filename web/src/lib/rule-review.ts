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
