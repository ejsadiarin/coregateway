// Doc pane for coredraw (ticket 07): markdown notes beside the canvas.
//
// Plain editing plus preview only — no rich-text dependency. Editing is a
// <textarea>; preview renders via react-markdown, which builds React
// elements (no dangerouslySetInnerHTML), so pasted markdown can't inject
// scripts. The doc string itself lives in the board meta in page.tsx and
// rides the same debounced save as the canvas snapshot.

import { useState } from "react";
import ReactMarkdown from "react-markdown";

type Tab = "edit" | "preview";

export function DocPane({ doc, onChange }: { doc: string; onChange: (doc: string) => void }) {
  const [tab, setTab] = useState<Tab>("edit");

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded px-2 py-1 text-xs font-medium capitalize ${
              tab === t ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">Notes</span>
      </div>

      {tab === "edit" ? (
        <textarea
          value={doc}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Board notes in markdown — saved with the diagram…"
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-background p-3 font-mono text-xs leading-relaxed outline-none placeholder:text-muted-foreground/60"
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_li]:ml-4 [&_li]:list-disc [&_p]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:my-1.5">
          {doc.trim() === "" ? (
            <p className="text-xs text-muted-foreground">Nothing to preview yet — write notes in the Edit tab.</p>
          ) : (
            <ReactMarkdown>{doc}</ReactMarkdown>
          )}
        </div>
      )}
    </div>
  );
}
