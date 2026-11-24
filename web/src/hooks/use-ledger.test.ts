import { describe, expect, it } from "vitest";
import { entryRequest, type EntryInput } from "./use-ledger";

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
