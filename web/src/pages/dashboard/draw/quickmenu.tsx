import { Command } from "cmdk";
import type { Editor } from "tldraw";
import {
  buildQuickMenuSections,
  type QuickMenuEntry,
} from "@/pages/dashboard/draw/quickmenu-catalog";

export function QuickMenu({
  open,
  onOpenChange,
  editor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor | null;
}) {
  const run = (entry: QuickMenuEntry) => {
    if (editor) entry.run(editor);
    onOpenChange(false);
  };
  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Insert shape, switch tool, or copy as JSON"
      className="fixed left-1/2 top-[20%] z-50 w-full max-w-md -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
    >
      <Command.Input
        placeholder="Type a shape, tool, or icon…"
        className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Command.List className="max-h-80 overflow-y-auto p-2">
        <Command.Empty className="px-2 py-6 text-center text-sm text-muted-foreground">
          No matches.
        </Command.Empty>
        {buildQuickMenuSections().map((section) => (
          <Command.Group
            key={section.heading}
            heading={section.heading}
            className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground"
          >
            {section.entries.map((entry) => (
              <Command.Item
                key={entry.id}
                value={entry.title}
                keywords={entry.keywords}
                onSelect={() => run(entry)}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-2 text-sm normal-case tracking-normal aria-selected:bg-accent"
              >
                <span>{entry.title}</span>
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {entry.hint}
                </kbd>
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command.Dialog>
  );
}
