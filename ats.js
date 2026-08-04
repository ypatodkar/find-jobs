// Direct-from-company job fetching.
//
// A portfolio company's own applicant tracking system is the source of truth for
// its openings — VC aggregator boards lag it and drop roles. We never have to
// discover a company's careers page: the apply URLs already scraped from the VC
// boards tell us which ATS it uses and under what slug.
//
// Covers Ashby, Greenhouse and Lever (~83% of portfolio companies). Anything else
// keeps its VC-board listing rather than being dropped.

const { keep, deriveSeniority, isBlockedCompany } = require("./match");
const { jobId } = require("./id");
const { classifySponsorship, toPlainText } = require("./sponsorship");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

const CONCURRENCY = 6;
const TIMEOUT_MS = 25000; // large boards (Anduril, Databricks) are slow to serialise
const RETRIES = 1;

/**
 * Work out which ATS an apply URL belongs to, the company's slug on it, and where
 * possible the individual posting id. The posting id is what `id.js` hangs a stable
 * job id off, and reading it from the URL means a role keeps the same id whether it
 * reached us through phase 2 enrichment or stayed a VC-board listing.
 */
function detectAts(rawUrl) {
  if (!rawUrl) return null;
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, "");
  // Decode here so the adapters can re-encode cleanly; a slug like "Resolve%20AI"
  // would otherwise be double-encoded into "Resolve%2520AI".
  const seg = u.pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

  if (host.endsWith("ashbyhq.com")) {
    // jobs.ashbyhq.com/{slug}/{posting uuid}
    return seg[0] ? { ats: "ashby", slug: seg[0], postingId: seg[1] || null } : null;
  }
  if (host.endsWith("greenhouse.io")) {
    // Embedded boards carry the slug in ?for= and the posting in ?gh_jid=,
    // hosted boards use /{slug}/jobs/{id}.
    const embedded = u.searchParams.get("for");
    if (embedded) {
      return { ats: "greenhouse", slug: embedded, postingId: u.searchParams.get("gh_jid") || null };
    }
    if (seg[0] === "embed") return null;
    const hosted = seg[1] === "jobs" ? seg[2] : null;
    return seg[0] ? { ats: "greenhouse", slug: seg[0], postingId: hosted || null } : null;
  }
  if (host.endsWith("lever.co")) {
    // jobs.lever.co/{slug}/{posting uuid}
    return seg[0] ? { ats: "lever", slug: seg[0], postingId: seg[1] || null } : null;
  }
  return null;
}

async function getOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: ctrl.signal,
    });
    if (res.status === 404) {
      const e = new Error("board not found");
      e.permanent = true; // slug is wrong or the company left this ATS — retrying won't help
      throw e;
    }
    if (res.status === 429) throw new Error("rate limited");
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Retries transient failures (timeouts, 429s, 5xx) once; never retries a 404.
async function getJson(url) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await getOnce(url);
    } catch (err) {
      lastErr = err;
      if (err.permanent) break;
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr;
}

function money(range) {
  if (!range || range.min == null) return null;
  const fmt = (n) => Math.round(n).toLocaleString();
  const cur = range.currency || "USD";
  const per = /year/i.test(range.interval || "") ? " / year" : "";
  return range.max ? `${cur} ${fmt(range.min)}–${fmt(range.max)}${per}` : `${cur} ${fmt(range.min)}${per}`;
}

