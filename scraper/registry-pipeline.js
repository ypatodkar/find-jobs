const { BOARDS } = require("./boards");
const { scrapeFirm } = require("./scraper");
const { fetchAll, fetchCompany } = require("./ats");
const { dedupe, isBlockedCompany, companyCountry, inCountry } = require("./match");
const { resolveCareers } = require("./careers");
const { DAY, DISCOVERY_INTERVAL, REPAIR_INTERVAL, due, ingestBoard, findCompany, atsEntry, compactBoardJobs } = require("./registry");
const { INDIA_PORTFOLIOS, isIndianFirm } = require("./india");
const { discoverPortfolios } = require("./portfolio");

async function bounded(items, concurrency, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

/**
 * Where a company is based, for the India list's "Company HQ" filter: "US", "IN" or
 * "other". From where all of its ATS openings are when we read its board, else from
 * the roles the VC boards list for it; with neither, from its investors (an Indian
 * board's company is Indian).
 */
function hqOf(co, boards) {
  let mix = co.locationMix;
  if (!mix) {
    mix = { US: 0, IN: 0, other: 0 };
    for (const j of co.lastJobs) mix[j.country === "IN" ? "IN" : "US"]++;
  }
  return companyCountry({ domain: co.meta.domain, mix, fallback: indianOnly(co, boards) ? "IN" : "US" });
}

// A company that only Indian sources list: read for the India list alone, so a firm
// added for India never changes the US list.
const indianOnly = (co, boards) => co.firms.length > 0 && co.firms.every((id) => isIndianFirm(id, boards));

function recordSuccess(co, result, now, previousJobs = co.lastJobs) {
  const prior = new Map(previousJobs.map((j) => [`${j.title}|${j.city}`.toLowerCase(), j]));
  co.lastJobs = result.jobs.map((job) => {
    const old = prior.get(`${job.title}|${job.city}`.toLowerCase());
    // An Indian row only ever takes rupee pay (match.js, inCountry).
    const carries = old?.salaryMin && (job.country !== "IN" || /\bINR\b|₹/.test(old.salary || ""));
    return !job.salaryMin && carries
      ? { ...job, salaryMin: old.salaryMin, salaryMax: old.salaryMax, salary: old.salary }
      : job;
  });
  if (result.mix) co.locationMix = result.mix;
  co.lastSuccessAt = now;
  co.lastAtsSuccessAt = now;
  co.lastAttemptAt = now;
  co.consecutiveFailures = 0;
  co.lastError = null;
}

async function refreshRegistry(state, onEvent = () => {}, options = {}) {
  const now = options.now || new Date().toISOString();
  const boards = options.boards || BOARDS;
  const scrape = options.scrapeFirm || scrapeFirm;
  const fetchBoards = options.fetchAll || fetchAll;
  const fetchOne = options.fetchCompany || fetchCompany;
  const resolve = options.resolveCareers || resolveCareers;
  const discovery = { attempted: 0, succeeded: 0, errors: [] };
  // The Indian portfolios ride along with the real board list; a caller passing its
  // own boards (the tests) opts in with options.portfolios.
  const portfolios = options.portfolios ?? !options.boards;
  const ids = Object.keys(boards);
  const eligible = (co) => !isBlockedCompany({ company: co.company, domain: co.meta.domain, slug: co.slug });
  const dueBoards = options.jobsOnly ? [] : ids.filter((id) => boards[id].platform &&
    (options.forceDiscovery || (due(state.boards[id]?.lastDiscoveryAt, DISCOVERY_INTERVAL, now) && due(state.boards[id]?.lastAttemptAt, DAY, now))));
  onEvent("start", { total: dueBoards.length, allFirms: ids.length });

  // Keep production's parallel platform lanes, but merge in configured order so
  // whichever network request wins cannot change a company's canonical identity.
  const laneLimits = { consider: 4, getro: 3, a16z: 1, greylock: 1, yc: 1 };
  const lanes = new Map(), observed = new Map();
  for (const id of dueBoards) {
    const platform = boards[id].platform;
    if (!lanes.has(platform)) lanes.set(platform, []);
    lanes.get(platform).push(id);
  }
  await Promise.all([...lanes].map(([platform, lane]) => bounded(lane, laneLimits[platform] || 2, async (id) => {
    onEvent("progress", { phase: "boards", firmId: id, done: discovery.attempted, total: dueBoards.length, state: "scraping" });
    let result;
    try { result = await scrape(id); }
    catch (err) { result = { status: "error", reason: err.message, jobs: [] }; }
    observed.set(id, result);
    discovery.attempted++;
    onEvent("progress", { phase: "boards", firmId: id, done: discovery.attempted, total: dueBoards.length, state: result.status, count: result.jobs?.length || 0, reason: result.reason });
    await new Promise((done) => setTimeout(done, options.boardDelayMs ?? 250));
  })));
  for (const id of dueBoards) {
    const result = observed.get(id), prior = state.boards[id];
    if (result.status === "ok" && Array.isArray(result.jobs)) {
      ingestBoard(state, id, result, now, `https://${boards[id].host}`);
      state.boards[id] = { ...result, lastAttemptAt: now, lastDiscoveryAt: now, lastSuccessAt: now };
      discovery.succeeded++;
    } else {
      const reason = result.reason || "Invalid discovery response";
      state.boards[id] = { ...prior, lastAttemptAt: now, lastError: reason };
      discovery.errors.push({ firmId: id, reason });
    }
  }

  // Indian portfolios, company by company (portfolio.js): weekly per firm, plus a
  // bounded number of careers lookups for new and stale websites every discovery run.
  if (!options.jobsOnly && portfolios) {
    try {
      discovery.portfolios = await (options.discoverPortfolios || discoverPortfolios)(state, {
        now, onEvent, forceDiscovery: options.forceDiscovery, resolveLimit: options.portfolioResolveLimit,
      });
    } catch (err) {
      // India's sources must never cost the US refresh.
      discovery.errors.push({ firmId: "india-portfolios", reason: err.message });
    }
  }

  // Preserve the most recent successful VC snapshot for unsupported ATSs. Their
  // freshness is explicitly the weekly board observation, not today's ATS run.
  const fallback = new Map();
  for (const [firmId, board] of Object.entries(state.boards)) {
    if (!board.lastSuccessAt) continue;
    for (const job of board.jobs || []) {
      const co = findCompany(state, job, firmId);
      if (!co || !eligible(co)) continue;
      if (!fallback.has(co.id)) fallback.set(co.id, []);
      fallback.get(co.id).push(job);
    }
  }
  for (const co of Object.values(state.companies).filter((c) => (!c.key || !c.lastAtsSuccessAt) && eligible(c))) {
    const observed = co.firms.map((id) => state.boards[id]?.lastSuccessAt).filter(Boolean).sort().at(-1);
    if (observed) {
      co.lastJobs = dedupe(fallback.get(co.id) || []);
      co.lastSuccessAt = observed;
    }
  }

  const repair = { attempted: 0, resolved: 0, errors: [] };
  if (!options.discoveryOnly) {
    const companies = Object.values(state.companies).filter(eligible);
    const entries = companies.filter((co) => co.key).map((co) => ({ ...atsEntry(co), countries: indianOnly(co, boards) ? ["IN"] : undefined }));
    onEvent("phase", { phase: "ats", companies: entries.length });
    const fetched = await fetchBoards(entries, (p) => onEvent("progress", { phase: "ats", ...p }));
    for (const co of companies.filter((c) => c.key)) {
      const result = fetched.get(co.key);
      co.lastAttemptAt = now;
      if (result?.ok && Array.isArray(result.jobs)) recordSuccess(co, result, now, [...co.lastJobs, ...(fallback.get(co.id) || [])]);
      else {
        co.consecutiveFailures = (co.consecutiveFailures || 0) + 1;
        co.lastError = result?.reason || "No valid ATS response";
      }
    }

    // Resolution runs once on admission, then at most weekly. Working boards are
    // never re-crawled. A candidate must return a valid API response before replacing
    // the old endpoint or its jobs, even when the new board is genuinely empty.
    const pending = companies.filter((co) => (!co.key || co.consecutiveFailures >= 3) && due(co.lastRepairAt, REPAIR_INTERVAL, now))
      .sort((a, b) => (a.lastRepairAt || "").localeCompare(b.lastRepairAt || ""));
    const repairs = pending.slice(0, options.repairLimit ?? 24);
    repair.queued = pending.length - repairs.length;
    onEvent("phase", { phase: "repair", companies: repairs.length, queued: repair.queued });
    await bounded(repairs, 4, async (co) => {
      co.lastRepairAt = now;
      repair.attempted++;
      try {
        const found = await resolve(co);
        let reason = found.errors?.join("; ") || "No supported careers board found";
        for (const candidate of found.candidates || []) {
          const key = `${candidate.ats}:${candidate.slug}`;
          if (co.key === key) continue; // already attempted above
          const existing = companies.find((other) => other.id !== co.id && other.key === key);
          const sameCompany = existing && existing.company.toLowerCase() === co.company.toLowerCase() &&
            ((co.meta.domain && co.meta.domain === existing.meta.domain) || co.firms.some((id) => existing.firms.includes(id)));
          if (existing && !sameCompany) { reason = `Board already belongs to ${existing.company}; review company identity`; continue; }
          const result = await fetchOne({ ...atsEntry(co), ...candidate, key });
          if (!result.ok || !Array.isArray(result.jobs)) { reason = result.reason || "Invalid replacement board response"; continue; }
          if (existing) {
            co.firms = [...new Set([...co.firms, ...existing.firms])];
            co.sources = [...new Set([...co.sources, ...existing.sources])];
            delete state.companies[existing.id];
          }
          co.boardHistory = [...(co.boardHistory || []), ...(co.key ? [{ key: co.key, changedAt: now }] : [])];
          co.ats = candidate.ats; co.slug = candidate.slug; co.key = key; co.careersUrl = candidate.url;
          recordSuccess(co, result, now);
          repair.resolved++;
          co.repairError = null;
          return;
        }
        co.repairError = reason;
        repair.errors.push({ company: co.company, reason });
      } catch (err) { co.repairError = err.message; repair.errors.push({ company: co.company, reason: err.message }); }
      onEvent("progress", { phase: "repair", done: repair.attempted, total: repairs.length, company: co.company });
    });
  }

  const results = { scrapedAt: now, firms: {}, directJobs: [], discovery, repair };
  for (const [id, cfg] of Object.entries(boards)) {
    const board = state.boards[id];
    const known = Object.values(state.companies).some((co) => eligible(co) && co.firms.includes(id));
    results.firms[id] = {
      firmId: id, host: cfg.host, status: board?.lastSuccessAt || known ? "ok" : cfg.platform ? "error" : "unsupported",
      reason: board?.lastError || (!cfg.platform ? cfg.reason : null),
      jobs: [], totalOnBoard: board?.totalOnBoard ?? null, atsCompanies: 0, fromAts: 0, fromBoard: 0,
    };
  }
  // The portfolios that are not also boards, so their companies' roles carry the firm.
  for (const [id, cfg] of Object.entries(portfolios ? INDIA_PORTFOLIOS : {})) {
    if (results.firms[id]) continue;
    const firm = state.portfolio?.firms?.[id];
    const known = Object.values(state.companies).some((co) => eligible(co) && co.firms.includes(id));
    results.firms[id] = {
      firmId: id, host: cfg.portfolio ? new URL(cfg.portfolio).hostname : null, platform: "portfolio",
      // Its companies stay listed when a week's crawl fails, as a board's do.
      status: firm?.lastDiscoveryAt || known ? "ok" : "error", reason: firm?.lastError || null,
      jobs: [], totalOnBoard: firm?.companies ?? null, atsCompanies: 0, fromAts: 0, fromBoard: 0,
    };
  }
  let atsJobs = 0, boardJobs = 0, retained = 0;
  const active = Object.values(state.companies).filter(eligible);
  for (const co of active) {
    const stale = !!co.lastError || due(co.lastSuccessAt, DAY, now);
    const hq = hqOf(co, boards);
    // inCountry again here, for rows a board snapshot or an older run saved.
    const jobs = co.lastJobs.map((j) => inCountry({ ...j, ...co.meta, company: co.company, hq, lastVerifiedAt: co.lastSuccessAt, stale }));
    const firms = co.firms.filter((id) => results.firms[id]);
    if (!firms.length) results.directJobs.push(...jobs);
    for (const firmId of firms) {
      const firm = results.firms[firmId];
      firm.jobs.push(...jobs);
      if (co.key) { firm.atsCompanies++; firm.fromAts += jobs.length; }
      else firm.fromBoard += jobs.length;
    }
    if (co.key) atsJobs += jobs.length; else boardJobs += jobs.length;
    if (co.lastError) retained += jobs.length;
  }
  for (const firm of Object.values(results.firms)) firm.jobs = dedupe(firm.jobs);
  results.directJobs = dedupe(results.directJobs);
  results.enrichment = {
    companies: active.filter((c) => c.key).length,
    reached: active.filter((c) => c.key && c.lastSuccessAt === now).length,
    fromAts: atsJobs, fromBoard: boardJobs, retained,
    countries: { US: 0, IN: 0 },
    failures: active.filter((c) => c.key && c.lastError).map((c) => ({ company: c.company, ats: c.ats, slug: c.slug, reason: c.lastError })),
  };
  for (const j of dedupe([...Object.values(results.firms).flatMap((f) => f.jobs), ...results.directJobs])) results.enrichment.countries[j.country === "IN" ? "IN" : "US"]++;
  if (!active.length && !Object.values(state.boards).some((b) => b.lastSuccessAt)) throw new Error("No company registry or successful discovery; refusing an empty refresh");
  if (!options.discoveryOnly && active.length && !active.some((co) => co.lastSuccessAt)) throw new Error("No company board could be verified and no previous jobs snapshot exists; refusing an empty refresh");
  state.updatedAt = now;
  compactBoardJobs(state);
  onEvent("done", { scrapedAt: now, enrichment: results.enrichment, discovery, repair });
  return results;
}
module.exports = { refreshRegistry, recordSuccess, hqOf };
