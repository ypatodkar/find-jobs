// Durable company identities and last successful observations. Job refreshes never
// rebuild this catalogue from today's VC listings or discard quiet companies.
const fs = require("node:fs/promises");
const path = require("node:path");
const { detectAts, isSupported } = require("./ats");
const { isBlockedCompany, sizeBucket } = require("./match");

const DAY = 86400000;
const DISCOVERY_INTERVAL = 7 * DAY;
const HEADCOUNT_INTERVAL = 30 * DAY;
const REPAIR_INTERVAL = 7 * DAY;
const STATE_FILE = path.join(__dirname, "../data/scraper-state.json");
const SEED_FILE = path.join(__dirname, "../config/companies.json");
const META_FIELDS = ["staffCount", "size", "stage", "markets", "domain", "logo"];
const due = (at, interval, now) => !at || Date.parse(now) - Date.parse(at) >= interval;
const nameKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function domainOf(value) {
  if (!value) return null;
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return null; }
}
function emptyState() { return { version: 1, companies: {}, boards: {}, updatedAt: null }; }
function validateState(state) {
  if (state?.version !== 1 || !state.companies || Array.isArray(state.companies) || !state.boards || Array.isArray(state.boards)) {
    throw new Error("Invalid scraper state; refusing to reset the company registry");
  }
  for (const [id, co] of Object.entries(state.companies)) {
    if (co.id !== id || !co.company || !Array.isArray(co.firms) || !co.meta || !Array.isArray(co.lastJobs)) {
      throw new Error(`Invalid registry company: ${id}`);
    }
  }
  return state;
}
async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (err) { if (err.code === "ENOENT") return fallback; throw err; }
}
async function atomicJson(file, value, space = 0) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, space));
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}

// A local import and refresh must not overwrite each other's state. CI additionally
// serializes runs using the deploy concurrency group.
async function withStateLock(file, work) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  let handle;
  try { handle = await fs.open(lock, "wx"); }
  catch (err) {
    if (err.code === "EEXIST") throw new Error(`Another registry operation holds ${lock}; remove it only if that process has stopped`);
    throw err;
  }
  try { await handle.writeFile(String(process.pid)); return await work(); }
  finally { await handle.close(); await fs.rm(lock, { force: true }); }
}

function boardKey(job) {
  const ats = detectAts(job.url);
  return ats && isSupported(ats.ats) ? `${ats.ats}:${ats.slug}` : null;
}

function findCompany(state, job, firmId) {
  const key = boardKey(job), domain = domainOf(job.domain);
  const companies = Object.values(state.companies);
  if (key) {
    const exact = companies.find((co) => co.key === key);
    if (exact) return exact;
  }
  // Only merge an unresolved company by domain. Two real ATS boards on one domain
  // can be separate subsidiaries; changing a working board requires validation.
  if (domain) {
    const candidates = companies.filter((co) => domainOf(co.meta.domain) === domain && (!key || !co.key));
    if (candidates.length === 1) return candidates[0];
  }
  const generic = /^(stealth|stealthstartup|confidential|undisclosed)$/.test(nameKey(job.company));
  const named = companies.filter((co) => (!key || !co.key) && nameKey(co.company) === nameKey(job.company) &&
    (!generic || co.firms.includes(firmId)) && (!domain || !co.meta.domain || domainOf(co.meta.domain) === domain));
  return named.length === 1 ? named[0] : named.find((co) => co.firms.includes(firmId));
}

function observeCompany(state, job, { firmId = null, sourceUrl = null, now, seeded = false } = {}) {
  if (!job.company || isBlockedCompany({ company: job.company, domain: job.domain, slug: detectAts(job.url)?.slug })) return null;
  const ats = detectAts(job.url);
  let co = findCompany(state, job, firmId);
  if (!co) {
    const identity = boardKey(job) || (domainOf(job.domain) ? `domain:${domainOf(job.domain)}` : `name:${nameKey(job.company)}`);
    let id = identity, suffix = 1;
    while (state.companies[id]) id = `${identity}:${suffix++}`;
    co = state.companies[id] = {
      id, company: job.company, key: null, ats: null, slug: null, firms: [], sources: [],
      meta: { staffCount: null, size: null, stage: null, markets: [], domain: null, logo: null },
      careersUrl: null, firstSeenAt: now, lastSeenAt: now, lastJobs: [],
      lastSuccessAt: null, consecutiveFailures: 0, lastRepairAt: null,
    };
  }
  if (ats && isSupported(ats.ats) && !co.key) {
    co.ats = ats.ats; co.slug = ats.slug; co.key = `${ats.ats}:${ats.slug}`;
  }
  // A portfolio job page can recommend other employers. Do not treat its links as
  // this company's own careers site during automatic resolution.
  if (!co.careersUrl && job.url && (!firmId || ats || !sourceUrl || domainOf(job.url) !== domainOf(sourceUrl))) co.careersUrl = job.url;
  if (firmId && !co.firms.includes(firmId)) co.firms.push(firmId);
  if (sourceUrl && !co.sources.includes(sourceUrl)) co.sources.push(sourceUrl);
  co.lastSeenAt = now;
  for (const field of META_FIELDS.filter((f) => !["staffCount", "size"].includes(f))) {
    if (job[field] != null && (!Array.isArray(job[field]) || job[field].length)) co.meta[field] = job[field];
  }
  // Seeing the old value in our own snapshot is not fresh verification. We retain
  // its original timestamp. Missing values never erase existing evidence.
  if (Number.isFinite(job.staffCount) && job.staffCount > 0 && due(co.headcount?.observedAt, HEADCOUNT_INTERVAL, now)) {
    co.meta.staffCount = job.staffCount;
    co.meta.size = sizeBucket(job.staffCount);
    co.headcount = { value: job.staffCount, observedAt: now, sourceUrl, seeded };
  }
  return co;
}

