import { useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { Archive, Loader2, Reply, X } from "lucide-react";
import { quoteLine } from "@/lib/feed";
import { SWIPE, swipeIntent, swipeOffset } from "@/lib/swipe-reply";
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
// Tapping it goes to the quoted note (onJump), with a spinner while the
// Feed loads its way there; a deleted note's quote goes nowhere.
export function QuoteBlock({
  quote,
  categoryName,
  onJump,
  jumping = false,
}: {
  quote: Quote;
  categoryName: CategoryName;
  onJump?: () => void;
  jumping?: boolean;
}) {
  const thumb = thumbOf(quote.note);
  const body = (
    <>
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
      {jumping ? (
        <Loader2 className="h-4 w-4 shrink-0 self-center animate-spin text-muted-foreground" aria-hidden />
      ) : (
        thumb && <img src={thumb} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
      )}
    </>
  );
  const box = "flex w-full min-w-0 items-stretch gap-2 rounded-lg bg-muted/60 py-1.5 pl-2 pr-2 text-left";
  return (
    <figure aria-label="Replying to" className={cn("mb-1.5 min-w-0", quote.deleted && "italic")}>
      {onJump && !quote.deleted ? (
        <button
          type="button"
          aria-label="Go to the quoted note"
          aria-busy={jumping}
          onClick={(e) => {
            e.stopPropagation();
            onJump();
          }}
          className={cn(box, "hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary")}
        >
          {body}
        </button>
      ) : (
        <div className={box}>{body}</div>
      )}
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

// SwipeToReply lets a finger drag a note left to reply to it, like a chat
// app: the note follows the finger, a reply arrow grows behind it, the
// phone ticks once it is far enough, and letting go there replies. Either
// way the note springs back. Only touch counts (a mouse selects text), and
// only a clearly leftward drag: the page keeps vertical scrolls
// (touch-action: pan-y), and taps reach the note as before.
export function SwipeToReply({ onReply, children }: { onReply: () => void; children: ReactNode }) {
  const x = useMotionValue(0);
  const arrowOpacity = useTransform(x, [0, -SWIPE.mark], [0, 1]);
  const arrowScale = useTransform(x, [0, -SWIPE.mark], [0.4, 1]);
  const reduce = useReducedMotion();
  const drag = useRef<{ id: number; x: number; y: number; mode: "swipe" | "ignore" | null; reached: boolean } | null>(
    null,
  );
  // A swipe ends in a pointerup over the note; the click a browser may
  // send after it, even a while later, isn't a tap. The flag lasts until
  // that click, the next touch, or half a second, whichever comes first.
  const swallowClick = useRef(false);

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode !== "swipe") return;
    swallowClick.current = true;
    window.setTimeout(() => (swallowClick.current = false), 500);
    if (commit && d.reached) onReply();
    animate(x, 0, reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 });
  };

  return (
    <div
      className="relative"
      style={{ touchAction: "pan-y" }}
      onPointerDown={(e) => {
        swallowClick.current = false;
        // A text box being edited keeps its own touches.
        if (e.pointerType !== "touch" || (e.target as Element).closest("textarea, input")) return;
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, mode: null, reached: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.id || d.mode === "ignore") return;
        const dx = e.clientX - d.x;
        if (d.mode === null) {
          d.mode = swipeIntent(dx, e.clientY - d.y);
          if (d.mode !== "swipe") return;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
        const at = swipeOffset(dx);
        x.set(at);
        const reached = at <= -SWIPE.mark;
        if (reached && !d.reached) navigator.vibrate?.(10);
        d.reached = reached;
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <motion.span
        aria-hidden
        style={{ opacity: arrowOpacity, scale: arrowScale }}
        className="pointer-events-none absolute right-2 top-1/2 -mt-4 grid h-8 w-8 place-items-center rounded-full bg-muted text-muted-foreground"
      >
        <Reply className="h-4 w-4" />
      </motion.span>
      <motion.div data-swipe style={{ x }} className="relative">
        {children}
      </motion.div>
    </div>
  );
}
