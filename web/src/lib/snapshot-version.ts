// Single source of truth for the board snapshot schema version, shared by the
// board API client and the canvas adapter.
//
// It lives on its own so `lib/draw.ts` can read it without importing the canvas
// adapter (which pulls in the Excalidraw bundle and the vendored icon sprite),
// keeping the dashboard's non-drawing routes free of that weight.
//
// Bumping this invalidates every stored board: a snapshot whose version is not
// this value loads as a blank canvas (there is no converter, by design).
export const SNAPSHOT_VERSION = 2;
