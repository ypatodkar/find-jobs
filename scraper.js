const { BOARDS, LOCATIONS } = require("./boards");
const { keep, dedupe, deriveSeniority, sizeBucket, isBlockedCompany } = require("./match");
const { classifySponsorship } = require("./sponsorship");

// Consider exposes a few logo variants keyed by where it found them; `manual` is the
// curated 160px one and the best of them, with the LinkedIn scrape as a fallback.
function logoOf(logos) {
  if (!logos || typeof logos !== "object") return null;
  for (const key of ["manual", "linkedin", "clearbit", "website"]) {
    const v = logos[key];
    if (v && typeof v === "object" && v.src) return v.src;
    if (typeof v === "string" && v) return v;
  }
  return null;
}

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
const considerSessions = new Map();

// Every request here is capped, because undici's default is 300s and nothing upstream
// is worth five minutes. Without this a single stalled board costs 300s per attempt and
// 15 minutes across the retries, which is how a manual refresh once burned 20 of its 25
// minute budget on two firms and was killed before reaching the other 52. ats.js has
// always done this; phase 1 had not.
const REQUEST_TIMEOUT_MS = 25000;

function withTimeout(url, init) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function postJson(url, body, headers) {
  const res = await withTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", "user-agent": UA, ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Consider began requiring its normal browser CSRF handshake in August 2026. The
 * public jobs page seeds both a signed session cookie and a token in
 * `window.serverInitialData`; the search endpoint rejects a bare POST with 412.
 * Cache one handshake per host because a scrape can split into several requests.
 */
async function considerSession(cfg) {
  if (considerSessions.has(cfg.host)) return considerSessions.get(cfg.host);

  const pending = (async () => {
    const url = `https://${cfg.host}/jobs`;
    const res = await withTimeout(url, { headers: { accept: "text/html", "user-agent": UA } });
    if (!res.ok) throw new Error(`Consider session HTTP ${res.status}`);
    const html = await res.text();
    const match = html.match(/"csrfToken":"([^"]+)"/);
    // A missing token used to be reported as if the page had merely left one out. It
    // more often means the board is no longer the Consider app at all: the rewritten
    // ones serve a large server-rendered page with no session cookie and answer 404 on
    // /api-boards/search-jobs, so no retry or header will ever recover them. Say which
    // of the two it is, because they need completely different responses.
    if (!match) {
      const migrated = /_next\//.test(html) && !/serverInitialData/.test(html);
      throw new Error(migrated
        ? "board no longer runs Consider (rewritten front end, old API is gone) — needs a new adapter"
        : "Consider session did not include a CSRF token");
    }

    const setCookies = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie")].filter(Boolean);
    const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
    if (!cookie) throw new Error("Consider session did not include cookies");
    return { token: match[1], cookie };
  })();

  considerSessions.set(cfg.host, pending);
  try {
    return await pending;
  } catch (err) {
    considerSessions.delete(cfg.host);
    throw err;
  }
}

// Consider caps a response at 1000 rows and offers no offset, so a location set that
// matches more than that would silently truncate. Split the set and recurse until
// every chunk comes back under the cap.
async function considerFetch(cfg, locations, depth = 0) {
  const session = await considerSession(cfg);
  const data = await postJson(
    `https://${cfg.host}/api-boards/search-jobs`,
    {
      meta: { size: CONSIDER_PAGE_SIZE },
      board: { id: cfg.boardId, isParent: true },
      query: { locations, jobFunctions: ["Engineering"] },
    },
    {
      referer: `https://${cfg.host}/jobs`,
      origin: `https://${cfg.host}`,
      cookie: session.cookie,
      "x-csrf-token": session.token,
    }
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
    if (isBlockedCompany({ company, domain: j.companyDomain, slug: (detectAts(url) || {}).slug })) continue;
    // Salary is a structured object here — an earlier `j.salary.text` read silently
    // returned undefined for every role on all eight Consider boards.
    const s = j.salary || {};
    const staffCount = j.companyStaffCount || null;
    const sponsorship = classifySponsorship(j.descriptionPlain || j.description || j.descriptionHtml || j.content || "");
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
      sponsorship: sponsorship.status,
      sponsorshipEvidence: sponsorship.evidence,
      sponsorshipTypes: sponsorship.types,
      staffCount,
      size: sizeBucket(staffCount),
      stage: j.fundingLV?.label || null,
      markets: labels(j.markets),
      domain: j.companyDomain || null,
      logo: logoOf(j.companyLogos),
      source: "board",
    });
  }
  return { jobs: out, scanned: (data.jobs || []).length, totalOnBoard: data.total ?? null };
}

