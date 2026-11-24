import { describe, expect, it } from "vitest";
import { entryInput, entryRequest, type EntryInput } from "./use-ledger";
import type { Entry } from "@/lib/ledger";

const input: EntryInput = {
  description: "dinner",
  amount: 250,
  currency: "PHP",
  date: "2026-11-24",
  priority: "want",
  notes: "",
};

describe("entryRequest", () => {
  it("sends the entry's time with its date", () => {
    expect(entryRequest("expense", { ...input, time: "21:15" })).toMatchObject({ expense_date: "2026-11-24", time: "21:15" });
    expect(entryRequest("income", { ...input, time: "07:00" })).toMatchObject({ date: "2026-11-24", time: "07:00" });
  });

  // corefinance clears the time of an edit without one.
  it("sends no time for an entry without one", () => {
    expect(entryRequest("expense", input)).not.toHaveProperty("time");
    expect(entryRequest("expense", { ...input, time: "" })).not.toHaveProperty("time");
  });
});

// Skipping or unskipping saves the whole entry again; it must keep the time.
describe("entryInput", () => {
  const timed: Entry = {
    id: "e1",
    kind: "expense",
    description: "gym",
    amount: 500,
    currency: "PHP",
    date: "2026-11-24",
    occurredAt: "2026-11-24T10:00:00Z",
    notes: "",
    priority: "need",
    status: "posted",
    ruleId: "r1",
    createdAt: "2026-11-24T10:01:00Z",
  };

  it("keeps an entry's time, read in the owner's zone", () => {
    expect(entryInput(timed, { status: "skipped" }, "Asia/Manila")).toMatchObject({ status: "skipped", time: "18:00" });
  });

  it("leaves an untimed entry untimed", () => {
    expect(entryInput({ ...timed, occurredAt: undefined }, {}, "Asia/Manila").time).toBeUndefined();
  });
});
