const { BOARDS, LOCATIONS } = require("./boards");
const { keep, dedupe, deriveSeniority, sizeBucket } = require("./match");

const labels = (arr) => (arr || []).map((x) => (x && x.label) || x).filter(Boolean);

function fmtSalary(min, max, currency, period) {
  if (!min) return null;
  const n = (v) => Math.round(v).toLocaleString();
  const per = /year/i.test(period || "") ? " / year" : period ? ` / ${period.toLowerCase()}` : "";
  return max && max !== min ? `${currency} ${n(min)}–${n(max)}${per}` : `${currency} ${n(min)}${per}`;
}
const { detectAts } = require("./ats");
const { jobId } = require("./id");

/**
 * Board listings carry no id of their own, but their apply URL usually points at an
 * ATS posting. Deriving the id from that URL means a role that phase 2 later fetches
 * directly resolves to the same job id, so its click count carries over.
 */
function boardJobId(company, title, city, url) {
  const d = detectAts(url);
  return jobId({ company, title, city, ats: d && d.postingId ? d.ats : null, atsId: d ? d.postingId : null });
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const CONSIDER_PAGE_SIZE = 1000; // hard ceiling: 2000 returns an empty body
// The param is snake_case; `hitsPerPage` is silently ignored and capped at 20.
const GETRO_PAGE_SIZE = 500;
const GETRO_MAX_PAGES = 12;
const SCRAPE_RETRIES = 2; // backs off 2s then 4s

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Consider caps a response at 1000 rows and offers no offset, so a location set that
// matches more than that would silently truncate. Split the set and recurse until
// every chunk comes back under the cap.
async function considerFetch(cfg, locations, depth = 0) {
  const data = await postJson(
    `https://${cfg.host}/api-boards/search-jobs`,
    {
      meta: { size: CONSIDER_PAGE_SIZE },
      board: { id: cfg.boardId, isParent: true },
      query: { locations, jobFunctions: ["Engineering"] },
    },
    { referer: `https://${cfg.host}/jobs`, origin: `https://${cfg.host}` }
  );
  const jobs = data.jobs || [];

  if (jobs.length >= CONSIDER_PAGE_SIZE && locations.length > 1 && depth < 5) {
    const mid = Math.ceil(locations.length / 2);
    const [a, b] = await Promise.all([
      considerFetch(cfg, locations.slice(0, mid), depth + 1),
      considerFetch(cfg, locations.slice(mid), depth + 1),
    ]);
    return { jobs: a.jobs.concat(b.jobs), total: data.total ?? null };
  }
  return { jobs, total: data.total ?? null };
}

async function scrapeConsider(cfg) {
  const data = await considerFetch(cfg, LOCATIONS.consider);

  const seen = new Set();
  const out = [];
  for (const j of data.jobs || []) {
    // Chunked requests can overlap, so drop repeats before they reach the UI.
    const dedupeKey = j.applyUrl || j.url || `${j.companyName}|${j.title}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const locations = j.locations || [];
    const hit = keep(j.title, locations);
    if (!hit) continue;
    const company = j.companyName || "";
    const url = j.applyUrl || j.url || "";
    // Salary is a structured object here — an earlier `j.salary.text` read silently
    // returned undefined for every role on all eight Consider boards.
    const s = j.salary || {};
    const staffCount = j.companyStaffCount || null;
    out.push({
      job_id: boardJobId(company, j.title, hit.city, url),
      title: j.title,
      company,
      city: hit.city,
      locations: locations.slice(0, 3),
      roles: hit.roles,
      url,
      posted: j.timeStamp || null,
      remote: !!j.remote,
      salaryMin: s.minValue || null,
      salaryMax: s.maxValue || null,
      salary: fmtSalary(s.minValue, s.maxValue, s.currency?.label || "USD", s.period?.label),
      seniority: deriveSeniority(j.title),
      staffCount,
      size: sizeBucket(staffCount),
      stage: j.fundingLV?.label || null,
      markets: labels(j.markets),
      domain: j.companyDomain || null,
      source: "board",
    });
  }
  return { jobs: out, scanned: (data.jobs || []).length, totalOnBoard: data.total ?? null };
}

async function scrapeGetro(cfg) {
  const out = [];
  let scanned = 0;
  let count = null;

  for (let page = 0; page < GETRO_MAX_PAGES; page++) {
    const data = await postJson(
      `https://api.getro.com/api/v2/collections/${cfg.networkId}/search/jobs`,
      {
        hits_per_page: GETRO_PAGE_SIZE,
        page,
        query: "",
        filters: {
          searchable_locations: LOCATIONS.getro,
          job_functions: ["Software Engineering", "Data Science"],
        },
      },
      { origin: `https://${cfg.host}`, referer: `https://${cfg.host}/` }
    );

    const jobs = data.results?.jobs || [];
    if (count === null) count = data.results?.count ?? null;
    scanned += jobs.length;

    for (const j of jobs) {
      const locations = j.searchable_locations || [];
      const hit = keep(j.title, locations);
      if (!hit) continue;
      const company = j.organization?.name || "";
      const url = j.url || "";
      out.push({
        job_id: boardJobId(company, j.title, hit.city, url),
        title: j.title,
        company,
        city: hit.city,
        locations: locations.filter((l) => /USA|United States/i.test(l)).slice(0, 3),
        roles: hit.roles,
        url,
        posted: j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
        remote: j.work_mode === "remote",
        salaryMin: j.compensation_amount_min_cents ? j.compensation_amount_min_cents / 100 : null,
        salaryMax: j.compensation_amount_max_cents ? j.compensation_amount_max_cents / 100 : null,
        salary: fmtSalary(
          j.compensation_amount_min_cents ? j.compensation_amount_min_cents / 100 : null,
          j.compensation_amount_max_cents ? j.compensation_amount_max_cents / 100 : null,
          j.compensation_currency || "USD",
          j.compensation_period
        ),
        seniority: deriveSeniority(j.title),
        // Getro's head_count is a bucket index, not a headcount, so size is left to
        // the Consider boards which publish a real number.
        staffCount: null,
        size: null,
        stage: null,
        markets: j.organization?.industry_tags || [],
        domain: null,
        source: "board",
      });
    }

    if (jobs.length < GETRO_PAGE_SIZE) break;
  }
  return { jobs: out, scanned, totalOnBoard: count };
}

async function scrapeFirm(firmId) {
  const cfg = BOARDS[firmId];
  if (!cfg) return { firmId, status: "unsupported", reason: "No board configured", jobs: [] };
  if (!cfg.platform) return { firmId, status: "unsupported", reason: cfg.reason, jobs: [], host: cfg.host };

  // Retry transient failures. Without this a single "fetch failed" — a blip on a
  // shared CI runner — empties that firm's whole listing until the next scheduled
  // run twelve hours later. ats.js has retried from the start; this did not.
  let lastErr;
  for (let attempt = 0; attempt <= SCRAPE_RETRIES; attempt++) {
    try {
      const res = cfg.platform === "consider" ? await scrapeConsider(cfg) : await scrapeGetro(cfg);
      return {
        firmId,
        status: "ok",
        host: cfg.host,
        platform: cfg.platform,
        jobs: dedupe(res.jobs),
        scanned: res.scanned,
        totalOnBoard: res.totalOnBoard,
        scrapedAt: new Date().toISOString(),
      };
    } catch (err) {
      lastErr = err;
      if (attempt < SCRAPE_RETRIES) await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return { firmId, status: "error", host: cfg.host, platform: cfg.platform, reason: lastErr.message, jobs: [] };
}

module.exports = { scrapeFirm, BOARDS };
