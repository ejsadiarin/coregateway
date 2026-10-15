import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import path from "path";

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss()],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // cmdk (and any dep bundling its own copy) must share the app's React
    // instance, or hooks crash with "invalid hook call" in dev.
    dedupe: ["react", "react-dom"],
  },
  server: {
    port: 3000,
  },
});
