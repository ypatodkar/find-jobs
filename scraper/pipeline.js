// The scrape pipeline and read payload builders shared by the scheduled scraper,
// local development server, and static build.
//
// Nothing here touches the filesystem or HTTP — callers decide where results go.

const { BOARDS } = require("./boards");
const { refreshRegistry } = require("./registry-pipeline");
const { emptyState } = require("./registry");

async function runScrape(onEvent = () => {}, options = {}) {
  return refreshRegistry(options.state || emptyState(), onEvent, options);
}

// Investor pages and the firms index are the US site's, so a firm's count is its US
// roles; `countIn` is its Indian ones.
function summarize(results) {
  const out = {};
  for (const [id, r] of Object.entries(results.firms || {})) {
    const jobs = r.jobs || [];
    const india = jobs.filter((j) => j.country === "IN").length;
    out[id] = { status: r.status, count: jobs.length - india, countIn: india, reason: r.reason || null };
  }
  return out;
}

/** Refuse a deploy when every configured board on a supported platform failed. */
function failedPlatforms(results) {
  const platforms = new Set(Object.values(BOARDS).map((cfg) => cfg.platform).filter(Boolean));
  return [...platforms].filter((platform) => {
    const ids = Object.keys(BOARDS).filter((id) => BOARDS[id].platform === platform);
    return ids.length > 0 && ids.every((id) => results.firms[id]?.status !== "ok");
  });
}

/**
 * Boards that were configured to work and didn't, as [firmId, reason] pairs.
 *
 * The all-or-nothing check above only fires on a total outage, which is the failure
 * nobody misses. The one that hurt was quieter: two boards stopped working, twenty
 * kept going, the run reported success and the site silently shed 86 companies that no
 * other portfolio covers. Attrition needs naming, not just extinction.
 *
 * Reported rather than thrown, because one board failing is usually a bad minute
 * upstream and not a reason to withhold a scrape that is otherwise complete. The
 * decision to abort stays with failedPlatforms; this exists so the log says which
 * firms are missing before anyone has to work it out from the totals.
 */
function failedBoards(results) {
  return Object.keys(BOARDS)
    .filter((id) => BOARDS[id].platform)
    .filter((id) => results.firms[id]?.status !== "ok")
    .map((id) => [id, results.firms[id]?.reason || "no result"]);
}

/** The firms-index payload. */
function resultsPayload(data) {
  return { scrapedAt: data.scrapedAt, firms: summarize(data) };
}

// Facts that describe a company rather than a role. Repeating them on every one of
// that company's listings was half of all-jobs.json: 3.4MB of logo URLs and 2.4MB of
// market tags across 11,691 rows that held 1,624 distinct values between them.
//
// Hoisting them also settles a disagreement. A company's board-sourced rows carry the
// metadata of whichever board reported them, while its ATS-sourced rows carry the
// merged registry value, so 41 companies published two different `size` values and the
// company-size filter matched some of their roles but not others. One value per
// company, first non-empty wins — the same rule ats.js already uses to merge them.
const COMPANY_FIELDS = ["logo", "markets", "domain", "staffCount", "size", "stage", "hq"];

const isEmpty = (v) => v == null || (Array.isArray(v) && v.length === 0);

/**
 * Split company-level fields out of the job rows into a lookup table the jobs index
 * into. `companyFields` travels with the payload so the client can reverse this
 * without keeping its own copy of the list to drift out of sync.
 */
function packCompanies(jobs) {
  const order = [];
  const byName = new Map();
  for (const job of jobs) {
    let co = byName.get(job.company);
    if (!co) {
      co = { n: job.company };
      byName.set(job.company, co);
      order.push(co);
    }
    for (const f of COMPANY_FIELDS) if (isEmpty(co[f]) && !isEmpty(job[f])) co[f] = job[f];
  }
  const index = new Map(order.map((co, i) => [co.n, i]));

  const packed = jobs.map((job) => {
    const out = { c: index.get(job.company) };
    for (const k of Object.keys(job)) {
      if (k === "company" || COMPANY_FIELDS.includes(k)) continue;
      out[k] = job[k];
    }
    return out;
  });
  return { companyFields: COMPANY_FIELDS, companies: order, jobs: packed };
}