function ingestBoard(state, firmId, result, now, sourceUrl, seeded = false) {
  if (result.status !== "ok") return;
  for (const job of result.jobs || []) observeCompany(state, job, { firmId, sourceUrl, now, seeded });
}

function compactBoardJobs(state) {
  const byKey = new Map(Object.values(state.companies).filter((co) => co.key && co.lastAtsSuccessAt).map((co) => [co.key, co]));
  for (const board of Object.values(state.boards)) {
    if (!board.jobs) continue;
    board.jobs = board.jobs.map((job) => {
      if (!byKey.has(boardKey(job))) return job;
      // The authoritative full posting is already saved once on the company. VC
      // copies only need identity and compensation for future merges.
      const { company, title, city, url, job_id, domain, salaryMin, salaryMax, salary } = job;
      return { company, title, city, url, job_id, domain, salaryMin, salaryMax, salary };
    });
  }
}

function seedResults(state, results, descriptions = {}, boards = {}) {
  if (!results?.scrapedAt) return;
  const now = results.scrapedAt;
  for (const [firmId, result] of Object.entries(results.firms || {})) {
    if (result.status !== "ok") continue;
    const restored = { ...result, jobs: (result.jobs || []).map((j) => ({ ...j, description: descriptions[j.job_id] || j.description || "" })) };
    const source = boards[firmId]?.host ? `https://${boards[firmId].host}` : null;
    ingestBoard(state, firmId, restored, now, source, true);
    state.boards[firmId] = { ...restored, lastSuccessAt: now, lastDiscoveryAt: now, lastAttemptAt: now };
    for (const job of restored.jobs) {
      const co = findCompany(state, job, firmId);
      if (!co) continue;
      const same = co.lastJobs.findIndex((j) => j.title === job.title && j.city === job.city);
      if (same < 0) co.lastJobs.push(job);
      else if (co.lastJobs[same].source !== "ats" && job.source === "ats") co.lastJobs[same] = job;
      co.lastSuccessAt = now;
      if (job.source === "ats") co.lastAtsSuccessAt = now;
    }
  }
  compactBoardJobs(state);
}

async function loadState(file = STATE_FILE, { seedFile = SEED_FILE, resultsFile, descriptionsFile, boards = {} } = {}) {
  const saved = await readJson(file);
  const state = saved ? validateState(saved) : emptyState();
  const seed = await readJson(seedFile, { companies: [] });
  for (const co of seed.companies || []) {
    if (state.companies[co.id] || (co.key && Object.values(state.companies).some((c) => c.key === co.key))) continue;
    const existing = findCompany(state, { company: co.company, ...co.meta, url: co.careersUrl }, co.firms?.[0]);
    if (existing) {
      existing.firms = [...new Set([...existing.firms, ...co.firms])];
      existing.sources = [...new Set([...existing.sources, ...co.sources])];
      continue;
    }
    state.companies[co.id] = { ...co, lastJobs: [], lastSuccessAt: null, consecutiveFailures: 0, lastRepairAt: null };
  }
  if (!saved && resultsFile) seedResults(state, await readJson(resultsFile), descriptionsFile ? await readJson(descriptionsFile, {}) : {}, boards);
  return validateState(state);
}

function atsEntry(co) { return { ...co, firms: new Set(co.firms) }; }
function seedPayload(state) {
  return { version: 1, companies: Object.values(state.companies).sort((a, b) => a.id.localeCompare(b.id)).map((co) => {
    const { id, company, key, ats, slug, firms, sources, meta, careersUrl, firstSeenAt, lastSeenAt, headcount } = co;
    return { id, company, key, ats, slug, firms, sources, meta, careersUrl, firstSeenAt, lastSeenAt, headcount };
  }) };
}
module.exports = {
  DAY, DISCOVERY_INTERVAL, HEADCOUNT_INTERVAL, REPAIR_INTERVAL, STATE_FILE, SEED_FILE,
  due, domainOf, emptyState, validateState, readJson, atomicJson, withStateLock,
  boardKey, findCompany, observeCompany, ingestBoard, compactBoardJobs, seedResults, loadState, atsEntry, seedPayload,
};