// ---- a16z's rewritten board ----
//
// In August 2026 jobs.a16z.com stopped being the Consider app: /api-boards/search-jobs
// answers 404 and the page is now server-rendered with no session to establish. The
// data is still there, just delivered rather than queried — which means no search
// endpoint to ask for "engineering roles in these cities", and no way to page the
// 18,000 listings from the index.
//
// So it is read the other way round. /companies server-renders the entire portfolio in
// one request — 852 companies, each with a domain, headcount, stage, markets and a
// jobCount — and each company's own page carries its openings with real apply URLs.
// Fetching the ~400 companies that are actually hiring costs about as much as phase 2
// already spends, and skips the 440 that would return nothing.
//
// What matters downstream is the apply URL: buildRegistry reads the ATS and slug out of
// it, and phase 2 then goes to the employer's own board for the authoritative list. The
// jobs collected here are the fallback for companies whose ATS we cannot read.
const A16Z_COMPANY_CONCURRENCY = 6;

/**
 * Decode the JSON a Next.js page ships inside self.__next_f.push([1,"…"]) chunks.
 *
 * Each chunk is a JavaScript string literal, so JSON.parse is what decodes it — hand
 * unescaping gets every description containing a quote or a backslash wrong, and this
 * payload is mostly prose. Chunks that fail to parse are skipped rather than aborting
 * the page: the array we want may already be complete.
 */
