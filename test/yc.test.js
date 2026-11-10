// Parsing YC's public job pages (scraper/yc.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const path = require("path");
const fs = require("fs");
const yc = require("../scraper/yc");

test("reads the props an Inertia page embeds", () => {
  const props = { jobPostings: [{ id: 1, title: "Engineer & Co" }] };
  const attr = JSON.stringify({ component: "X", props }).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  assert.deepEqual(yc.inertiaProps(`<div id="app" data-page="${attr}"></div>`), props);
  assert.equal(yc.inertiaProps("<html>no app</html>"), null);
});

test("turns YC's posted-ago words into a date", () => {
  const now = Date.parse("2026-11-01T00:00:00Z");
  assert.equal(yc.ycPostedDate("25 days", now), "2026-10-07T00:00:00.000Z");
  assert.equal(yc.ycPostedDate("about 1 month", now), "2026-10-02T00:00:00.000Z");
  assert.equal(yc.ycPostedDate("about an hour", now), "2026-10-31T23:00:00.000Z");
  assert.equal(yc.ycPostedDate("over 2 years", now).slice(0, 4), "2024");
  assert.equal(yc.ycPostedDate("", now), null);
});

test("reads dollar salary ranges and ignores other currencies", () => {
  assert.deepEqual(yc.ycSalary("$175K - $225K"), { min: 175000, max: 225000 });
  assert.deepEqual(yc.ycSalary("$1.2M"), { min: 1200000, max: 1200000 });
  assert.equal(yc.ycSalary("€60K - €80K"), null);
  assert.equal(yc.ycSalary(null), null);
});

test("splits a multi-place location line", () => {
  assert.deepEqual(yc.ycLocations("San Francisco, CA, US / Remote (US)"), ["San Francisco, CA, US", "Remote (US)"]);
  assert.deepEqual(yc.ycLocations(""), []);
});

test("takes YC's visa field over the description, except where it says nothing about sponsoring", () => {
  assert.equal(yc.ycSponsorship("Will sponsor", "").status, "yes");
  assert.equal(yc.ycSponsorship("US citizen/visa only", "We sponsor H-1B visas.").status, "no");
  assert.equal(yc.ycSponsorship("US citizenship/visa not required", "").status, "unknown");
});

test("converts YC's Markdown to the HTML the description cleaner keeps", () => {
  const html = yc.markdownToHtml("### **Why this matters**\n\nWe build **verification**.\n\n- One\n- Two\n\n1. First\n\nSee [docs](https://x.dev) & more <script>");
  assert.equal(html,
    "<h3>Why this matters</h3><p>We build <strong>verification</strong>.</p><ul><li>One</li><li>Two</li></ul>" +
    '<ol><li>First</li></ol><p>See <a href="https://x.dev">docs</a> &amp; more &lt;script&gt;</p>');
});

test("decodes the HTML entities YC leaves in its Markdown, escaping once", () => {
  // As YC sends it: the apostrophe already encoded. It must not reach the page as "&#x27;".
  const html = yc.markdownToHtml("We&#x27;re a small team &amp; growing.\n\n- You&#39;ll own **e2e&#x27;s cloud**");
  assert.equal(html, "<p>We're a small team &amp; growing.</p><ul><li>You'll own <strong>e2e's cloud</strong></li></ul>");
  // An encoded tag stays text, escaped once: decoded to "<b>", then shown, not obeyed.
  assert.equal(yc.markdownToHtml("&lt;b&gt;not bold&lt;/b&gt;"), "<p>&lt;b&gt;not bold&lt;/b&gt;</p>");
});

test("packs batches into groups under the search index's page cap", () => {
  const groups = yc.batchGroups({ W24: 600, S24: 500, W25: 300, S25: 100 }, 1000);
  for (const g of groups) assert.ok(g.reduce((s, b) => s + ({ W24: 600, S24: 500, W25: 300, S25: 100 })[b], 0) <= 1000);
  assert.deepEqual(groups.flat().sort(), ["S24", "S25", "W24", "W25"]);
});

test("skips companies hiring only outside the US", () => {
  assert.equal(yc.mayHireInUs({ regions: ["India", "South Asia"] }), false);
  assert.equal(yc.mayHireInUs({ regions: ["Europe", "Remote"] }), true);
  assert.equal(yc.mayHireInUs({ regions: [] }), true);
});

test("reuses a cached description for half a week to a week, then fetches it again", () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "yc-")), "cache.json");
  const now = Date.parse("2026-11-01T00:00:00Z");
  yc.saveDescriptions(new Map([["76935", { d: "text", at: now }]]), file);
  const entry = yc.loadDescriptions(file).get("76935");
  assert.equal(entry.d, "text");
  assert.equal(yc.isFresh(entry, "76935", now + 3 * 864e5), true);
  assert.equal(yc.isFresh(entry, "76935", now + 8 * 864e5), false);
  assert.equal(yc.isFresh(undefined, "1", now), false);
  assert.equal(yc.loadDescriptions(path.join(path.dirname(file), "missing.json")).size, 0);
});
