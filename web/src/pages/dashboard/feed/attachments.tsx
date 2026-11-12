import { useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, Film, ImageOff, Play, RotateCw, X } from "lucide-react";
import { download, type Attachment } from "@/lib/attachments";
import type { PendingFile } from "./use-uploads";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// The files picked for the next note, above the chat box, each with its
// progress, and Retry and Remove once it fails.
export function UploadTray({
  files,
  onRemove,
  onRetry,
  locked,
}: {
  files: PendingFile[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  // While the note posts, its files can't be removed.
  locked: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <ul aria-label="Attachments to send" className="flex gap-2 overflow-x-auto pb-2">
      {files.map((f) => (
        <li
          key={f.key}
          aria-label={f.file.name}
          className={cn(
            "relative flex w-24 shrink-0 flex-col gap-1 rounded-lg border border-border bg-card p-1",
            f.status === "failed" && "border-destructive/60",
          )}
        >
          <div className="flex h-16 items-center justify-center overflow-hidden rounded bg-muted">
            {f.preview ? (
              <img src={f.preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Film className="h-5 w-5 text-muted-foreground" aria-hidden />
            )}
          </div>
          {f.status === "uploading" && (
            <Progress value={Math.round(f.progress * 100)} aria-label={`Uploading ${f.file.name}`} className="h-1" />
          )}
          {f.status === "done" && <span className="sr-only">Uploaded</span>}
          {f.status === "failed" && (
            <>
              <p role="alert" className="line-clamp-3 text-[10px] leading-tight text-destructive">
                {f.error}
              </p>
              {f.retryable && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-11 gap-1 px-1 text-xs"
                  onClick={() => onRetry(f.key)}
                  aria-label={`Retry ${f.file.name}`}
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden />
                  Retry
                </Button>
              )}
            </>
          )}
          {!locked && (
            <button
              type="button"
              onClick={() => onRemove(f.key)}
              aria-label={`Remove ${f.file.name}`}
              className="absolute -right-1 -top-1 flex h-11 w-11 items-start justify-end"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background">
                <X className="h-3 w-3" aria-hidden />
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// --- Showing them in the Feed -------------------------------------------

function Thumb({ a, single }: { a: Attachment; single: boolean }) {
  const src = a.kind === "video" ? a.poster_url : a.url;
  const ratio = single && a.width && a.height ? `${a.width} / ${a.height}` : "1 / 1";
  return (
    <span
      className={cn("relative block overflow-hidden rounded-lg bg-muted", single && "max-h-80")}
      style={{ aspectRatio: ratio }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-muted-foreground">
          {a.kind === "video" ? <Film className="h-6 w-6" aria-hidden /> : <ImageOff className="h-6 w-6" aria-hidden />}
        </span>
      )}
      {a.kind === "video" && (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white">
            <Play className="h-5 w-5" aria-hidden />
          </span>
        </span>
      )}
    </span>
  );
}

// A note's attachments as a grid in its bubble. Tapping one opens the
// viewer on it. Without links (an admin reading someone else's Feed) they
// show as placeholders.
export function AttachmentGrid({ attachments, onOpen }: { attachments: Attachment[]; onOpen: (i: number) => void }) {
  const single = attachments.length === 1;
  return (
    <ul
      aria-label="Attachments"
      className={cn("grid gap-1", single ? "grid-cols-1" : attachments.length > 4 ? "grid-cols-3" : "grid-cols-2")}
    >
      {attachments.map((a, i) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() => onOpen(i)}
            disabled={!a.url}
            aria-label={`Open ${a.kind} ${i + 1} of ${attachments.length}`}
            className="block w-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Thumb a={a} single={single} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function ViewerVideo({ a }: { a: Attachment }) {
  const [failed, setFailed] = useState(false);
  const playable = typeof document !== "undefined" && document.createElement("video").canPlayType(a.content_type) !== "";
  if (failed || !playable) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center text-sm text-white/80">
        <Film className="h-8 w-8" aria-hidden />
        <p>This browser can't play this video. Download it to watch.</p>
      </div>
    );
  }
  return (
    <video
      src={a.url}
      poster={a.poster_url}
      controls
      playsInline
      preload="metadata"
      onError={() => setFailed(true)}
      aria-label="Video"
      className="max-h-full max-w-full"
    />
  );
}

// A full-screen viewer over a note's attachments: swipe or the arrows to
// move between them, Download to save one, close to go back.
export function AttachmentViewer({
  attachments,
  index,
  onIndex,
  onClose,
}: {
  attachments: Attachment[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const touchStart = useRef<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const open = index !== null && attachments[index] !== undefined;
  const a = open ? attachments[index] : null;
  const count = attachments.length;
  const go = (step: number) => {
    if (index === null) return;
    const next = index + step;
    if (next >= 0 && next < count) {
      setSaveError("");
      onIndex(next);
    }
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
          }}
          className="fixed inset-0 z-50 flex flex-col bg-black text-white focus:outline-none"
        >
          <div className="flex items-center justify-between gap-2 px-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Title className="px-2 font-mono text-xs tabular-nums tracking-wide text-white/70">
              {index !== null ? `${index + 1} / ${count}` : ""}
            </DialogPrimitive.Title>
            <div className="flex gap-1">
              {a?.url && (
                <Button
                  variant="ghost"
                  className="min-h-11 text-white hover:bg-white/10 hover:text-white"
                  disabled={saving}
                  onClick={() => {
                    setSaving(true);
                    setSaveError("");
                    download(a)
                      .catch(() => setSaveError("Couldn't download this. Long-press it to save it instead."))
                      .finally(() => setSaving(false));
                  }}
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download
                </Button>
              )}
              <DialogPrimitive.Close asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 text-white hover:bg-white/10 hover:text-white"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" aria-hidden />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          {saveError && (
            <p role="alert" className="px-4 pb-1 text-sm text-red-300">
              {saveError}
            </p>
          )}
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center p-2"
            onPointerDown={(e) => {
              if (e.pointerType !== "mouse") touchStart.current = e.clientX;
            }}
            onPointerUp={(e) => {
              if (touchStart.current === null) return;
              const dx = e.clientX - touchStart.current;
              touchStart.current = null;
              if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
            }}
            onPointerCancel={() => (touchStart.current = null)}
          >
            {a &&
              (a.kind === "video" ? (
                <ViewerVideo key={a.id} a={a} />
              ) : (
                <img key={a.id} src={a.url} alt={`Image ${index! + 1} of ${count}`} className="max-h-full max-w-full object-contain" />
              ))}
            {count > 1 && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-1 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
                  onClick={() => go(-1)}
                  disabled={index === 0}
                  aria-label="Previous"
                >
                  <ChevronLeft className="h-6 w-6" aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-11 w-11 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
                  onClick={() => go(1)}
                  disabled={index === count - 1}
                  aria-label="Next"
                >
                  <ChevronRight className="h-6 w-6" aria-hidden />
                </Button>
              </>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
