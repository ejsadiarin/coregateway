// Pure drag-and-drop logic for the Kanban board view: where a drop lands,
// and the board as it looks once the card is there. No DOM; the page feeds
// in measured midpoints and applies the result optimistically.
import type { KanbanColumn } from "@/types/kanban";

// dropIndex is the slot a dropped card takes among the target column's
// other cards (the dragged card left out), given their vertical midpoints
// top to bottom: it goes above the first card whose middle is below the
// pointer. This is the index coreban's move endpoint takes.
export function dropIndex(midpoints: number[], pointerY: number): number {
  const i = midpoints.findIndex((mid) => pointerY < mid);
  return i === -1 ? midpoints.length : i;
}

// moveCard returns the columns with cardId placed at index among toColumnId's
// other cards (clamped), taking that column's status. It returns the input
// unchanged when the card or column is unknown, or the card is already there,
// so callers can skip the request.
export function moveCard(
  columns: KanbanColumn[],
  cardId: string,
  toColumnId: string,
  index: number,
): KanbanColumn[] {
  const from = columns.find((c) => c.cards?.some((k) => k.id === cardId));
  const to = columns.find((c) => c.id === toColumnId);
  if (!from || !to) return columns;

  const card = from.cards!.find((k) => k.id === cardId)!;
  const others = (to.cards ?? []).filter((k) => k.id !== cardId);
  const slot = Math.max(0, Math.min(index, others.length));
  if (from === to && from.cards!.indexOf(card) === slot) return columns;

  const placed = { ...card, column_id: to.id, status: to.status };
  return columns.map((c) => {
    if (c === to) return { ...c, cards: [...others.slice(0, slot), placed, ...others.slice(slot)] };
    if (c === from) return { ...c, cards: c.cards!.filter((k) => k.id !== cardId) };
    return c;
  });
}
