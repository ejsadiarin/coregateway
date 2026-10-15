import type { TLUiOverrides } from "tldraw";
import { runCopySelectionAsJson } from "@/pages/dashboard/draw/jsonclipboard";

// The single place tool shortcuts live. Values use tldraw's kbd syntax:
// a bare key, `cmd`/`ctrl` combos, comma-separated alternatives.
// These restate the stock bindings so they survive SDK reshuffles and stay
// overridable here without touching tldraw internals.
export const TOOL_SHORTCUTS: Record<string, string> = {
  select: "v",
  hand: "h",
  eraser: "e",
  draw: "d",
  rectangle: "r",
  ellipse: "o",
  arrow: "a",
  line: "l",
  frame: "f",
  text: "t",
  note: "n",
};

export const COPY_AS_JSON_SHORTCUT = "ctrl+shift+c,cmd+shift+c";

export const drawUiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    const next = { ...tools };
    for (const [id, kbd] of Object.entries(TOOL_SHORTCUTS)) {
      if (next[id]) next[id] = { ...next[id], kbd };
    }
    return next;
  },
  actions(editor, actions) {
    return {
      ...actions,
      "copy-as-json": {
        id: "copy-as-json",
        label: "Copy selection as JSON",
        kbd: COPY_AS_JSON_SHORTCUT,
        readonlyOk: false,
        onSelect() {
          runCopySelectionAsJson(editor);
        },
      },
    };
  },
};
