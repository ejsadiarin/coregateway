import { useCallback, useEffect, useRef, useState } from "react";
import { planFile, roomFor, upload } from "@/lib/attachments";
import { NoteRequestError } from "@/lib/feed";

// A file picked for the next note, from the moment it is picked until the
// note posts.
export interface PendingFile {
  key: string;
  file: File;
  kind: "image" | "video";
  // An object URL to show an image while it uploads.
  preview?: string;
  progress: number;
  status: "uploading" | "done" | "failed";
  error?: string;
  // Whether it failed with the phone offline: it retries itself once back.
  offline?: boolean;
  // Whether Retry can help: a refused file only goes with Remove.
  retryable: boolean;
  // The upload's id once it is up.
  id?: string;
}

let nextKey = 0;

// useUploads holds the files picked for the next note and uploads each as
// soon as it is picked. A failed upload stays with Retry and Remove; one
// that failed offline retries itself when the phone is back online.
// onRefused hears coreban's own refusals (over quota), for the chat box.
// Leaving the Feed stops whatever is still uploading.
export function useUploads(onRefused: (message: string) => void) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const previews = useRef(new Map<string, string>());
  const refused = useRef(onRefused);
  refused.current = onRefused;

  const patch = useCallback(
    (key: string, p: Partial<PendingFile>) => setFiles((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f))),
    [],
  );

  // drop stops and forgets files by key.
  const drop = useCallback((keys: Iterable<string>) => {
    for (const key of keys) {
      controllers.current.get(key)?.abort();
      controllers.current.delete(key);
      const preview = previews.current.get(key);
      if (preview) URL.revokeObjectURL(preview);
      previews.current.delete(key);
    }
  }, []);

  const start = useCallback(
    (f: PendingFile) => {
      const controller = new AbortController();
      controllers.current.set(f.key, controller);
      patch(f.key, { status: "uploading", progress: 0, error: undefined, offline: false });
      upload(f.file, (progress) => patch(f.key, { progress }), controller.signal).then(
        (id) => patch(f.key, { status: "done", progress: 1, id }),
        (err: unknown) => {
          if (controller.signal.aborted) return;
          const offline = !navigator.onLine;
          const message = offline ? "You're offline" : err instanceof Error ? err.message : "Upload failed";
          patch(f.key, { status: "failed", error: message, offline });
          if (err instanceof NoteRequestError) refused.current(message);
        },
      );
    },
    [patch],
  );

  // add takes picked files, up to the note's limit; it says how many it
  // left out.
  const add = (picked: File[]): number => {
    const { take, dropped } = roomFor(files.length, picked.length);
    const added = picked.slice(0, take).map((file): PendingFile => {
      const plan = planFile(file);
      const kind =
        plan.action === "keep" ? plan.kind : plan.action === "refuse" && file.type.startsWith("video/") ? "video" : "image";
      const key = `f${nextKey++}`;
      const preview = kind === "image" && plan.action !== "refuse" ? URL.createObjectURL(file) : undefined;
      if (preview) previews.current.set(key, preview);
      return plan.action === "refuse"
        ? { key, file, kind, progress: 0, status: "failed", error: plan.reason, retryable: false }
        : { key, file, kind, preview, progress: 0, status: "uploading", retryable: true };
    });
    setFiles((fs) => [...fs, ...added]);
    added.filter((f) => f.retryable).forEach(start);
    return dropped;
  };

  const remove = (key: string) => {
    drop([key]);
    setFiles((fs) => fs.filter((x) => x.key !== key));
  };

  const retry = (key: string) => {
    const f = files.find((x) => x.key === key);
    if (f?.retryable && f.status === "failed") start(f);
  };

  // posted takes the files a note just posted out of the tray, leaving any
  // picked since.
  const posted = (keys: string[]) => {
    drop(keys);
    setFiles((fs) => fs.filter((f) => !keys.includes(f.key)));
  };

  // Back online: retry what failed while offline.
  useEffect(() => {
    const online = () => files.filter((f) => f.status === "failed" && f.offline).forEach(start);
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [files, start]);

  // Leaving the Feed: stop every upload and free every preview.
  useEffect(() => {
    const all = controllers.current;
    const shown = previews.current;
    return () => drop(new Set([...all.keys(), ...shown.keys()]));
  }, [drop]);

  const ready = files.length > 0 && files.every((f) => f.status === "done");
  // What a note posted now carries: the tray's keys and their upload ids.
  const sending = ready ? { keys: files.map((f) => f.key), ids: files.map((f) => f.id!) } : null;
  return { files, add, remove, retry, posted, ready, sending };
}
