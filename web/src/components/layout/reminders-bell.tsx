import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format, isToday, isTomorrow } from "date-fns";
import { Bell, BellOff, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchKanbanReminders, remindersKey } from "@/lib/kanban";
import { bellOf } from "@/lib/reminder-bell";
import { CLOCK } from "@/lib/format";
import type { KanbanReminder } from "@/types/kanban";

// when says when a reminder next goes out, on this device's clock.
function when(iso: string): string {
  const at = new Date(iso);
  const day = isToday(at) ? "Today" : isTomorrow(at) ? "Tomorrow" : format(at, "EEE d MMM");
  return `${day}, ${format(at, CLOCK)}`;
}

const held: Record<NonNullable<KanbanReminder["paused"]>, string> = {
  no_notification_target: "won't send: no notification target",
  card_completed: "quiet: its card is Done",
  card_archived: "quiet: its card is archived",
};

// RemindersBell is the header's bell: the owner's next reminders from
// coreban, with a badge for those going out in the next day.
export function RemindersBell() {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: remindersKey,
    queryFn: () => fetchKanbanReminders(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const bell = bellOf(query.data ?? [], new Date());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 text-muted-foreground hover:bg-primary/10 hover:text-primary"
          aria-label={bell.dueSoon ? `Reminders, ${bell.dueSoon} in the next day` : "Reminders"}
        >
          <Bell className="h-4 w-4" />
          {bell.dueSoon > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] text-destructive-foreground">
              {bell.dueSoon > 9 ? "9+" : bell.dueSoon}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reminders</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {bell.noTarget && (
          <DropdownMenuItem onClick={() => navigate("/dashboard/settings#reminders")} className="items-start gap-2 text-destructive">
            <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="text-xs leading-snug">No notification target, so nothing will be sent. Set one in Settings.</span>
          </DropdownMenuItem>
        )}

        {query.isLoading && <p className="px-2 py-3 text-xs text-muted-foreground">Loading…</p>}
        {query.isError && <p className="px-2 py-3 text-xs text-destructive">Couldn't load your reminders.</p>}
        {query.isSuccess && bell.upcoming.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">Nothing coming up.</p>
        )}

        {bell.upcoming.map((r) => (
          <DropdownMenuItem
            key={r.id}
            onClick={() => navigate(r.card ? `/dashboard/kanban/${r.card.board_id}` : "/dashboard/kanban/reminders")}
            className="flex flex-col items-start gap-0.5"
          >
            <span className="w-full truncate text-sm">{r.message}</span>
            <span className="text-xs text-muted-foreground">
              {when(r.next_fire_at!)}
              {r.card && ` · ${r.card.title}`}
            </span>
            {r.paused && <span className="text-xs text-destructive">{held[r.paused]}</span>}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate("/dashboard/kanban/reminders")}>
          {bell.more > 0 ? `All reminders (${bell.more} more)` : "All reminders"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate("/dashboard/settings#reminders")}>
          <Settings2 className="mr-2 h-3.5 w-3.5" aria-hidden />
          Notification settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
