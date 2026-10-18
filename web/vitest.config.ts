import { defineConfig } from "vitest/config";
import path from "path";

// The canvas adapter (src/pages/dashboard/draw/engine.ts) is the seam under
// test: pure functions over element arrays, so the default node environment is
// enough — no jsdom, no browser.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
