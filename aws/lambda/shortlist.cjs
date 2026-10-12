// Choosing which 30 jobs are worth a detailed comparison.
//
// The expensive step is the per-job assessment, so everything here exists to spend it
// well. The shape is: narrow by date and the user's own filters, ask Jev which job
// titles suit this resume at all, rank the surviving jobs by how specifically their
// text matches, then take a diverse 30.
//
// Every stage records what went in, what came out and why, into a trace the caller
// returns with the response. That is not instrumentation bolted on afterwards: a
// shortlist is a chain of filters, and when the answer is "only 12 jobs" the only
// useful question is which link dropped them.
const { rankTitles } = require('./jev.cjs');
const { normalize } = require('./catalogue.cjs');

// Terms that mean the same thing to a reader and different things to `includes`.
// Deliberately small: every entry is a judgement that two words are interchangeable,
// and a wrong one quietly mis-ranks every job that mentions either.
const ALIASES = [
  ['postgres', 'postgresql', 'psql'],
  ['javascript', 'js'],
  ['typescript', 'ts'],
  ['kubernetes', 'k8s'],
  ['golang', 'go'],
  ['postgres', 'rds'],
  ['ci/cd', 'cicd', 'continuous integration'],
  ['machine learning', 'ml'],
  ['large language model', 'llm', 'llms'],
  ['amazon web services', 'aws'],
  ['google cloud', 'gcp'],
  ['infrastructure as code', 'terraform', 'iac'],
  ['natural language processing', 'nlp'],
  ['react.js', 'react', 'reactjs'],
  ['node.js', 'node', 'nodejs'],
];
const ALIAS_OF = new Map();
for (const group of ALIASES) for (const term of group) ALIAS_OF.set(term, group[0]);
const canonical = term => ALIAS_OF.get(term) || term;

const STOP = new Set(('a an and are as at be by for from has have in is it its of on or that the to with we you your our will can able '
  + 'work working experience years year team teams role roles company companies job jobs strong excellent good great ability skills '
  + 'including etc more most other across within using used use build building help helping new').split(/\s+/));

