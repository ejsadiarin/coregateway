import { Archive, Reply, X } from "lucide-react";
import { quoteLine } from "@/lib/feed";
import type { Note, Quote } from "@/types/feed";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CategoryName } from "./use-budget-records";

// thumbOf is the picture a quote shows of a note with attachments: its
// first image, or its first video's poster.
function thumbOf(note: Note | null): string | undefined {
  const a = note?.attachments?.[0];
  return a?.kind === "image" ? a.url : a?.poster_url;
}

// QuoteBlock is the note a reply answers, drawn inside the reply's bubble
// the way a chat app does: muted, behind an accent bar, two lines at most,
// with a thumbnail when the note has pictures. An archived note is still
// quoted, tagged; a permanently deleted one reads "Note deleted".
export function QuoteBlock({ quote, categoryName }: { quote: Quote; categoryName: CategoryName }) {
  const thumb = thumbOf(quote.note);
  return (
    <figure
      aria-label="Replying to"
      className={cn(
        "mb-1.5 flex min-w-0 items-stretch gap-2 rounded-lg bg-muted/60 py-1.5 pl-2 pr-2 text-left",
        quote.deleted && "italic",
      )}
    >
      <span className="w-0.5 shrink-0 rounded-full bg-primary/70" aria-hidden />
      <div className="min-w-0 flex-1">
        {quote.note?.archived_at && (
          <span className="mb-0.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            <Archive className="h-3 w-3" aria-hidden />
            Archived
          </span>
        )}
        <p className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
          {quoteLine(quote, new Date().getFullYear(), categoryName)}
        </p>
      </div>
      {thumb && <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
    </figure>
  );
}

// ReplyBar sits above the composer while a reply is being written: what it
// answers, and a way out.
export function ReplyBar({
  note,
  categoryName,
  onCancel,
}: {
  note: Note;
  categoryName: CategoryName;
  onCancel: () => void;
}) {
  const thumb = thumbOf(note);
  return (
    <section aria-label="Replying to" className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-card py-1.5 pl-2">
      <span className="w-0.5 self-stretch rounded-full bg-primary" aria-hidden />
      <Reply className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Replying to note</p>
        <p className="truncate text-sm">
          {quoteLine({ deleted: false, note }, new Date().getFullYear(), categoryName)}
        </p>
      </div>
      {thumb && <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />}
      <Button type="button" variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Cancel reply" onClick={onCancel}>
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </section>
  );
}