const ADAPTERS = {
  async ashby(slug) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`);
    return (data.jobs || []).map((j) => ({
      id: j.id || null,
      title: j.title,
      locations: [j.location, ...(j.secondaryLocations || []).map((s) => (typeof s === "string" ? s : s && s.location))],
      url: j.jobUrl || j.applyUrl,
      posted: j.publishedAt || null,
      remote: j.isRemote === true || /remote/i.test(j.workplaceType || ""),
      salary: null,
      description: j.descriptionPlain || j.descriptionHtml || "",
    }));
  },

  async greenhouse(slug) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`);
    return (data.jobs || []).map((j) => ({
      id: j.id != null ? String(j.id) : null,
      title: j.title,
      locations: [j.location && j.location.name, ...(j.offices || []).map((o) => o.name)],
      url: j.absolute_url,
      posted: j.first_published || j.updated_at || null,
      remote: /remote/i.test((j.location && j.location.name) || ""),
      salary: null,
      description: j.content || "",
    }));
  },

  async lever(slug) {
    const data = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`);
    return (Array.isArray(data) ? data : []).map((j) => {
      const c = j.categories || {};
      return {
        id: j.id || null,
        title: j.text,
        // `location` is often just "United States"; allLocations holds the real cities.
        locations: c.allLocations && c.allLocations.length ? c.allLocations : [c.location],
        url: j.hostedUrl || j.applyUrl,
        posted: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        remote: /remote/i.test(j.workplaceType || ""),
        salaryMin: j.salaryRange?.min || null,
        salaryMax: j.salaryRange?.max || null,
        salary: money(j.salaryRange),
        description: [
          j.descriptionPlain,
          j.descriptionBodyPlain,
          ...(j.lists || []).map((list) => `${list.text || ""}. ${toPlainText(list.content || "")}`),
          j.additionalPlain,
        ].filter(Boolean).join(". "),
      };
    });
  },
};

const SUPPORTED = Object.keys(ADAPTERS);
const isSupported = (ats) => SUPPORTED.includes(ats);

/** Fetch one company's live openings, filtered to target cities and engineering roles. */
async function fetchCompany(entry) {
  const adapter = ADAPTERS[entry.ats];
  if (!adapter) return { ...entry, ok: false, reason: "unsupported ATS", jobs: [] };
  try {
    const raw = await adapter(entry.slug);
    const jobs = [];
    for (const j of raw) {
      const locations = (j.locations || []).filter(Boolean);
      const hit = keep(j.title, locations);
      if (!hit) continue;
      // Prefer the id the API gave us; fall back to the one in the apply URL so a
      // job keeps its identity even if an adapter stops returning `id`.
      const atsId = j.id || (detectAts(j.url) || {}).postingId || null;
      const sponsorship = classifySponsorship(j.description);
      jobs.push({
        job_id: jobId({ company: entry.company, ats: entry.ats, atsId, title: j.title, city: hit.city }),
        title: j.title,
        company: entry.company,
        city: hit.city,
        locations: locations.slice(0, 3),
        roles: hit.roles,
        url: j.url || "",
        posted: j.posted,
        remote: !!j.remote,
        salaryMin: j.salaryMin || null,
        salaryMax: j.salaryMax || null,
        salary: j.salary || null,
        seniority: deriveSeniority(j.title),
        sponsorship: sponsorship.status,
        sponsorshipEvidence: sponsorship.evidence,
        sponsorshipTypes: sponsorship.types,
        // Company-level facts don't exist on an ATS board — they're carried over from
        // whichever VC board introduced us to this company.
        staffCount: entry.meta.staffCount,
        size: entry.meta.size,
        stage: entry.meta.stage,
        markets: entry.meta.markets,
        domain: entry.meta.domain,
        logo: entry.meta.logo,
        source: "ats",
        ats: entry.ats,
      });
    }
    return { ...entry, ok: true, jobs, scanned: raw.length };
  } catch (err) {
    return { ...entry, ok: false, reason: err.message, jobs: [] };
  }
}

/** Run fetchCompany over many companies with a bounded number of open requests. */
async function fetchAll(entries, onProgress) {
  const out = new Map();
  let i = 0;
  let done = 0;

  async function worker() {
    while (i < entries.length) {
      const entry = entries[i++];
      const res = await fetchCompany(entry);
      out.set(entry.key, res);
      done++;
      if (onProgress) onProgress({ done, total: entries.length, company: entry.company, ok: res.ok, count: res.jobs.length });
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return out;
}

/**
 * Build the company registry from already-scraped VC board jobs.
 * Key is `ats:slug`, so the same company found via several VC portfolios collapses
 * into one entry that remembers every firm that backs it.
 */
function buildRegistry(firms) {
  const registry = new Map();
  for (const [firmId, r] of Object.entries(firms)) {
    if (r.status !== "ok") continue;
    for (const job of r.jobs || []) {
      const d = detectAts(job.url);
      if (!d || !isSupported(d.ats)) continue;
      // Blocked here rather than after fetching, so their board is never requested.
      if (isBlockedCompany({ company: job.company, domain: job.domain, slug: d.slug })) continue;
      const key = `${d.ats}:${d.slug}`;
      if (!registry.has(key)) {
        registry.set(key, {
          key, ats: d.ats, slug: d.slug, company: job.company, firms: new Set(),
          meta: { staffCount: null, size: null, stage: null, markets: [], domain: null, logo: null },
        });
      }
      const entry = registry.get(key);
      entry.firms.add(firmId);

      // Only the Consider boards publish company facts, so take the first non-empty
      // value seen across every board that lists this company.
      const m = entry.meta;
      if (m.staffCount == null && job.staffCount != null) { m.staffCount = job.staffCount; m.size = job.size; }
      if (!m.stage && job.stage) m.stage = job.stage;
      if (!m.domain && job.domain) m.domain = job.domain;
      if (!m.logo && job.logo) m.logo = job.logo;
      if (job.markets && job.markets.length) {
        for (const mk of job.markets) if (!m.markets.includes(mk)) m.markets.push(mk);
      }
    }
  }
  return registry;
}

module.exports = { detectAts, isSupported, buildRegistry, fetchAll, SUPPORTED, CONCURRENCY };
