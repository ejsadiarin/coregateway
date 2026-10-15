import type { Editor, TLContent } from "tldraw";

// Envelope marking clipboard text as ours. Anything that doesn't parse to
// this shape falls through to tldraw's default text handling.
export interface ClipboardEnvelope {
  app: "coredraw";
  version: 1;
  content: TLContent;
}

export function parseClipboardEnvelope(text: string): TLContent | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    (parsed as ClipboardEnvelope).app === "coredraw" &&
    (parsed as ClipboardEnvelope).version === 1 &&
    typeof (parsed as ClipboardEnvelope).content === "object"
  ) {
    return (parsed as ClipboardEnvelope).content;
  }
  return undefined;
}

// True when keyboard/clipboard events target a text entry surface. Both the
// paste handler here and the `/` menu keydown share this guard.
export function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    !!target &&
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

function selectionContent(editor: Editor): TLContent | undefined {
  const ids = editor.getSelectedShapeIds();
  if (ids.length === 0) return undefined;
  return editor.getContentFromCurrentPage(ids);
}

// Pasting works through a document-level capture listener, not tldraw's
// external-content handlers: tldraw's paste funnel classifies JSON text as
// subtype "json", which has no handling branch, so our envelope would be
// silently dropped. Capture runs before tldraw's bubble-phase document
// listener; stopPropagation keeps tldraw out of envelopes, everything else
// falls through untouched.
export function installJsonPasteHandler(editor: Editor): () => void {
  const onPaste = (e: ClipboardEvent) => {
    if (editor.getEditingShapeId() !== null) return;
    if (isTextEntryTarget(e.target)) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    const content = parseClipboardEnvelope(text);
    if (!content) return;
    e.preventDefault();
    e.stopPropagation();
    editor.putContentOntoCurrentPage(content, { select: true });
  };
  document.addEventListener("paste", onPaste, true);
  return () => document.removeEventListener("paste", onPaste, true);
}

// Serialize the current selection to JSON text and place it on the system
// clipboard. Native copy/paste is untouched; this is the Excalidraw-style
// "copy is JSON" path, pasteable anywhere text goes.
export async function copySelectionAsJson(editor: Editor): Promise<boolean> {
  const content = selectionContent(editor);
  if (!content) return false;
  const envelope: ClipboardEnvelope = { app: "coredraw", version: 1, content };
  await navigator.clipboard.writeText(JSON.stringify(envelope));
  return true;
}

// Fire-and-forget entry point for the shortcut action and the quick menu.
// Failures stay visible in devtools; there is no toast infra to surface
// them, and silently dropping the copy would be worse than a warning.
export function runCopySelectionAsJson(editor: Editor): void {
  void copySelectionAsJson(editor)
    .then((ok) => {
      if (!ok) console.warn("copy-as-json: nothing selected");
    })
    .catch(() => console.warn("copy-as-json: clipboard write denied"));
}