function termsOf(text, limit = 120) {
  const counts = new Map();
  for (const raw of String(text).toLowerCase().match(/[a-z][a-z0-9+#.\-/]{1,30}/g) || []) {
    const word = canonical(raw.replace(/[.\-/]+$/, ''));
    if (word.length < 2 || STOP.has(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

// Titles are grouped so "Senior Software Engineer" and "Sr. Software Engineer II" are
// one thing to rank. Seniority words are kept — a staff role and an intern role are not
// interchangeable — while numerals, punctuation and location suffixes are dropped.
function titleKey(title) {
  return String(title).toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9+#/ ]/g, ' ')
    .replace(/\b(sr|snr)\b/g, 'senior')
    .replace(/\bjr\b/g, 'junior')
    .replace(/\bswe\b/g, 'software engineer')
    .replace(/\b(i{1,3}|iv|v|vi{1,3}|[1-5])\b/g, ' ')
    .replace(/\b(remote|hybrid|onsite|contract|intern(ship)?|full.?time|part.?time)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

const ageDays = (job, now) => {
  const t = job.posted ? Date.parse(job.posted) : NaN;
  return Number.isFinite(t) ? (now - t) / 86400000 : null;
};

/**
 * Score one job against the resume's terms.
 *
 * Title hits weigh more than body hits because a term in the title is what the job is,
 * where the same term in the body may be one line of a tooling list. Each term counts
 * once however often it appears: a description repeating "Python" nine times is not
 * nine times the evidence, and rewarding repetition favours verbose postings.
 */
function scoreJob(job, terms, now, windowDays) {
  const title = job.titleLower, body = job.descriptionLower;
  let score = 0; const hits = [];
  for (const term of terms) {
    const inTitle = title.includes(term);
    const inBody = body.includes(term);
    if (!inTitle && !inBody) continue;
    score += inTitle ? 3 : 1;
    hits.push(inTitle ? term + '*' : term);
  }
  // Freshness breaks ties only. It is a fraction of a single term's weight, so it can
  // reorder equals without ever outranking a job that genuinely matches better.
  const age = ageDays(job, now);
  const freshness = age === null ? 0 : Math.max(0, (windowDays - age) / windowDays) * 0.5;
  return { score: score + freshness, matched: hits };
}

/**
 * Build the shortlist.
 *
 * Returns { jobs, trace }. `trace` is the whole point: a step-by-step record of counts
 * in and out, how long each took, and the decisions made — which titles Jev liked, which
 * jobs were dropped for being a third opening at the same company, whether the date
 * window had to widen.
 */
async function buildShortlist(catalogue, input, options = {}) {
  const now = options.now || Date.now();
  const limit = input.limit || 30;
  const perCompany = input.perCompany || 2;
  const titleGroups = input.titleGroups || 8;
  const minRelevance = input.minRelevance ?? 0.25;
  const ladder = input.windowLadder || [input.windowDays || 4, 7, 14, 30, 90];
  const trace = { at: now, steps: [], settings: { limit, perCompany, titleGroups, minRelevance, ladder } };
  const step = (name, detail) => { trace.steps.push({ step: trace.steps.length + 1, name, ...detail }); };

  // --- 1. everything the user's own filters allow -------------------------------
  // --- 1 & 2. the eligible pool, widened only if it cannot fill the shortlist ----
  //
  // Both steps come from catalogue.poolFor, which exists on the in-memory and Postgres
  // stores alike. Going through it rather than reaching into the job array is what lets
  // this run against either — an earlier version called catalogue.filter() directly and
  // would have worked in tests and crashed in production.
  let t = Date.now();
  let pool = [], windowDays = ladder[0], widened = [], counts = { total: 0, described: 0 };
  for (const days of ladder) {
    windowDays = days;
    const got = await catalogue.poolFor(input.filters || {}, days, now);
    counts = { total: got.total, described: got.described };
    pool = got.jobs;
    widened.push({ days, jobs: pool.length, companies: new Set(pool.map(j => j.company)).size });
    // Materially more than `limit`, because the per-company cap and title filter below
    // both still have to take their share.
    if (pool.length >= limit * 3) break;
  }
  // Lowercased once per job, not once per term inside a comparator. The ranking this
  // replaces did the latter and cost 375 seconds on this corpus.
  pool = pool.map(j => ({ ...j, titleLower: j.title.toLowerCase(), descriptionLower: (j.description || '').toLowerCase() }));
  step('filters', { ms: Date.now() - t, in: counts.total, out: counts.described,
    detail: { withDescription: counts.described, withoutDescription: counts.total - counts.described,
      note: 'Jobs with no stored description cannot be compared and are excluded here, not silently later.' } });
  const described = { length: counts.described };
  step('window', { ms: 0, in: counts.described, out: pool.length,
    detail: { chosenDays: windowDays, ladder: widened,
      note: widened.length > 1
        ? `Widened to ${windowDays} days: a ${ladder[0]}-day window held only ${widened[0].jobs} comparable jobs.`
        : `${windowDays}-day window was enough.` } });

  if (!pool.length) {
    step('stop', { in: 0, out: 0, detail: { note: 'No job in any window has a usable description under these filters.' } });
    return { jobs: [], windowDays, trace };
  }

  // --- 3. distinct titles, ranked by Jev ---------------------------------------
  t = Date.now();
  const groups = new Map();
  for (const job of pool) {
    const key = titleKey(job.title);
    if (!groups.has(key)) groups.set(key, { key, label: job.title, jobs: [] });
    groups.get(key).jobs.push(job);
  }
  // Rank the busiest groups first so the title budget is spent where the jobs are.
  const ordered = [...groups.values()].sort((a, b) => b.jobs.length - a.jobs.length);
  const labels = ordered.map(g => g.label);
  step('titles', { ms: Date.now() - t, in: pool.length, out: ordered.length,
    detail: { note: `${pool.length} jobs collapse to ${ordered.length} distinct titles, which is what gets ranked.` } });

  t = Date.now();
  let ranking;
  try {
    ranking = await rankTitles(input.resume, labels, options);
  } catch (error) {
    // Title ranking is an optimisation, not a gate. If it fails the whole pool goes
    // forward and keyword ranking decides — a worse shortlist, not no shortlist.
    ranking = { titles: labels.map(title => ({ title, relevance: 1 })), batches: 0, failedBatches: 0, error: error.message };
  }
  // A provider outage must degrade to keyword ranking, not to an arbitrary handful.
  //
  // rankTitles scores a failed batch's titles 0 so one bad batch costs its own titles
  // and no more. But when *every* batch fails that same rule scores the whole catalogue
  // 0, every title falls under the relevance floor, and the shortlist becomes the first
  // few titles in list order — which looked like a working feature returning 8 jobs.
  // Total failure is a different condition from partial failure and is treated as one.
  const providerDown = ranking.batches > 0 && ranking.failedBatches === ranking.batches;
  if (providerDown) for (const row of ranking.titles) row.relevance = 1;
  const relevanceOf = new Map(ranking.titles.map(r => [r.title, r.relevance]));
  // Take title groups in relevance order until there are enough *jobs* to fill the
  // shortlist — not a fixed number of groups.
  //
  // A fixed count was the original design and it starves: in a 7-day window 322 jobs
  // collapse to 270 distinct titles, so most groups hold a single opening and "the best
  // 8 titles" is about 15 jobs, half a shortlist. The budget that matters is jobs, and
  // the headroom multiplier is because the per-company cap below will reject some of
  // them. Groups below the relevance floor are never taken however short we are: a
  // shortlist padded with roles the resume does not suit is worse than a short one.
  const byRelevance = ordered
    .map(g => ({ ...g, relevance: relevanceOf.get(g.label) ?? 0 }))
    .sort((a, b) => b.relevance - a.relevance);
  const wanted = limit * 2;
  const chosen = [];
  let pooled = 0;
  for (const group of byRelevance) {
    if (pooled >= wanted) break;
    if (group.relevance < minRelevance && chosen.length >= titleGroups) break;
    chosen.push(group);
    pooled += group.jobs.length;
  }
  const kept = chosen.filter(g => g.relevance >= minRelevance);

  step('title-relevance', { ms: Date.now() - t, in: ordered.length, out: chosen.length,
    detail: {
      provider: ranking.error ? `unavailable (${ranking.error}) — every title kept`
        : providerDown ? `all ${ranking.batches} batch(es) failed — title ranking skipped, keyword ranking decides`
        : `${ranking.batches} batch(es), ${ranking.failedBatches} failed`,
      threshold: minRelevance,
      jobsPooled: pooled,
      aboveThreshold: kept.length,
      belowThresholdTaken: chosen.length - kept.length,
      stoppedBecause: pooled >= wanted ? `pooled ${pooled} jobs, enough for a ${limit} shortlist`
        : `ran out of titles above ${minRelevance} relevance`,
      chosen: chosen.map(g => ({ title: g.label, relevance: Number(g.relevance.toFixed(3)), jobs: g.jobs.length })),
      rejected: ranking.titles.filter(r => r.relevance < minRelevance)
        .slice(0, 12).map(r => ({ title: r.title, relevance: Number(r.relevance.toFixed(3)) })),
    } });

  // --- 4. rank the jobs in those groups by how specifically they match ----------
  t = Date.now();
  const candidates = chosen.flatMap(g => g.jobs);
  const terms = termsOf(input.resume);
  const scored = candidates.map(job => {
    const { score, matched } = scoreJob(job, terms, now, windowDays);
    return { job, score, matched, titleRelevance: relevanceOf.get(job.title) ?? 0 };
  }).sort((a, b) => b.score - a.score);
  step('rank', { ms: Date.now() - t, in: candidates.length, out: scored.length,
    detail: { resumeTerms: terms.length, topTerms: terms.slice(0, 12),
      note: 'A term in the title scores 3, in the description 1, counted once each. Freshness only breaks ties.' } });

  // --- 5. take a diverse 30 ------------------------------------------------------
  t = Date.now();
  const perCo = new Map(); const seen = new Set();
  const picked = [], skipped = [];
  for (const row of scored) {
    if (picked.length >= limit) break;
    const id = row.job.job_id;
    if (seen.has(id)) { skipped.push({ title: row.job.title, company: row.job.company, why: 'duplicate' }); continue; }
    const count = perCo.get(row.job.company) || 0;
    if (count >= perCompany) {
      if (skipped.length < 25) skipped.push({ title: row.job.title, company: row.job.company, why: `company already has ${perCompany}` });
      continue;
    }
    seen.add(id); perCo.set(row.job.company, count + 1);
    picked.push(row);
  }
  step('select', { ms: Date.now() - t, in: scored.length, out: picked.length,
    detail: { target: limit, perCompany, companies: perCo.size, skipped: skipped.slice(0, 15),
      shortfall: picked.length < limit
        ? `Only ${picked.length} of ${limit}. Widen the date window or relax the ${perCompany}-per-company cap.` : null,
      selected: picked.map((r, i) => ({ rank: i + 1, company: r.job.company, title: r.job.title,
        score: Number(r.score.toFixed(2)), titleRelevance: Number(r.titleRelevance.toFixed(3)),
        matched: r.matched.slice(0, 10) })) } });

  return { jobs: picked.map(r => r.job), windowDays, trace,
    preliminary: picked.map((r, i) => ({ job_id: r.job.job_id, rank: i + 1, score: r.score, matched: r.matched })) };
}

module.exports = { buildShortlist, titleKey, termsOf, scoreJob, ALIASES };
