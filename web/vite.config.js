// The site's pages. `npm run dev` serves them on :5173 and forwards api/* to the dev
// server (node scripts/dev-server.js, :4173), which answers the same paths the static
// build writes and the Lambda serves. `npm run build` writes web/dist.
//
// public/ (og.png, robots.txt, sitemap.xml, featured.json) is copied into the build
// as is. shared/description.js sits outside web/ because the scraper and the API use it
// too, hence the wider fs.allow.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const page = (name) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  plugins: [react()],
  // Relative: Pages and S3 serve the site from the root, but nothing here assumes it.
  base: "./",
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: { "/api": "http://localhost:4173" },
  },
  // One entry per page; shared code (React, the header, the job list) is split into
  // chunks the pages share.
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: page("index.html"),
        firm: page("firm.html"),
        firms: page("firms.html"),
        about: page("about.html"),
        404: page("404.html"),
      },
    },
  },
});
