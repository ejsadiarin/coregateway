import { describe, expect, it } from "vitest";
import { comingUp, comingUpNet, sevenDayWindow } from "./coming-up";
import type { Entry, Rule } from "@/lib/ledger";

const rule = (over: Partial<Rule> & Pick<Rule, "id" | "kind" | "description">): Rule => ({
  amount: 100,
  currency: "PHP",
  cadence: "monthly",
  startDate: "2026-11-19",
  notes: "",
  priority: "want",
  active: true,
  ...over,
});

const entry = (over: Partial<Entry> & Pick<Entry, "id" | "date" | "description">): Entry => ({
  kind: "expense",
  amount: 100,
  currency: "PHP",
  notes: "",
  priority: "want",
  status: "posted",
  createdAt: "",
  ...over,
});

const window = { from: "2026-11-18", until: "2026-11-24" };

describe("sevenDayWindow", () => {
  it("covers today and the six days after it", () => {
    expect(sevenDayWindow(new Date(2026, 10, 18, 15, 30))).toEqual({
      from: "2026-11-18",
      until: "2026-11-24",
    });
  });
});

describe("comingUp", () => {
  it("combines rule dues and future expenses in date order", () => {
    const items = comingUp(
      [rule({ id: "rent", kind: "expense", description: "Rent", cadence: "weekly", startDate: "2026-11-19" })],
      [],
      [rule({ id: "pay", kind: "income", description: "Pay", startDate: "2026-11-20" })],
      [],
      window,
    );
    expect(items.map((i) => [i.date, i.description, i.kind])).toEqual([
      ["2026-11-19", "Rent", "expense"],
      ["2026-11-20", "Pay", "income"],
    ]);
  });

  it("leaves out skipped future expenses, paused rules and dates already written", () => {
    const items = comingUp(
      [
        rule({ id: "rent", kind: "expense", description: "Rent" }),
        rule({ id: "paused", kind: "expense", description: "Paused", active: false }),
      ],
      [entry({ id: "rent-19", date: "2026-11-19", description: "Rent", ruleId: "rent" })],
      [],
      [],
      window,
    );
    // The rent due date is written, so only the future expense remains.
    expect(items.map((i) => i.description)).toEqual(["Rent"]);
    expect(items[0].key).toBe("expense-rent-19");
  });

  it("includes a future-dated expense once and sorts the window", () => {
    const items = comingUp(
      [],
      [
        entry({ id: "installment", date: "2026-11-21", description: "Installment" }),
        entry({ id: "skipped", date: "2026-11-20", description: "Skipped", status: "skipped" }),
        entry({ id: "today", date: "2026-11-18", description: "Today" }),
      ],
      [],
      [],
      window,
    );
    expect(items.map((i) => i.description)).toEqual(["Installment"]);
  });

  it("shows a written income rule date once", () => {
    const items = comingUp(
      [],
      [],
      [rule({ id: "pay", kind: "income", description: "Pay", startDate: "2026-11-20" })],
      [entry({ id: "pay-1", kind: "income", date: "2026-11-20", description: "Pay", ruleId: "pay" })],
      window,
    );
    expect(items.map((i) => [i.date, i.description, i.kind])).toEqual([
      ["2026-11-20", "Pay", "income"],
    ]);
  });

  it("nets income against expenses per currency", () => {
    const items = comingUp(
      [rule({ id: "rent", kind: "expense", description: "Rent" })],
      [],
      [rule({ id: "pay", kind: "income", description: "Pay", amount: 500 })],
      [],
      window,
    );
    expect([...comingUpNet(items)]).toEqual([["PHP", 400]]);
  });
});
