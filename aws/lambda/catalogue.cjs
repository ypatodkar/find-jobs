// Shared request contract and local implementation of the paginated catalogue.
// Production uses the same contract with PostgreSQL (catalogue-postgres.cjs).
const crypto = require('node:crypto');
const DIMENSIONS = { city: 'city', role: 'roles', seniority: 'seniority', company: 'company',
  notcompany: 'company', industry: 'markets', size: 'size', stage: 'stage',
  sponsorship: 'sponsorship', firm: 'firms' };
const ARRAYS = new Set(['roles', 'markets', 'firms']);
const SUMMARY_FIELDS = ['job_id', 'title', 'company', 'city', 'locations', 'roles', 'url', 'posted',
  'remote', 'salaryMin', 'salaryMax', 'salary', 'seniority', 'sponsorship',
  'sponsorshipEvidence', 'sponsorshipTypes', 'staffCount', 'size', 'stage', 'markets',
  'domain', 'logo', 'source', 'ats', 'firms'];
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function strings(value, max = 200, length = 200) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max || value.some(v => typeof v !== 'string' || v.length > length)) {
    throw fail(400, 'Invalid filter values.');
  }
  return [...new Set(value.filter(Boolean))];
}
function normalize(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'Invalid search.');
  const selected = {};
  for (const key of Object.keys(DIMENSIONS)) selected[key] = strings(input.selected?.[key]);
  const page = Number(input.page ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw fail(400, 'Invalid page.');
  if (input.query != null && (typeof input.query !== 'string' || input.query.length > 200)) throw fail(400, 'Search is too long.');
  const scopeFirm = typeof input.scopeFirm === 'string' ? input.scopeFirm : '';
  if (scopeFirm.length > 100) throw fail(400, 'Invalid investor.');
  return { selected, query: (input.query || '').trim(), page,
    view: input.view === 'grouped' ? 'grouped' : 'flat',
    sort: ['newest', 'oldest', 'salary', 'count', 'company', 'title'].includes(input.sort) ? input.sort : 'newest',
    range: ['7', '30', '90'].includes(String(input.range)) ? Number(input.range) : 0,
    salary: ['150', '200', '250', '300'].includes(String(input.salary)) ? Number(input.salary) * 1000 : 0,
    hideOpened: input.hideOpened === true, hideOpenedCompanies: input.hideOpenedCompanies === true,
    seenIds: strings(input.seenIds, 5000), scopeFirm,
  };
}
function summary(job) {
  const out = {};
  for (const k of SUMMARY_FIELDS) if (job[k] !== undefined) out[k] = job[k];
  out.roles ||= []; out.markets ||= []; out.firms ||= [];
  out.sponsorship ||= 'unknown';
  out.hasDescription = Boolean(job.description?.trim() || job.hasDescription);
  if (!/^https?:\/\//i.test(out.url || '')) out.url = '';
  if (out.logo && !/^https?:\/\//i.test(out.logo)) out.logo = null;
  return out;
}
function historySummary(job) {
  const s = summary(job);
  return Object.fromEntries(['job_id', 'title', 'company', 'city', 'url'].map(k => [k, s[k]]));
}
function unpack(data) {
  return (data.jobs || []).map(job => {
    const co = data.companies?.[job.c];
    if (!co) return job;
    return { ...Object.fromEntries((data.companyFields || []).map(k => [k, co[k]])), ...job, company: co.n };
  });
}
function entries(data) {
  const byId = new Map();
  for (const job of unpack(data)) {
    if (!job.job_id || !job.title || !job.company) continue;
    const old = byId.get(job.job_id);
    const description = String(job.description || old?.description || '').slice(0, 200000);
    const payload = summary({ ...job, description });
    if (old) payload.firms = [...new Set([...old.payload.firms, ...payload.firms])];
    // Invalid source dates must not break the whole database import.
    payload.posted = Number.isFinite(Date.parse(payload.posted)) ? new Date(payload.posted).toISOString() : null;
    byId.set(job.job_id, { job_id: job.job_id, payload, description,
      description_hash: hash(description), content_hash: hash(JSON.stringify([payload, description])) });
  }
  return [...byId.values()];
}
const values = (j, key) => {
  const field = DIMENSIONS[key];
  return ARRAYS.has(field) ? j[field] || [] : [j[field] || (key === 'sponsorship' ? 'unknown' : '')];
};
const time = j => Date.parse(j.posted) || 0;
const pay = j => j.salaryMax || j.salaryMin || 0;
const cmp = (a, b) => String(a).localeCompare(String(b), 'en');
function comparator(sort, counts = new Map()) {
  return (a, b) => {
    let n = 0;
    if (sort === 'company') n = cmp(a.company, b.company) || cmp(a.title, b.title);
    else if (sort === 'title') n = cmp(a.title, b.title) || cmp(a.company, b.company);
    else if (sort === 'oldest') n = Math.floor(time(a) / 86400000) - Math.floor(time(b) / 86400000) || cmp(a.title, b.title);
    else if (sort === 'salary') n = pay(b) - pay(a) || time(b) - time(a);
    else if (sort === 'count') n = (counts.get(b.company) || 0) - (counts.get(a.company) || 0) || time(b) - time(a);
    else n = time(b) - time(a);
    return n || cmp(a.job_id, b.job_id);
  };
}
function pageInfo(q, total, companies) {
  const pageSize = q.view === 'grouped' ? 40 : 45;
  const pageCount = Math.max(1, Math.ceil((q.view === 'grouped' ? companies : total) / pageSize));
  return { total, companies, pageSize, pageCount, page: Math.min(q.page, pageCount) };
}
const STOP = new Set('the and for with that this from have has was are were your you our their they will can into over more work team experience skills years software engineer engineering development develop using used built building company responsibilities requirements resume education university degree bachelor master strong ability including across about them these those all also'.split(' '));
function terms(resume) {
  const counts = new Map();
  for (const t of resume.toLowerCase().match(/[a-z][a-z0-9+#.\-]{1,30}/g) || []) {
    const word = t.replace(/[.\-]+$/, '');
    if (!STOP.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 80).map(([t]) => t);
}
class MemoryCatalogue {
  constructor(data, metadata = {}) {
    this.rows = entries(data);
    this.jobs = this.rows.map(r => ({ ...r.payload, description: r.description, descriptionHash: r.description_hash }));
    this.metadata = { scrapedAt: data.scrapedAt || null, ...metadata };
    this.cache = new Map(); this.quotas = new Map();
  }
  filter(q, skip) {
    const seen = new Set(q.seenIds);
    const openedCompanies = new Set(this.jobs.filter(j => seen.has(j.job_id)).map(j => j.company));
    const cutoff = Math.floor(Date.now() / 86400000) * 86400000 - (q.range - 1) * 86400000;
    return this.jobs.filter(j => {
      if (q.scopeFirm && !j.firms.includes(q.scopeFirm)) return false;
      for (const key of Object.keys(DIMENSIONS)) {
        if (key === skip || !q.selected[key].length) continue;
        const hit = values(j, key).some(v => q.selected[key].includes(v));
        if (key === 'notcompany' ? hit : !hit) return false;
      }
      return (!q.query || `${j.title}\n${j.company}`.toLowerCase().includes(q.query.toLowerCase())) &&
        (!q.range || (time(j) && time(j) >= cutoff)) && (!q.salary || pay(j) >= q.salary) &&
        (!q.hideOpened || !seen.has(j.job_id)) && (!q.hideOpenedCompanies || !openedCompanies.has(j.company));
    });
  }
  async search(input) {
    const q = normalize(input); const jobs = this.filter(q);
    const counts = new Map();
    for (const j of jobs) counts.set(j.company, (counts.get(j.company) || 0) + 1);
    jobs.sort(comparator(q.sort, counts));
    const info = pageInfo(q, jobs.length, counts.size);
    const start = (info.page - 1) * info.pageSize;
    const facets = {};
    for (const key of Object.keys(DIMENSIONS)) {
      const c = new Map();
      for (const j of this.filter(q, key)) for (const v of new Set(values(j, key))) if (v) c.set(v, (c.get(v) || 0) + 1);
      facets[key] = [...c];
    }
    const groups = [...counts.keys()].map(company => {
      const js = jobs.filter(j => j.company === company); const cities = new Map();
      for (const j of js) if (j.city) cities.set(j.city, (cities.get(j.city) || 0) + 1);
      return { ...summary(js[0]), company, count: js.length, jobs: js.slice(0, 3).map(summary), cities: [...cities],
        firms: [...new Set(js.flatMap(j => j.firms))], newest: Math.max(...js.map(time)),
        oldest: Math.min(...js.map(time)), payMax: Math.max(...js.map(pay)),
        titleFirst: js.map(j => j.title).sort(cmp)[0] };
    });
    groups.sort((a, b) => {
      const n = q.sort === 'company' ? cmp(a.company, b.company) : q.sort === 'title' ? cmp(a.titleFirst, b.titleFirst) :
        q.sort === 'salary' ? b.payMax - a.payMax : q.sort === 'count' ? b.count - a.count :
        q.sort === 'oldest' ? a.oldest - b.oldest : b.newest - a.newest;
      return n || cmp(a.company, b.company);
    });
    return { ...info, metadata: this.metadata, facets,
      jobs: q.view === 'flat' ? jobs.slice(start, start + info.pageSize).map(summary) : [],
      groups: q.view === 'grouped' ? groups.slice(start, start + info.pageSize) : [] };
  }
  async get(id) { return this.jobs.find(j => j.job_id === id) || null; }
  async history(ids) { const wanted = new Set(strings(ids, 5000)); return this.jobs.filter(j => wanted.has(j.job_id)).map(historySummary); }
  /**
   * The pool a shortlist is chosen from: everything the filters allow, that has a
   * description long enough to compare, optionally no older than `maxAgeDays`.
   *
   * Exists on both catalogues so the shortlist code can be written once. The in-memory
   * and Postgres stores rank candidates very differently — one in JS, one in SQL with
   * a tsvector — but both can answer "which jobs are eligible at all", and that is the
   * only thing the shortlist needs from storage.
   */
  async poolFor(input, maxAgeDays, now = Date.now()) {
    const jobs = this.filter(normalize(input));
    const described = jobs.filter(j => (j.description || '').trim().length >= 80);
    const cutoff = maxAgeDays == null ? null : now - maxAgeDays * 86400000;
    const fresh = cutoff === null ? described : described.filter(j => {
      const t = j.posted ? Date.parse(j.posted) : NaN;
      return Number.isFinite(t) && t >= cutoff;
    });
    return { total: jobs.length, described: described.length, jobs: fresh };
  }

  async candidates(input, resume, limit) {
    const jobs = this.filter(normalize(input)); const keywords = terms(resume);
    const available = jobs.filter(j => j.description.trim().length >= 80);

    // Score once per job, then sort on the number.
    //
    // This used to call rank() inside the comparator, which re-derived every job's
    // score on every comparison: ~268,000 comparisons over 10,000 jobs, each
    // lowercasing a 6 KB description once per keyword. With 83 keywords that is over
    // half a million lowercase-and-scan passes, and it measured at 375 seconds — all
    // of it synchronous, so the event loop was pinned and the whole server stopped
    // answering for the duration. The provider call it was preparing for takes 1.4s.
    //
    // Lowercasing once per job and scoring once per job makes it ~10,000 passes.
    const scored = new Array(available.length);
    for (let i = 0; i < available.length; i++) {
      const job = available[i];
      const haystack = job.description.toLowerCase();
      const title = job.title.toLowerCase();
      let score = 0;
      // A title hit counts triple: "Rust" in the title is the job, in the body it may
      // be one line of a tooling list.
      for (const t of keywords) {
        if (haystack.includes(t)) score += 1;
        if (title.includes(t)) score += 3;
      }
      scored[i] = { job, score };
    }
    const newest = comparator('newest');
    scored.sort((a, b) => b.score - a.score || newest(a.job, b.job));
    return { total: jobs.length, described: available.length,
      jobs: scored.slice(0, limit).map(s => s.job) };
  }
  async cacheGet(key) { const c = this.cache.get(key); return c?.expires > Date.now() ? c.value : null; }
  async cacheSet(key, value) {
    if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, { value, expires: Date.now() + 86400000 });
  }
  async quota(key, limit, windowMs, amount = 1) {
    const bucket = Math.floor(Date.now() / windowMs); const id = `${key}:${bucket}`;
    const count = this.quotas.get(id) || 0;
    if (count + amount > limit) return false;
    if (this.quotas.size > 5000) this.quotas.clear();
    this.quotas.set(id, count + amount); return true;
  }
}
module.exports = { DIMENSIONS, ARRAYS, fail, strings, normalize, summary, historySummary, unpack, entries, hash, terms, pageInfo, MemoryCatalogue };
