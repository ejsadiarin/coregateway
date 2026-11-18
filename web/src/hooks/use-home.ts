import { useQuery } from "@tanstack/react-query";
import { isSameDay, parseISO } from "date-fns";
import { fetchFeed, feedKey } from "@/lib/feed";
import { fetchKanbanBoard, fetchKanbanBoards, fetchKanbanReminders } from "@/lib/kanban";
import type { Note } from "@/types/feed";
import type { KanbanCard, KanbanReminder } from "@/types/kanban";

export const homeKeys = {
  latestNotes: () => [...feedKey, "latest"] as const,
  dueToday: () => ["coreban", "home", "due-today"] as const,
};

export interface DueCard extends KanbanCard {
  boardName: string;
}

export interface DueToday {
  reminders: KanbanReminder[];
  cards: DueCard[];
}

function dueOn(card: KanbanCard, today: Date): boolean {
  if (!card.due) return false;
  const date = "date" in card.due ? parseISO(card.due.date) : parseISO(card.due.at);
  return isSameDay(date, today);
}

// useLatestNotes reads the newest unarchived notes for Home's summary.
export function useLatestNotes() {
  return useQuery<Note[]>({
    queryKey: homeKeys.latestNotes(),
    queryFn: async () => {
      const page = await fetchFeed(undefined, "all");
      return page.notes.filter((note) => !note.archived_at).slice(-3).reverse();
    },
    staleTime: 60000,
    retry: false,
  });
}

// useDueToday combines today's reminders with cards due today across the
// owner's boards. One unreadable board is skipped rather than failing the
// whole section.
export function useDueToday() {
  return useQuery<DueToday>({
    queryKey: homeKeys.dueToday(),
    queryFn: async () => {
      const today = new Date();
      const [reminders, boards] = await Promise.all([
        fetchKanbanReminders(),
        fetchKanbanBoards(),
      ]);
      const loaded = await Promise.allSettled(boards.map((board) => fetchKanbanBoard(board.id)));

      const cards: DueCard[] = [];
      for (const result of loaded) {
        if (result.status !== "fulfilled") continue;
        const board = result.value;
        for (const column of board.columns ?? []) {
          for (const card of column.cards ?? []) {
            if (card.archived_at || card.status === "done" || !dueOn(card, today)) continue;
            cards.push({ ...card, boardName: board.name });
          }
        }
      }

      return {
        reminders: reminders.filter(
          (reminder) => reminder.next_fire_at && isSameDay(parseISO(reminder.next_fire_at), today),
        ),
        cards,
      };
    },
    staleTime: 60000,
    retry: false,
  });
}