// Kept in results.json for the scrape log, sync and feature-pick.js, but no page reads
// them: `locations` duplicates `city` for display purposes nobody built, and the
// sponsorship trio lost its last reader when the sponsorship filter was removed.
// Together they were 1.7MB of all-jobs.json.
//
// `country` too: each list is one country's file, so every row in it would repeat it.
const SERVER_ONLY_FIELDS = new Set(["locations", "sponsorship", "sponsorshipEvidence", "sponsorshipTypes", "staffCount", "domain", "country"]);

// Which list a row belongs to. Rows from before India was tracked carry no country and
// were all American.
const countryOf = (job) => job.country || "US";

// What the browser gets for one job: no server-only fields, and no null, false or
// empty values (8,000 `remote: false` and 4,800 null salary triples), since every
// reader already treats a missing field as falsy. `city` stays even when null because
// the location filter indexes on it directly.
//
// `described` is the set of job ids with a stored description (descriptions.json).
// Each such job is marked, so the list can put roles you can read about first within
// a day without fetching a single description to find out which those are.
function publicJob(job, described) {
  const out = {};
  for (const [k, v] of Object.entries(job)) {
    if (SERVER_ONLY_FIELDS.has(k)) continue;
    if (k !== "city" && (v === false || v === "" || isEmpty(v))) continue;
    out[k] = v;
  }
  if (described && described.has(job.job_id)) out.described = true;
  return out;
}

/**
 * Every role across every firm, deduped, with every field intact. The same company
 * can sit in several portfolios, so a job carries the list of investors that back it.
 */
function mergeJobs(data) {
  const merged = new Map();
  const sources = [...Object.entries(data.firms || {}), [null, { status: "ok", jobs: data.directJobs || [] }]];
  for (const [firmId, r] of sources) {
    if (r.status !== "ok") continue;
    for (const j of r.jobs || []) {
      const key = `${j.company}|${j.title}|${j.city}`.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        if (firmId && !existing.firms.includes(firmId)) existing.firms.push(firmId);
        // Prefer a live ATS record over a VC-board one.
        if (existing.source !== "ats" && j.source === "ats") {
          Object.assign(existing, j, { firms: existing.firms });
        }
      } else {
        merged.set(key, { ...j, firms: firmId ? [firmId] : [] });
      }
    }
  }
  return [...merged.values()];
}

/**
 * What a list page downloads: one country's merged jobs, slimmed and company-packed.
 * "US" is the all-jobs page (index.html), "IN" the India list (in.html).
 */
function allJobsPayload(data, described, country = "US") {
  return packCompanies(mergeJobs(data).filter((j) => countryOf(j) === country).map((j) => publicJob(j, described)));
}

/**
 * One firm's payload, or null if that id isn't a firm at all. Firms that have never
 * been scrapeable still get a real page explaining why, from the board config.
 */
function firmPayload(data, id, described) {
  const firm = (data.firms || {})[id];
  if (firm) {
    // Only what the investor page reads; the rest of the firm record is scrape bookkeeping.
    const { status, reason, host, totalOnBoard, atsCompanies, fromAts, fromBoard } = firm;
    return {
      status, reason, host, totalOnBoard, atsCompanies, fromAts, fromBoard,
      // Investor pages are part of the US site.
      jobs: (firm.jobs || []).filter((j) => countryOf(j) === "US").map((j) => publicJob(j, described)),
    };
  }

  const cfg = BOARDS[id];
  if (cfg && !cfg.platform) {
    return {
      firmId: id,
      status: "unsupported",
      reason: cfg.reason,
      host: cfg.host,
      jobs: [],
    };
  }
  return null;
}

module.exports = { runScrape, summarize, failedPlatforms, failedBoards, resultsPayload, mergeJobs, packCompanies, allJobsPayload, firmPayload };
