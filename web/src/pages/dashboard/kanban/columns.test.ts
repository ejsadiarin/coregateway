import { describe, expect, it } from "vitest";
import { columnOption } from "./columns";

describe("columnOption", () => {
  it("adds the status when the column's name differs from it", () => {
    expect(columnOption({ name: "Doing", status: "in_progress" })).toBe("Doing · In progress");
  });

  it("names just the column when it is named after its status, in any case", () => {
    expect(columnOption({ name: "done ", status: "done" })).toBe("done ");
    expect(columnOption({ name: "Todo", status: "todo" })).toBe("Todo");
  });
});
