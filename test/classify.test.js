const test = require("node:test");
const assert = require("node:assert/strict");
const { excerpt, requestFor, parseClassification, withTitle, labelJobs, contentHash, RUBRIC_VERSION } = require("../scraper/classify");
const { MODEL } = require("../shared/jev");

// A fake Jev that answers every question from `pick(title)` → { field, level }.
function fakeJev(pick, calls = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const answers = {};
    for (const [id, job] of Object.entries(body.state.jobs)) {
      const a = pick(job.title);
      const p = (keys, chosen) => Object.fromEntries(keys.map((k) => [k, k === chosen ? 1 : 0]));
      answers["f_" + id] = { type: "choice", choice: a.field, confidence: a.fieldConfidence ?? 0.9, probabilities: p(["cs", "not_cs"], a.field) };
      answers["l_" + id] = { type: "choice", choice: a.level, confidence: 0.9, probabilities: p(["early", "experienced", "unclear"], a.level) };
    }
    return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 100 } }), { status: 200 });
  };
}

const job = (company, title, seniority = "mid", description = "<p>Build things.</p>") => ({ company, title, seniority, description });

test("excerpt finds an experience bullet inside a list with no full stops", () => {
  const html = "<p>We are a company. " + "We do many things ".repeat(40) + "</p><ul><li>Python</li><li>5+ years of backend experience</li><li>Kubernetes</li></ul>";
  assert.match(excerpt(html), /5\+ years of backend experience/);
});

test("requestFor asks a field and a level question per job, naming the job", () => {
  const body = requestFor([{ company: "A", title: "Backend Engineer", html: "" }, { company: "B", title: "Intern", html: "" }]);
  assert.equal(body.model, MODEL);
  assert.deepEqual(Object.keys(body.questions).sort(), ["f_j0", "f_j1", "l_j0", "l_j1"]);
  assert.match(body.questions.l_j1.instructions, /job j1/);
  assert.match(body.questions.l_j1.instructions, /"Intern" at B/);
});

test("parseClassification rejects an answer outside the allowed choices", () => {
  const body = requestFor([{ company: "A", title: "X", html: "" }]);
  const bad = { model: body.model, answers: { f_j0: { type: "choice", choice: "maybe", confidence: 1 }, l_j0: { type: "choice", choice: "early", confidence: 1 } } };
  assert.throws(() => parseClassification(bad, body), /invalid/);
});

test("a level stated in the title overrides the posting", () => {
  assert.equal(withTitle({ level: "early" }, "senior").level, "experienced");
  assert.equal(withTitle({ level: "experienced" }, "intern").level, "early");
  assert.equal(withTitle({ level: "early" }, "mid").level, "early");
});

test("labelJobs labels, drops confident non-computing roles, and caches by posting", async () => {
  const results = { firms: {
    a: { jobs: [job("Acme", "Software Engineer"), job("Acme", "Mechanical Engineer"), job("Acme", "Solutions Engineer")] },
    b: { jobs: [job("Acme", "Software Engineer")] }, // same posting under a second firm
  } };
  const calls = [];
  const fetch = fakeJev((t) =>
    t === "Mechanical Engineer" ? { field: "not_cs", level: "experienced" }
      : t === "Solutions Engineer" ? { field: "not_cs", fieldConfidence: 0.3, level: "unclear" }
      : { field: "cs", level: "early" }, calls);
  const cache = {};
  const stats = await labelJobs(results, cache, { apiKey: "k", fetch });

  assert.equal(calls.length, 1);
  assert.equal(Object.keys(calls[0].state.jobs).length, 3, "the duplicate posting is asked about once");
  assert.equal(stats.dropped, 1);
  assert.deepEqual(results.firms.a.jobs.map((j) => [j.title, j.career]), [["Software Engineer", "early"], ["Solutions Engineer", "unclear"]]);
  assert.equal(results.firms.b.jobs[0].career, "early");
  assert.equal(Object.keys(cache).length, 3);
  assert.equal(Object.values(cache)[0].rubric, RUBRIC_VERSION);

  // Next scrape: nothing new, so nothing is asked.
  const again = { firms: { a: { jobs: [job("Acme", "Software Engineer")] } } };
  const s2 = await labelJobs(again, cache, { apiKey: "k", fetch });
  assert.equal(calls.length, 1);
  assert.equal(s2.asked, 0);
  assert.equal(again.firms.a.jobs[0].career, "early");
});

test("an edited posting is asked about again", async () => {
  const cache = {};
  const fetch = fakeJev(() => ({ field: "cs", level: "early" }));
  await labelJobs({ firms: { a: { jobs: [job("Acme", "SWE", "mid", "<p>2+ years</p>")] } } }, cache, { apiKey: "k", fetch });
  const s = await labelJobs({ firms: { a: { jobs: [job("Acme", "SWE", "mid", "<p>6+ years</p>")] } } }, cache, { apiKey: "k", fetch });
  assert.equal(s.asked, 1);
});

test("without a key, or when Jev fails, new postings are kept unlabelled", async () => {
  const noKey = { firms: { a: { jobs: [job("Acme", "SWE")] } } };
  const s1 = await labelJobs(noKey, {}, { apiKey: "", fetch: () => assert.fail("should not call") });
  assert.equal(s1.asked, 0);
  assert.equal(noKey.firms.a.jobs.length, 1);
  assert.equal(noKey.firms.a.jobs[0].career, undefined);

  const down = { firms: { a: { jobs: [job("Acme", "SWE")] } } };
  const s2 = await labelJobs(down, {}, { apiKey: "k", fetch: async () => new Response("", { status: 500 }) });
  assert.equal(s2.failed, true);
  assert.equal(down.firms.a.jobs.length, 1);
});

test("answers for postings unseen for 30 days are pruned, and stale rubrics re-asked", async () => {
  const now = Date.now();
  const live = job("Acme", "SWE");
  const cache = {
    old: { field: "cs", level: "early", rubric: RUBRIC_VERSION, seen: now - 31 * 864e5 },
    [contentHash(live, live.description)]: { field: "cs", level: "early", rubric: "job-class-v0", seen: now },
  };
  const s = await labelJobs({ firms: { a: { jobs: [live] } } }, cache, { apiKey: "k", fetch: fakeJev(() => ({ field: "cs", level: "experienced" })), now });
  assert.equal(s.asked, 1);
  assert.equal(cache.old, undefined);
  assert.equal(live.career, "experienced");
});

test("a scrape where most postings would be dropped keeps them all", async () => {
  const results = { firms: { a: { jobs: [job("Acme", "A"), job("Acme", "B"), job("Acme", "C"), job("Acme", "D")] } } };
  const logs = [];
  const s = await labelJobs(results, {}, { apiKey: "k", fetch: fakeJev((t) => (t === "D" ? { field: "cs", level: "early" } : { field: "not_cs", level: "unclear" })), log: (m) => logs.push(m) });
  assert.equal(s.dropped, 0);
  assert.equal(results.firms.a.jobs.length, 4);
  assert.match(logs.join(" "), /Not dropping 3 of 4/);
  assert.equal(results.firms.a.jobs[3].career, "early", "labels are still applied");
});

test("a job listed under two firms is not reported as cached on a first run", async () => {
  const shared = job("Acme", "SWE");
  const s = await labelJobs({ firms: { a: { jobs: [shared] }, b: { jobs: [shared] } } }, {}, { apiKey: "k", fetch: fakeJev(() => ({ field: "cs", level: "early" })) });
  assert.equal(s.jobs, 2);
  assert.equal(s.cached, 0);
  assert.equal(s.asked, 1);
});