function decodeFlight(html) {
  let out = "";
  const re = /self\.__next_f\.push\(\[1,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
  let m;
  while ((m = re.exec(html))) {
    try { out += JSON.parse(m[1]); } catch { /* unreadable chunk */ }
  }
  return out;
}

/** Find `"key":[ … ]` in decoded text and parse it, matching brackets rather than regex. */
function extractArray(text, key) {
  const marker = `"${key}":[`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const open = start + marker.length - 1;
  let depth = 0, inStr = false, esc = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (inStr) { if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      if (--depth === 0) {
        try { return JSON.parse(text.slice(open, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

async function fetchFlightArray(url, key) {
  const res = await withTimeout(url, { headers: { accept: "text/html", "user-agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return extractArray(decodeFlight(await res.text()), key);
}

async function scrapeA16z(cfg) {
  const companies = await fetchFlightArray(`https://${cfg.host}/companies`, "companies");
  if (!Array.isArray(companies) || !companies.length) {
    throw new Error("a16z: no company list in /companies — page shape changed");
  }

  // jobCount is published per company, so the 440-odd with nothing open are never
  // requested. Sorted by size so a truncated run still gets the biggest employers.
  const hiring = companies
    .filter((c) => c && c.slug && c.jobCount > 0)
    .sort((a, b) => b.jobCount - a.jobCount);

  const out = [];
  const seen = new Set();
  let scanned = 0;
  let failures = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < hiring.length) {
      const co = hiring[cursor++];
      let jobs;
      try {
        jobs = await fetchFlightArray(`https://${cfg.host}/jobs/${encodeURIComponent(co.slug)}`, "jobs");
      } catch {
        failures++;
        continue;
      }
      if (!Array.isArray(jobs)) { failures++; continue; }
      scanned += jobs.length;

      for (const j of jobs) {
        const url = j.apply_url || "";
        const dedupeKey = url || `${co.name}|${j.title}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const locations = (j.locations || []).filter(Boolean);
        const hit = keep(j.title, locations);
        if (!hit) continue;
        const company = j.company_name || co.name || "";
        if (isBlockedCompany({ company, domain: co.domain, slug: (detectAts(url) || {}).slug })) continue;

        const staffCount = co.headcount || null;
        const sponsorship = classifySponsorship(j.description_html || "");
        out.push({
          job_id: boardJobId(company, j.title, hit.city, url),
          title: j.title,
          company,
          city: hit.city,
          locations: locations.slice(0, 3),
          roles: hit.roles,
          url,
          posted: j.posted_at || null,
          remote: !!j.remote,
          salaryMin: j.salary_min || null,
          salaryMax: j.salary_max || null,
          salary: fmtSalary(j.salary_min, j.salary_max, j.salary_currency || "USD", j.salary_period),
          seniority: deriveSeniority(j.title),
          sponsorship: sponsorship.status,
          sponsorshipEvidence: sponsorship.evidence,
          sponsorshipTypes: sponsorship.types,
          staffCount,
          size: sizeBucket(staffCount),
          stage: co.stage || j.company_stage || null,
          markets: co.markets || j.company_markets || [],
          domain: co.domain || null,
          logo: co.logoUrl || j.company_logo || null,
          source: "board",
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(A16Z_COMPANY_CONCURRENCY, hiring.length) }, worker)
  );

  // A handful of unreachable company pages is ordinary; losing most of them means the
  // page shape moved again, and shipping a near-empty a16z is worse than failing loudly.
  if (failures > hiring.length / 2) {
    throw new Error(`a16z: ${failures}/${hiring.length} company pages unreadable`);
  }
  return { jobs: out, scanned, totalOnBoard: companies.reduce((a, c) => a + (c.jobCount || 0), 0) };
}

/**
 * Greylock's rewritten board.
 *
 * jobs.greylock.com now 301s to greylock.com/jobs/portfolio-jobs, which server-renders
 * its first 60 rows and nothing else: there is no company index to walk, and page,
 * offset and limit params are all ignored, so 60 of a claimed 1,962 is genuinely all
 * that one request can see.
 *
 * That is a much smaller loss than it sounds. Those 60 rows span 23 companies and 12 of
 * them appear on no other portfolio, which is nearly the entire set Greylock uniquely
 * contributed. Discovery is what phase 1 owes phase 2 — once a company is named, its own
 * ATS is fetched for the real listing — so seeing a fraction of the roles still recovers
 * almost all of the companies.
 */
async function scrapeGreylock(cfg) {
  const jobs = await fetchFlightArray(`https://${cfg.host}${cfg.path || "/jobs/portfolio-jobs"}`, "jobs");
  if (!Array.isArray(jobs) || !jobs.length) {
    throw new Error("greylock: no jobs in the page — shape changed");
  }

  const seen = new Set();
  const out = [];
  for (const j of jobs) {
    const url = j.applyUrl || "";
    const dedupeKey = url || `${j.companyName}|${j.title}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const locations = (j.locations || j.normalizedLocations || []).filter(Boolean);
    const hit = keep(j.title, locations);
    if (!hit) continue;
    const company = j.companyName || "";
    if (isBlockedCompany({ company, domain: j.companyDomain, slug: (detectAts(url) || {}).slug })) continue;

    const s = j.salary || {};
    const sponsorship = classifySponsorship("");
    out.push({
      job_id: boardJobId(company, j.title, hit.city, url),
      title: j.title,
      company,
      city: hit.city,
      locations: locations.slice(0, 3),
      roles: hit.roles,
      url,
      posted: j.createdAt || null,
      remote: j.workMode === "remote",
      salaryMin: s.min || null,
      salaryMax: s.max || null,
      salary: fmtSalary(s.min, s.max, s.currency || "USD", s.period),
      seniority: deriveSeniority(j.title),
      // No description ships with the row — hasDescription only says one exists behind
      // another request — so sponsorship stays unknown rather than being guessed from
      // a title. Phase 2 classifies it properly from the employer's own posting.
      sponsorship: sponsorship.status,
      sponsorshipEvidence: null,
      sponsorshipTypes: [],
      staffCount: null,
      size: null,
      stage: j.stage || null,
      markets: j.markets || [],
      domain: j.companyDomain || null,
      logo: j.logoUrl || null,
      source: "board",
    });
  }
  return { jobs: out, scanned: jobs.length, totalOnBoard: null };
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
      if (isBlockedCompany({ company, domain: j.organization?.domain, slug: (detectAts(url) || {}).slug })) continue;
      const sponsorship = classifySponsorship(j.descriptionPlain || j.description || j.descriptionHtml || j.content || "");
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
        sponsorship: sponsorship.status,
        sponsorshipEvidence: sponsorship.evidence,
        sponsorshipTypes: sponsorship.types,
        // Getro's head_count is a bucket index, not a headcount, so size is left to
        // the Consider boards which publish a real number.
        staffCount: null,
        size: null,
        stage: null,
        markets: j.organization?.industry_tags || [],
        domain: null,
        logo: j.organization?.logo_url || null,
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
      const res = cfg.platform === "consider" ? await scrapeConsider(cfg)
        : cfg.platform === "a16z" ? await scrapeA16z(cfg)
        : cfg.platform === "greylock" ? await scrapeGreylock(cfg)
        : await scrapeGetro(cfg);
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

module.exports = { scrapeFirm, BOARDS, considerSession };
