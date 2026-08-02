// The scrape pipeline and read payload builders shared by the scheduled scraper,
// local development server, and static build.
//
// Nothing here touches the filesystem or HTTP — callers decide where results go.

const { scrapeFirm } = require("./scraper");
const { BOARDS } = require("./boards");
const { detectAts, isSupported, buildRegistry, fetchAll } = require("./ats");
const { dedupe } = require("./match");

const BOARD_DELAY_MS = 250; // be polite to the upstream boards

/**
 * Run all three phases and return the results object.
 * `onEvent(type, data)` lets the CLI and automation report:
 * "start" | "progress" | "phase" | "done".
 */
async function runScrape(onEvent = () => {}) {
  const firmIds = Object.keys(BOARDS);
  const scrapeable = firmIds.filter((id) => BOARDS[id].platform);
  onEvent("start", { total: scrapeable.length, allFirms: firmIds.length });

  const results = { scrapedAt: new Date().toISOString(), firms: {} };
  let done = 0;

  // --- Phase 1: VC boards. These tell us which companies each firm backs. ---
  for (const id of firmIds) {
    const cfg = BOARDS[id];
    if (!cfg.platform) {
      results.firms[id] = { firmId: id, status: "unsupported", reason: cfg.reason, host: cfg.host, jobs: [] };
      continue;
    }
    onEvent("progress", { phase: "boards", firmId: id, done, total: scrapeable.length, state: "scraping" });
    const r = await scrapeFirm(id);
    results.firms[id] = r;
    done++;
    onEvent("progress", {
      phase: "boards",
      firmId: id,
      done,
      total: scrapeable.length,
      state: r.status,
      count: r.jobs.length,
      reason: r.reason || null,
    });
    await new Promise((res) => setTimeout(res, BOARD_DELAY_MS));
  }

  // --- Phase 2: go straight to each company's own ATS for the authoritative list. ---
  const registry = buildRegistry(results.firms);
  const entries = [...registry.values()];
  onEvent("phase", { phase: "ats", companies: entries.length });

  const enriched = await fetchAll(entries, (p) => {
    onEvent("progress", {
      phase: "ats",
      done: p.done,
      total: p.total,
      company: p.company,
      state: p.ok ? "ok" : "error",
      count: p.count,
    });
  });

  // --- Phase 3: merge. ATS wins for companies we reached; board data fills the rest. ---
  let atsJobCount = 0;
  let boardJobCount = 0;
  const okCompanies = [...enriched.values()].filter((e) => e.ok).length;

  for (const [firmId, r] of Object.entries(results.firms)) {
    if (r.status !== "ok") continue;

    // Ashby and Greenhouse don't publish compensation on their list endpoints, but
    // the VC board often does — so carry salary across rather than losing it when an
    // ATS record supersedes a board record.
    const boardByKey = new Map();
    for (const j of r.jobs || []) {
      boardByKey.set(`${j.company}|${j.title}|${j.city}`.toLowerCase(), j);
    }

    const replaced = new Set();
    const atsJobs = [];
    for (const entry of entries) {
      if (!entry.firms.has(firmId)) continue;
      const e = enriched.get(entry.key);
      if (!e || !e.ok) continue;
      replaced.add(entry.key);
      for (const j of e.jobs) {
        if (!j.salaryMin) {
          const b = boardByKey.get(`${j.company}|${j.title}|${j.city}`.toLowerCase());
          if (b && b.salaryMin) {
            j.salaryMin = b.salaryMin;
            j.salaryMax = b.salaryMax;
            j.salary = b.salary;
          }
        }
        atsJobs.push(j);
      }
    }

    const boardJobs = (r.jobs || []).filter((j) => {
      const d = detectAts(j.url);
      return !(d && isSupported(d.ats) && replaced.has(`${d.ats}:${d.slug}`));
    });

    r.jobs = dedupe([...atsJobs, ...boardJobs]);
    r.atsCompanies = replaced.size;
    r.fromAts = atsJobs.length;
    r.fromBoard = boardJobs.length;
    atsJobCount += atsJobs.length;
    boardJobCount += boardJobs.length;
  }

  results.enrichment = {
    companies: entries.length,
    reached: okCompanies,
    fromAts: atsJobCount,
    fromBoard: boardJobCount,
    // Recorded so an ATS that quietly starts failing is visible rather than silent.
    failures: [...enriched.values()]
      .filter((e) => !e.ok)
      .map((e) => ({ company: e.company, ats: e.ats, slug: e.slug, reason: e.reason })),
  };

  onEvent("done", { scrapedAt: results.scrapedAt, firms: summarize(results), enrichment: results.enrichment });
  return results;
}

function summarize(results) {
  const out = {};
  for (const [id, r] of Object.entries(results.firms || {})) {
    out[id] = { status: r.status, count: (r.jobs || []).length, reason: r.reason || null };
  }
  return out;
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
const COMPANY_FIELDS = ["logo", "markets", "domain", "staffCount", "size", "stage"];

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

/**
 * Every role across every firm, deduped. The same company can sit in several
 * portfolios, so a job carries the list of investors that back it.
 */
function allJobsPayload(data) {
  const merged = new Map();
  for (const [firmId, r] of Object.entries(data.firms || {})) {
    if (r.status !== "ok") continue;
    for (const j of r.jobs || []) {
      const key = `${j.company}|${j.title}|${j.city}`.toLowerCase();
      const existing = merged.get(key);
      if (existing) {
        if (!existing.firms.includes(firmId)) existing.firms.push(firmId);
        // Prefer a live ATS record over a VC-board one.
        if (existing.source !== "ats" && j.source === "ats") {
          Object.assign(existing, j, { firms: existing.firms });
        }
      } else {
        merged.set(key, { ...j, firms: [firmId] });
      }
    }
  }
  return {
    scrapedAt: data.scrapedAt,
    enrichment: data.enrichment || null,
    ...packCompanies([...merged.values()]),
  };
}

/**
 * One firm's payload, or null if that id isn't a firm at all. Firms that have never
 * been scrapeable still get a real page explaining why, from the board config.
 */
function firmPayload(data, id) {
  const firm = (data.firms || {})[id];
  if (firm) return { scrapedAt: data.scrapedAt, ...firm };

  const cfg = BOARDS[id];
  if (cfg && !cfg.platform) {
    return {
      scrapedAt: data.scrapedAt,
      firmId: id,
      status: "unsupported",
      reason: cfg.reason,
      host: cfg.host,
      jobs: [],
    };
  }
  return null;
}

module.exports = { runScrape, summarize, resultsPayload, allJobsPayload, firmPayload };
