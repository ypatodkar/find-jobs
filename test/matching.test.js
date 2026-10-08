const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryCatalogue } = require('../aws/lambda/catalogue.cjs');
const { requestFor, parseAssessment, MODEL, assess } = require('../aws/lambda/jev.cjs');
const { match, cacheKey } = require('../aws/lambda/matching.cjs');
const { fixture } = require('./fixtures/catalogue');
const resume = 'Built Python services on AWS and PostgreSQL for six years. Owned distributed systems and mentored four engineers. Delivered production deployments and monitoring.';
function response(request) {
  const answers = {};
  for (const [key, question] of Object.entries(request.body.questions)) {
    if (question.type === 'score') answers[key] = { type: 'score', score: 3, confidence: .8, probabilities: { 0: 0, 1: 0, 2: .1, 3: .8, 4: .1 } };
    else {
      const choice = key === 'evidence' ? Object.keys(question.criteria)[1] : 'none';
      answers[key] = { type: 'choice', choice, confidence: .9,
        probabilities: Object.fromEntries(Object.keys(question.criteria).map(k => [k, k === choice ? 1 : 0])) };
    }
  }
  return { model: MODEL, answers };
}
test('Jev HTTP request uses the documented endpoint, typed questions and server authorization', async () => {
  let call;
  const job = fixture().jobs[0];
  const result = await assess(resume, job, { apiKey: 'test-only', fetch: async (url, options) => {
    call = { url, options };
    return new Response(JSON.stringify(response(requestFor(resume, job))), { status: 200 });
  } });
  assert.equal(call.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(call.options.headers.authorization, 'Bearer test-only');
  assert.equal(result.score, 75); assert.equal(result.evidence.id, 'r0');
  assert.ok(!JSON.stringify(result).includes('Built Python'));
});
test('malformed, wrong-version and inconsistent provider scores are rejected', () => {
  const q = requestFor(resume, fixture().jobs[0]); const bad = response(q);
  bad.answers.skills.score = 99;
  assert.throws(() => parseAssessment(bad, q), { status: 502 });
  bad.answers.skills.score = 2;
  assert.throws(() => parseAssessment(bad, q), { status: 502 });
  assert.throws(() => parseAssessment({ ...response(q), model: 'other' }, q), { status: 502 });
});
test('provider auth and schema failures remain identifiable through matching', async () => {
  const job = fixture().jobs[0];
  for (const [status, expectedStatus, message] of [
    [401, 503, /server key/],
    [422, 502, /request format/],
  ]) {
    const fetch = async () => new Response('provider details are private', { status });
    await assert.rejects(assess(resume, job, { apiKey: 'test', fetch }), {
      status: expectedStatus, message,
    });
    const catalogue = new MemoryCatalogue(fixture());
    await assert.rejects(match(catalogue, { resume, consent: true, job_id: job.job_id }, 'client', {
      apiKey: 'test', assess: (r, j) => assess(r, j, { apiKey: 'test', fetch }),
    }), { status: expectedStatus, message });
  }
});
test('matching requires consent and an API key; no simulated scores are substituted', async () => {
  const c = new MemoryCatalogue(fixture());
  await assert.rejects(match(c, { resume }, 'test', { apiKey: 'test' }), { status: 400 });
  const key = process.env.TYPESAFE_API_KEY; delete process.env.TYPESAFE_API_KEY;
  try { await assert.rejects(match(c, { resume, consent: true }, 'test'), { status: 503 }); }
  finally { if (key) process.env.TYPESAFE_API_KEY = key; }
});
test('matching caches assessments, keeps resume passages out of storage, and invalidates changed inputs', async () => {
  const c = new MemoryCatalogue(fixture()); let calls = 0;
  const options = { apiKey: 'test-key', assess: async (r, j) => {
    calls++; const q = requestFor(r, j); return parseAssessment(response(q), q);
  } };
  // perCompany is lifted because this fixture has three companies: the default cap of
  // two would shortlist six jobs and the caching assertions below would be measuring
  // almost nothing. Shortlist diversity is covered separately.
  const body = { resume, consent: true, perCompany: 10 };
  const first = await match(c, body, 'client', options);
  assert.equal(first.assessed, 30); assert.equal(calls, 30);
  assert.ok(first.matches[0].assessment.evidence.text.startsWith('Built Python'));
  assert.ok(!JSON.stringify([...c.cache.values()]).includes('Built Python'));
  await match(c, body, 'client', options);
  assert.equal(calls, 30, 'second identical run is served entirely from cache');
  const j = c.jobs[0];
  assert.notEqual(cacheKey(resume, j, 'key'), cacheKey(resume + ' Kubernetes', j, 'key'));
  assert.notEqual(cacheKey(resume, j, 'key'), cacheKey(resume, { ...j, description: 'New requirements' }, 'key'));
  assert.notEqual(cacheKey(resume, j, 'key'), cacheKey(resume, { ...j, title: 'Director' }, 'key'));
});
test('missing descriptions produce an honest empty result and provider failures produce no invented scores', async () => {
  const data = fixture(); data.jobs.forEach(j => { j.description = ''; });
  const empty = await match(new MemoryCatalogue(data), { resume, consent: true }, 'test', { apiKey: 'test' });
  assert.equal(empty.assessed, 0); assert.equal(empty.described, 0);
  await assert.rejects(match(new MemoryCatalogue(fixture()), { resume, consent: true }, 'test', {
    apiKey: 'test', assess: async () => { throw new Error('unavailable'); },
  }), { status: 502 });
});
test('rate limits reserve work across repeated requests', async () => {
  const c = new MemoryCatalogue(fixture());
  assert.equal(await c.quota('provider-budget', 30, 3600000, 30), true);
  assert.equal(await c.quota('provider-budget', 30, 3600000, 1), false);
});
module.exports = { response, resume };

// The rule the test above sidesteps, tested on its own terms. Three companies and a
// cap of two can only ever yield six jobs, however many openings exist — that is the
// cap working, and it is worth having a test that says so rather than discovering it
// as a confusing shortfall in a different assertion.
test('shortlist spreads across companies and will return fewer than asked rather than stack one employer', async () => {
  const c = new MemoryCatalogue(fixture());
  let calls = 0;
  const options = { apiKey: 'test-key', assess: async (r, j) => {
    calls++; const q = requestFor(r, j); return parseAssessment(response(q), q);
  } };
  const out = await match(c, { resume, consent: true, perCompany: 2 }, 'diverse', options);
  assert.equal(out.assessed, 6, 'three companies at two each');
  const perCompany = {};
  for (const m of out.matches) perCompany[m.job.company] = (perCompany[m.job.company] || 0) + 1;
  assert.deepEqual(Object.values(perCompany).sort(), [2, 2, 2]);
  // And the trace says why, rather than leaving six to look like a failure.
  const select = out.trace.steps.find(s => s.name === 'select');
  assert.ok(select.detail.shortfall, 'the shortfall is explained in the trace');
  assert.ok(select.detail.skipped.some(s => /company already has 2/.test(s.why)));
});

// The bug this guards against looked like a working feature. rankTitles scores a failed
// batch's titles 0 so one bad batch costs only its own titles — but when every batch
// fails, that same rule scores the whole catalogue 0, every title drops under the
// relevance floor, and the shortlist quietly becomes "the first few titles in list
// order". It returned 8 plausible-looking jobs and nothing said the provider was down.
test('a total title-ranking outage falls back to keyword ranking, not to an arbitrary handful', async () => {
  const c = new MemoryCatalogue(fixture());
  const options = { apiKey: 'test-key', perCompany: 10,
    assess: async (r, j) => { const q = requestFor(r, j); return parseAssessment(response(q), q); } };
  // No fetch stub: every title batch fails against the unreachable provider.
  const out = await match(c, { resume, consent: true, perCompany: 10 }, 'outage', options);
  assert.equal(out.assessed, 30, 'still fills the shortlist without title ranking');
  const titles = out.trace.steps.find(s => s.name === 'title-relevance');
  assert.match(titles.detail.provider, /all \d+ batch\(es\) failed/);
});

// Aggregates are read at a glance and acted on, so a wrong one is worse than none.
// "0 failed" contains the word "failed", and the first version of this counted every
// healthy run as degraded — the dashboard showed 4 of 4 runs degraded while every run
// had succeeded.
test('trace aggregates distinguish a healthy provider from a degraded one', () => {
  const { aggregate } = require('../aws/lambda/traces.cjs');
  const rows = [
    { at: 1, provider: '7 batch(es), 0 failed', shortlisted: 30, assessed: 30, ms: 1700, resume_hash: 'a', window_days: 7, failed: 0 },
    { at: 2, provider: '7 batch(es), 2 failed', shortlisted: 30, assessed: 30, ms: 1800, resume_hash: 'b', window_days: 7, failed: 0 },
    { at: 3, provider: 'all 7 batch(es) failed — title ranking skipped', shortlisted: 12, assessed: 12, ms: 900, resume_hash: 'a', window_days: 30, failed: 0 },
  ];
  const a = aggregate(rows);
  assert.equal(a.runs, 3);
  assert.equal(a.providerDegraded, 2, 'a healthy run reporting "0 failed" is not degraded');
  assert.equal(a.shortOfTarget, 1);
  assert.deepEqual(a.windows, { 7: 2, 30: 1 });
  assert.equal(a.distinctResumes, 2, 'résumés are counted by hash, never stored');
});

// The store has two backings and the dashboard must behave the same on both.
test('the file trace store writes, lists, reads back and prunes by age', async () => {
  const { FileTraceStore } = require('../aws/lambda/traces.cjs');
  const os = require('node:os'), pathMod = require('node:path'), fsMod = require('node:fs');
  const dir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'traces-'));
  const store = new FileTraceStore(pathMod.join(dir, 'm.jsonl'), { retentionDays: 1 });
  const run = (id, at) => ({ runId: id, at, resumeHash: 'h', windowDays: 7, shortlisted: 30,
    assessed: 30, failed: 0, ms: 1200, trace: { steps: [{ step: 1, name: 'title-relevance', detail: { jobsPooled: 60, provider: 'ok' } }] } });
  await store.put(run('new', Date.now()));
  await store.put(run('old', Date.now() - 3 * 86400000));
  const listed = await store.list(10);
  assert.equal(listed.length, 1, 'the run older than retention is swept on write');
  assert.equal(listed[0].run_id, 'new');
  assert.equal(listed[0].pooled, 60, 'summary columns are lifted out of the trace');
  assert.ok(!('trace' in listed[0]), 'the list view does not carry 14 KB per row');
  assert.ok((await store.get('new')).trace, 'the full trace is still readable by id');
  fsMod.rmSync(dir, { recursive: true, force: true });
});
