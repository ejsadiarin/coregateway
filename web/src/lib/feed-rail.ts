// The pure parts of the Feed's budget notes and its side rail: skipping one
// date of a rule entry, the chips a budget note shows, and the rail's
// calendar, coming-up list and month summary.

type Status = "pending" | "posted" | "skipped";

// canSkip tells a record that can be skipped for its date alone: a rule
// entry. A record typed by hand is deleted instead.
export const canSkip = (r: { source_rule_id?: string | null }) => !!r.source_rule_id;

// skipStatus is the status to save to skip a record, or to undo a skip:
// undefined lets its date decide between posted and pending.
export const skipStatus = (current: Status | undefined): Status | undefined =>
  current === "skipped" ? undefined : "skipped";
