// The files the public site is made of — the only ones a browser may fetch.
//
// One list, read by build.js (what goes into dist/ and so onto the hosts) and by
// server.js (what the local dev server will hand out). Everything else in the repo —
// .env, descriptions.json, results.json, the server and scraper code, .git — stays
// private in both places.

// Everything the browser needs. Server-side files (pipeline, scraper, ats, …) are
// deliberately absent — shipping them would put the scrape internals on the public site.
const ASSETS = [
  "index.html", "firms.html", "firm.html", "about.html",
  "styles.css", "og.png", "robots.txt", "sitemap.xml", "404.html",
  "fonts/geist-sans-400.woff2", "fonts/geist-sans-500.woff2",
  "fonts/geist-sans-600.woff2", "fonts/geist-sans-700.woff2",
  "api-config.js", "data.js", "description.js", "select-menu.js", "saved.js", "jobs-ui.js", "auth.js", "resume-import.js", "resume-match.js", "presets.js", "filter-drawer.js", "all.js", "app.js", "firm.js", "track.js", "theme.js", "visitor.js", "viewed.js", "counter.js", "heart.js", "feedback.js",
  // Content, not code: rewritten by the /feature command between scrapes, and shipped
  // as-is so the browser can fetch it at the same relative path server.js serves.
  "featured.js", "featured.json",
];

module.exports = { ASSETS };
