import { formatDistanceToNow, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLatestNotes } from '@/hooks/use-home';
import type { Note } from '@/types/feed';

function noteLabel(note: Note): string {
  const text = note.text.trim();
  if (text) return text;
  switch (note.link?.kind) {
    case 'reminder':
      return note.link.reminder?.message ?? 'Reminder';
    case 'card':
      return note.link.card?.title ?? 'Card';
    case 'expense':
      return 'Expense';
    case 'income':
      return 'Income';
    default:
      return 'Note';
  }
}

export function LatestNotesCard({ className }: { className?: string }) {
  const { data, isLoading, error } = useLatestNotes();

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Latest notes</CardTitle>
          <Link to="/dashboard/feed" className="flex items-center gap-1 text-xs text-primary hover:underline">
            Open Feed <ArrowRight className="h-3 w-3" />
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
          <p className="text-sm text-muted-foreground">Couldn't load your notes.</p>
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {data.map((note) => (
              <Link
                key={note.id}
                to="/dashboard/feed"
                className="flex items-center justify-between gap-3 py-2.5 hover:bg-accent/30"
              >
                <p className="min-w-0 truncate text-sm">{noteLabel(note)}</p>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {formatDistanceToNow(parseISO(note.posted_at), { addSuffix: true })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
