import { describe, expect, it } from "vitest";
import { columnOption, newCardColumn } from "@/lib/kanban-columns";

describe("columnOption", () => {
  it("adds the status when the column's name differs from it", () => {
    expect(columnOption({ name: "Doing", status: "in_progress" })).toBe("Doing · In progress");
  });

  it("names just the column when it is named after its status, in any case", () => {
    expect(columnOption({ name: "done ", status: "done" })).toBe("done ");
    expect(columnOption({ name: "Todo", status: "todo" })).toBe("Todo");
  });
});

describe("newCardColumn", () => {
  const col = (id: string, status: "todo" | "in_progress" | "done") => ({ id, status });

  it("is the asked-for column when the board still has it", () => {
    expect(newCardColumn([col("a", "todo"), col("b", "done")], "b")).toBe("b");
  });

  it("is the first Todo column by default, wherever it sits", () => {
    expect(newCardColumn([col("a", "in_progress"), col("b", "todo"), col("c", "todo")])).toBe("b");
  });

  it("falls back to the default when the asked-for column is gone", () => {
    expect(newCardColumn([col("a", "todo")], "gone")).toBe("a");
  });

  it("is the first column when the board has no Todo column, and empty when it has none", () => {
    expect(newCardColumn([col("a", "in_progress"), col("b", "done")])).toBe("a");
    expect(newCardColumn([])).toBe("");
  });
});
