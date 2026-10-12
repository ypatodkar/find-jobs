const crypto = require('node:crypto');
const { fail, summary, normalize } = require('./catalogue.cjs');
const { assess, requestFor, MODEL, RUBRIC_VERSION } = require('./jev.cjs');
const { buildShortlist } = require('./shortlist.cjs');
const { storeFor } = require('./traces.cjs');
const LIMIT = 30;
function digest(value, secret) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }
function cacheKey(resume, job, secret) {
  return digest(JSON.stringify([RUBRIC_VERSION, MODEL, resume, job.job_id, job.title, job.descriptionHash, job.description]), secret);
}
async function match(catalogue, body, clientId, options = {}) {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  if (!body || body.consent !== true) throw fail(400, 'Confirm that your resume may be sent to TypeSafe AI for this comparison.');
  const resume = typeof body.resume === 'string' ? body.resume.trim() : '';
  if (resume.length < 100 || Buffer.byteLength(resume) > 16000) throw fail(400, 'Paste a resume between 100 characters and 16 KB.');
  const apiKey = options.apiKey || process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw fail(503, 'Resume matching is not configured yet. Job browsing is available.');
  const secret = process.env.MATCH_CACHE_SECRET || apiKey;
  const userKey = 'client:' + digest(clientId || 'unknown', secret);
  if (!await catalogue.quota(userKey, 12, 3600000)) throw fail(429, 'You have reached the hourly matching limit. Please try again later.');

  // Two shapes share this handler. `job_id` compares against exactly one posting —
  // the button on a row — and costs one provider call. Without it the request is the
  // shortlist: filters in, up to LIMIT comparisons out. Single-job is not a special
  // case downstream; it just produces a candidate set of one, so caching, budgets,
  // passage resolution and the response shape are identical either way.
  let candidates, trace = null, windowDays = null;
  if (typeof body.job_id === 'string' && body.job_id) {
    const job = await catalogue.get(body.job_id);
    if (!job) throw fail(404, 'That job is no longer listed.');
    if (!job.description) throw fail(422, 'This role has no description stored yet, so it cannot be compared.');
    candidates = { jobs: [job], total: 1, described: 1 };
  } else {
    normalize(body.filters || {});
    const built = await buildShortlist(catalogue, {
      resume, filters: body.filters || {},
      // Clamped, because these arrive from a request: a limit of 500 would be 500
      // provider calls on someone else's key.
      limit: Math.max(1, Math.min(60, Number(body.limit) || LIMIT)),
      windowDays: Math.max(1, Math.min(365, Number(body.windowDays) || 4)),
      perCompany: Math.max(1, Math.min(10, Number(body.perCompany) || 2)),
    }, { apiKey });
    trace = built.trace;
    windowDays = built.windowDays;
    candidates = { jobs: built.jobs, total: built.jobs.length,
      described: built.trace.steps[0]?.detail?.withDescription ?? built.jobs.length };
  }
  if (!candidates.jobs.length) return { matches: [], total: candidates.total, described: candidates.described,
    assessed: 0, failed: 0, model: MODEL, message: candidates.total ? 'These roles do not have usable descriptions yet. Try broader filters or return after the next update.' : 'No jobs match your current filters.' };
  const missing = [], matches = [];
  for (const job of candidates.jobs) {
    const key = cacheKey(resume, job, secret);
    const cached = await catalogue.cacheGet(key);
    if (cached) matches.push({ job: summary(job), assessment: cached });
    else missing.push({ key, job });
  }
  const budget = Math.max(30, Math.min(10000, Number(process.env.MATCH_HOURLY_BUDGET) || 1000));
  if (missing.length && !await catalogue.quota('provider-budget', budget, 3600000, missing.length)) {
    throw fail(429, 'Matching is at capacity for this hour. Please try again later.');
  }
  let next = 0, failed = 0, providerFailure = null;
  const deadline = Date.now() + 35000;
  await Promise.all(Array.from({ length: Math.min(4, missing.length) }, async () => {
    while (next < missing.length) {
      const { key, job } = missing[next++];
      if (Date.now() > deadline) { failed++; continue; }
      try {
        const assessment = await (options.assess || assess)(resume, job, { apiKey });
        await catalogue.cacheSet(key, assessment);
        matches.push({ job: summary(job), assessment });
      } catch (error) {
        failed++;
        if (error?.jevFailure && !providerFailure) providerFailure = error;
      }
    }
  }));
  if (!matches.length && failed) throw providerFailure || fail(502, 'No comparisons completed. The matching service is unavailable; please try again.');
  // Resolve passage ids only in the response. The cache never contains resume text.
  const byId = new Map(candidates.jobs.map(j => [j.job_id, j]));
  for (const item of matches) {
    const request = requestFor(resume, byId.get(item.job.job_id));
    const a = item.assessment;
    item.assessment = { ...a,
      evidence: a.evidence ? { ...a.evidence, text: request.resumePassages[a.evidence.id] } : null,
      gap: a.gap ? { ...a.gap, text: request.jobPassages[a.gap.id] } : null };
  }
  matches.sort((a, b) => b.assessment.score - a.assessment.score || a.job.job_id.localeCompare(b.job.job_id));
  // Persisted as well as returned. The response answers "why this result"; the store
  // answers "is this normal", which needs yesterday's runs too. Writing is deliberately
  // not allowed to fail the match: a trace is for us, the shortlist is for the user.
  if (trace) {
    trace.runId = runId;
    try {
      await storeFor(catalogue).put({
        runId, at: Date.now(), resumeHash: digest(resume, secret).slice(0, 32),
        windowDays, shortlisted: candidates.jobs.length, assessed: matches.length, failed,
        ms: Date.now() - startedAt, trace,
      });
    } catch { /* observability must never cost a result */ }
  }

  // The trace rides along with the result. A shortlist is a chain of filters and the
  // only useful question when it returns twelve jobs is which link dropped them; that
  // is unanswerable from the matches alone.
  return { runId, matches, total: candidates.total, described: candidates.described, assessed: matches.length,
    failed, shortlisted: candidates.jobs.length, model: MODEL, trace, windowDays,
    message: failed ? `${failed} comparisons could not finish. Showing the completed assessments.` : null };
}
module.exports = { match, cacheKey, LIMIT };
