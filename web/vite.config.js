// The React pages. `npm run dev` serves them on :5173 and forwards api/* to the dev
// server at the repo root (node server.js, :4173), which answers the same paths the
// static build writes and the Lambda serves. `npm run build` writes web/dist.
//
// styles.css, the fonts and the shared plain scripts (description.js, data.js) stay
// at the repo root, where the current pages and the server use them too, so the React
// pages import them from there rather than keeping copies.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative, as the current pages are: Pages and S3 serve the site from the root,
  // but nothing here should assume it.
  base: "./",
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    // featured.json is written by the /feature command at the repo root.
    proxy: { "/api": "http://localhost:4173", "/featured.json": "http://localhost:4173" },
  },
  // One entry per page; shared code (React, the header, the job list) is split into
  // chunks the pages share.
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("index.html", import.meta.url)),
        firm: fileURLToPath(new URL("firm.html", import.meta.url)),
        firms: fileURLToPath(new URL("firms.html", import.meta.url)),
        about: fileURLToPath(new URL("about.html", import.meta.url)),
      },
    },
  },
});
