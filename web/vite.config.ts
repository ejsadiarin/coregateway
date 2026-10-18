import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/postcss";
import fs from "node:fs";
import path from "node:path";

// Excalidraw loads its fonts/locales at runtime from `EXCALIDRAW_ASSET_PATH`,
// falling back to the esm.sh CDN when a path is missing. To keep the app
// offline-capable we serve those assets from our own origin: the dev server
// proxies them straight out of the package, and the build copies them into
// `dist/excalidraw-assets/`. The canvas sets the matching asset path.
const EXCALIDRAW_ASSETS_MOUNT = "/excalidraw-assets/";
const EXCALIDRAW_DIST = path.resolve(__dirname, "node_modules/@excalidraw/excalidraw/dist/prod");
const EXCALIDRAW_ASSET_SUBDIRS = ["fonts", "locales", "data"];

const CONTENT_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function excalidrawAssets(): Plugin {
  return {
    name: "excalidraw-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(EXCALIDRAW_ASSETS_MOUNT)) return next();
        const rel = decodeURIComponent(req.url.slice(EXCALIDRAW_ASSETS_MOUNT.length).split("?")[0]);
        const file = path.join(EXCALIDRAW_DIST, rel);
        if (!file.startsWith(EXCALIDRAW_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
          return next();
        }
        res.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
    async writeBundle(options) {
      const outDir = path.resolve(options.dir ?? "dist", EXCALIDRAW_ASSETS_MOUNT.slice(1));
      for (const sub of EXCALIDRAW_ASSET_SUBDIRS) {
        await fs.promises.cp(path.join(EXCALIDRAW_DIST, sub), path.join(outDir, sub), {
          recursive: true,
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawAssets()],
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
