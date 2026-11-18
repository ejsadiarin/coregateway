import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDueToday } from '@/hooks/use-home';

function reminderTime(at: string | null): string {
  return at ? format(parseISO(at), 'HH:mm') : '—';
}

export function DueTodayCard({ className }: { className?: string }) {
  const { data, isLoading, error } = useDueToday();

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Due today</CardTitle>
          <Link to="/dashboard/kanban/reminders" className="flex items-center gap-1 text-xs text-primary hover:underline">
            Reminders <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">Couldn't load what's due today.</p>
        ) : !data || (data.reminders.length === 0 && data.cards.length === 0) ? (
          <p className="text-sm text-muted-foreground">Nothing due today.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {data.reminders.map((reminder) => (
              <Link
                key={reminder.id}
                to="/dashboard/kanban/reminders"
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-accent/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{reminder.message}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Reminder</p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums">{reminderTime(reminder.next_fire_at)}</span>
              </Link>
            ))}
            {data.cards.map((card) => (
              <Link
                key={card.id}
                to={`/dashboard/kanban/${card.board_id}`}
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-accent/30"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{card.title}</p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {card.boardName}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {card.due && 'date' in card.due ? 'All day' : card.due && 'at' in card.due ? format(parseISO(card.due.at), 'HH:mm') : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
