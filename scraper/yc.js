// Reading Y Combinator's public job pages: the parsing the YC reader in scraper.js needs.
//
// YC's pages are Inertia apps: each one embeds its data as JSON in a data-page
// attribute, so a company's openings come from one request to
// /companies/{slug}/jobs and a full description from /companies/{slug}/jobs/{job}.
// Which companies are hiring comes from the search index behind YC's company
// directory, read with the public key the directory page itself ships.
//
// YC publishes facts other boards leave to the description: a visa policy per
// posting, a salary range, and a real team size. It does not publish posting dates,
// only how long ago in words ("25 days", "about 1 month"), so dates here are
// approximate, and the further back the rougher.

const fs = require("fs");
const path = require("path");
const { classifySponsorship } = require("./sponsorship");

// Descriptions from earlier runs, by YC job id, so a run fetches only the pages of
// roles that are new or whose copy is a week old: about 2,000 requests fewer each
// time. Not in git; CI carries it between runs with actions/cache, like Jev's labels,
// and losing it only means fetching every page once.
const DESCRIPTION_CACHE = path.join(__dirname, "..", "data", "yc-descriptions.json");
const DESCRIPTION_MAX_AGE_MS = 7 * 864e5;

function loadDescriptions(file = DESCRIPTION_CACHE) {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(file, "utf8"))));
  } catch {
    return new Map();
  }
}

/** Keep only the roles still listed, so the file does not grow forever. */
function saveDescriptions(entries, file = DESCRIPTION_CACHE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(entries)));
}

/**
 * Whether a cached description is recent enough to reuse. Each role gets its own
 * lifetime between half a week and a week, from its id, so a cache filled in one run
 * does not expire all at once and send the next run back to every page.
 */
function isFresh(entry, id, now = Date.now()) {
  if (!entry || typeof entry.d !== "string") return false;
  const spread = 0.5 + (Number(String(id).replace(/\D/g, "").slice(-2) || 0) % 50) / 100;
  return now - entry.at < DESCRIPTION_MAX_AGE_MS * spread;
}

/** The props object of an Inertia page, or null when the page has none. */
function inertiaProps(html) {
  const m = String(html || "").match(/data-page="([^"]+)"/);
  if (!m) return null;
  const json = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  try {
    return JSON.parse(json).props || null;
  } catch {
    return null;
  }
}

const UNIT_MS = { minute: 6e4, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 };

/** "25 days", "about 1 month", "over 2 years", "less than a minute" to an ISO date. */
function ycPostedDate(text, now = Date.now()) {
  const s = String(text || "").toLowerCase();
  if (/less than a minute|just now/.test(s)) return new Date(now).toISOString();
  const m = s.match(/(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  return new Date(now - n * UNIT_MS[m[2]]).toISOString();
}

/** "$175K - $225K" to { min, max } in dollars; null for other currencies or no range. */
function ycSalary(text) {
  const amounts = [...String(text || "").matchAll(/\$\s*([\d.,]+)\s*([km])?/gi)].map(([, n, unit]) => {
    const v = Number(n.replace(/,/g, ""));
    return unit ? v * (unit.toLowerCase() === "m" ? 1e6 : 1e3) : v;
  }).filter((v) => v > 0);
  if (!amounts.length) return null;
  return { min: amounts[0], max: amounts[1] || amounts[0] };
}

/** A posting's location line, "San Francisco, CA, US / Remote (US)", as a list. */
const ycLocations = (text) => String(text || "").split(/\s+\/\s+|;\s*/).map((s) => s.trim()).filter(Boolean);

/**
 * YC asks every company to state a visa policy, which is a firmer answer than
 * anything read out of a description. "Will sponsor" is a yes; "US citizen/visa only"
 * means the candidate must already be authorised to work, which is a no. The third
 * option, "US citizenship/visa not required", is about hiring outside the US and says
 * nothing about sponsoring here, so the description decides that one.
 */
function ycSponsorship(visa, descriptionText) {
  const fromText = classifySponsorship(descriptionText || "");
  const v = String(visa || "").trim();
  if (/^will sponsor/i.test(v)) return { status: "yes", evidence: `YC listing: ${v}`, types: fromText.types };
  if (/^us citizen\/visa only/i.test(v)) return { status: "no", evidence: `YC listing: ${v}`, types: fromText.types };
  return fromText;
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inlineMarkdown(s) {
  return escapeHtml(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`)
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
}

/**
 * The Markdown YC descriptions are written in, to the small HTML vocabulary
 * toDisplayHtml keeps: headings, paragraphs, lists, bold, italic and links.
 * Anything fancier (tables, images, code) arrives as text.
 */
function markdownToHtml(md) {
  const out = [];
  let list = null; // "ul" | "ol"
  let para = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMarkdown).join("<br>")}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of String(md || "").replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const bullet = line.match(/^[-*+•]\s+(.*)$/);
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) { flushPara(); closeList(); continue; }
    if (heading) {
      flushPara(); closeList();
      const text = heading[2].replace(/^\*\*(.*)\*\*$/, "$1");
      const tag = heading[1].length <= 3 ? "h3" : "h4";
      out.push(`<${tag}>${inlineMarkdown(text)}</${tag}>`);
      continue;
    }
    if (bullet || numbered) {
      flushPara();
      const tag = bullet ? "ul" : "ol";
      if (list !== tag) { closeList(); out.push(`<${tag}>`); list = tag; }
      out.push(`<li>${inlineMarkdown((bullet || numbered)[1])}</li>`);
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return out.join("");
}

/**
 * The search index pages at most 1,000 results per query, and more companies than that
 * are hiring. Every batch is far smaller, so batches are packed into groups that each
 * stay under the cap and one query is made per group.
 */
function batchGroups(counts, cap = 1000) {
  const groups = [];
  let current = [];
  let size = 0;
  for (const [batch, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    if (size + n > cap && current.length) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(batch);
    size += n;
  }
  if (current.length) groups.push(current);
  return groups;
}

// A company the index files under none of these regions is hiring only outside the US,
// so its page is not worth a request. Roles are still checked one by one afterwards.
const US_REGIONS = new Set(["United States of America", "America / Canada", "Remote", "Fully Remote", "Partly Remote", "Unspecified"]);
const mayHireInUs = (company) => !Array.isArray(company.regions) || !company.regions.length || company.regions.some((r) => US_REGIONS.has(r));
// The same, with India: the regions YC files Indian hiring under.
const INDIA_REGIONS = new Set(["India", "South Asia"]);
const mayHireInTracked = (company) => mayHireInUs(company) || company.regions.some((r) => INDIA_REGIONS.has(r));

module.exports = {
  inertiaProps, ycPostedDate, ycSalary, ycLocations, ycSponsorship, markdownToHtml, batchGroups, mayHireInUs, mayHireInTracked,
  loadDescriptions, saveDescriptions, isFresh,
};
