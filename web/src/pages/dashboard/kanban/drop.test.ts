import { describe, it, expect } from "vitest";
import { dropIndex, moveCard } from "@/pages/dashboard/kanban/drop";
import type { KanbanCard, KanbanColumn, KanbanStatus } from "@/types/kanban";

describe("dropIndex", () => {
  // Midpoints of the column's other cards, top to bottom, in client pixels.
  const mids = [100, 160, 220];

  it("drops into an empty column at the top", () => {
    expect(dropIndex([], 500)).toBe(0);
  });

  it("drops above the first card when the pointer is above its middle", () => {
    expect(dropIndex(mids, 40)).toBe(0);
    expect(dropIndex(mids, 99)).toBe(0);
  });

  it("drops between the two cards whose middles straddle the pointer", () => {
    expect(dropIndex(mids, 101)).toBe(1);
    expect(dropIndex(mids, 190)).toBe(2);
  });

  it("drops after the last card when the pointer is below its middle", () => {
    expect(dropIndex(mids, 221)).toBe(3);
    expect(dropIndex(mids, 9000)).toBe(3);
  });

  it("drops below a card when the pointer is exactly on its middle", () => {
    expect(dropIndex(mids, 160)).toBe(2);
  });
});

function card(id: string, columnId: string, status: KanbanStatus): KanbanCard {
  return {
    id,
    board_id: "b",
    column_id: columnId,
    status,
    title: id.toUpperCase(),
    description: "",
    due: null,
    archived_at: null,
    created_at: "",
    updated_at: "",
  };
}

function board(): KanbanColumn[] {
  return [
    { id: "todo", name: "Todo", status: "todo", position: 0, cards: [card("a", "todo", "todo"), card("b", "todo", "todo"), card("c", "todo", "todo")] },
    { id: "doing", name: "Doing", status: "in_progress", position: 1, cards: [card("d", "doing", "in_progress")] },
    { id: "done", name: "Done", status: "done", position: 2, cards: [] },
  ];
}

const ids = (cols: KanbanColumn[]) => Object.fromEntries(cols.map((c) => [c.id, (c.cards ?? []).map((k) => k.id)]));

describe("moveCard", () => {
  it("reorders within a column, indexing among the column's other cards", () => {
    expect(ids(moveCard(board(), "a", "todo", 2))).toEqual({ todo: ["b", "c", "a"], doing: ["d"], done: [] });
    expect(ids(moveCard(board(), "c", "todo", 0))).toEqual({ todo: ["c", "a", "b"], doing: ["d"], done: [] });
    expect(ids(moveCard(board(), "c", "todo", 1))).toEqual({ todo: ["a", "c", "b"], doing: ["d"], done: [] });
  });

  it("moves to another column and takes that column's status", () => {
    const moved = moveCard(board(), "b", "doing", 0);
    expect(ids(moved)).toEqual({ todo: ["a", "c"], doing: ["b", "d"], done: [] });
    const b = moved[1].cards![0];
    expect(b.column_id).toBe("doing");
    expect(b.status).toBe("in_progress");
  });

  it("moves into an empty column", () => {
    const moved = moveCard(board(), "d", "done", 0);
    expect(ids(moved)).toEqual({ todo: ["a", "b", "c"], doing: [], done: ["d"] });
    expect(moved[2].cards![0].status).toBe("done");
  });

  it("clamps an index past either end", () => {
    expect(ids(moveCard(board(), "a", "todo", 99)).todo).toEqual(["b", "c", "a"]);
    expect(ids(moveCard(board(), "c", "todo", -3)).todo).toEqual(["c", "a", "b"]);
  });

  it("returns the same columns when the drop lands where the card already is", () => {
    const cols = board();
    expect(moveCard(cols, "b", "todo", 1)).toBe(cols);
  });

  it("returns the same columns for an unknown card or column", () => {
    const cols = board();
    expect(moveCard(cols, "zz", "todo", 0)).toBe(cols);
    expect(moveCard(cols, "a", "nowhere", 0)).toBe(cols);
  });

  it("does not mutate the input", () => {
    const cols = board();
    moveCard(cols, "a", "done", 0);
    expect(ids(cols)).toEqual(ids(board()));
    expect(cols[0].cards![0].status).toBe("todo");
  });
});
