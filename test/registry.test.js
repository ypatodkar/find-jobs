const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { emptyState, observeCompany, seedResults, loadState, atomicJson, withStateLock } = require("../scraper/registry");
const { refreshRegistry } = require("../scraper/registry-pipeline");
const { resolveCareers, privateAddress } = require("../scraper/careers");
const { fetchCompany, detectAts } = require("../scraper/ats");
const { mergeJobs } = require("../scraper/pipeline");
const { splitDescriptions } = require("../scraper/scrape");
const { labelJobs, contentHash, RUBRIC_VERSION } = require("../scraper/classify");

const initial = "2026-10-01T00:00:00.000Z";
const now = "2026-10-02T00:00:00.000Z";
const boards = { vc: { platform: "consider", host: "jobs.vc.test" } };
const job = (extra = {}) => ({ job_id: "j1", company: "Acme", title: "Software Engineer", city: "Remote", url: "https://jobs.ashbyhq.com/acme/job-1", domain: "acme.test", staffCount: 100, size: "51-200", source: "ats", description: "A complete description", ...extra });
function seeded() {
  const state = emptyState();
  seedResults(state, { scrapedAt: initial, firms: { vc: { status: "ok", jobs: [job()] } } }, {}, boards);
  return state;
}
function options(extra = {}) {
  return {
    now, boards, boardDelayMs: 0,
    scrapeFirm: async () => { throw new Error("unexpected discovery"); },
    fetchAll: async (entries) => new Map(entries.map((e) => [e.key, { ok: true, jobs: [job()] }])),
    resolveCareers: async () => ({ candidates: [], errors: [] }),
    ...extra,
  };
}

test("ordinary refresh skips weekly discovery and fetches each saved ATS once", async () => {
  const state = seeded();
  observeCompany(state, job(), { now: initial, firmId: "second" });
  let calls = 0;
  const result = await refreshRegistry(state, () => {}, options({ fetchAll: async (entries) => {
    calls++; assert.equal(entries.length, 1);
    return new Map([[entries[0].key, { ok: true, jobs: [job()] }]]);
  } }));
  assert.equal(calls, 1);
  assert.equal(result.discovery.attempted, 0);
  assert.equal(result.firms.vc.jobs.length, 1);
  assert.equal(result.firms.vc.jobs[0].lastVerifiedAt, now);
});

test("successful zero jobs closes listings while the company remains monitored", async () => {
  const state = seeded();
  const result = await refreshRegistry(state, () => {}, options({ fetchAll: async () => new Map([["ashby:acme", { ok: true, jobs: [] }]]) }));
  assert.equal(result.firms.vc.jobs.length, 0);
  assert.equal(Object.keys(state.companies).length, 1);
  assert.equal(state.companies["ashby:acme"].lastSuccessAt, now);
  let monitored = false;
  await refreshRegistry(state, () => {}, options({ fetchAll: async (entries) => {
    monitored = entries.some((e) => e.key === "ashby:acme");
    return new Map([["ashby:acme", { ok: true, jobs: [] }]]);
  } }));
  assert.equal(monitored, true);
});

test("ATS timeout preserves last successful jobs, descriptions and verification time", async () => {
  const state = seeded();
  const result = await refreshRegistry(state, () => {}, options({ fetchAll: async () => new Map([["ashby:acme", { ok: false, reason: "timeout", jobs: [] }]]) }));
  assert.equal(result.enrichment.retained, 1);
  assert.equal(result.firms.vc.jobs[0].lastVerifiedAt, initial);
  assert.equal(result.firms.vc.jobs[0].stale, true);
  const descriptions = splitDescriptions(result);
  assert.equal(descriptions.j1, "A complete description");
  assert.equal(state.companies["ashby:acme"].lastJobs[0].description, "A complete description", "publishing must not mutate durable jobs");
});

test("an invalid successful response is not interpreted as an empty board", async () => {
  const state = seeded();
  const result = await refreshRegistry(state, () => {}, options({ fetchAll: async () => new Map([["ashby:acme", { ok: true }]]) }));
  assert.equal(result.firms.vc.jobs.length, 1);
  assert.equal(state.companies["ashby:acme"].consecutiveFailures, 1);
});

test("weekly discovery can fail or stop listing a company without losing its ATS", async () => {
  for (const response of [{ status: "error", reason: "HTTP 503", jobs: [] }, { status: "ok", jobs: [] }]) {
    const state = seeded();
    const result = await refreshRegistry(state, () => {}, options({ now: "2026-10-09T00:00:00.000Z", scrapeFirm: async () => response }));
    assert.equal(result.firms.vc.jobs.length, 1);
    assert.equal(Object.keys(state.companies).length, 1);
    if (response.status === "error") assert.equal(state.boards.vc.lastDiscoveryAt, initial);
  }
});

test("failed discovery retries daily, successful discovery waits a week", async () => {
  const state = seeded();
  const failure = { status: "error", reason: "offline", jobs: [] };
  const run = (at, scrape) => refreshRegistry(state, () => {}, options({ now: at, scrapeFirm: scrape, discoveryOnly: true }));
  await run("2026-10-09T00:00:00.000Z", async () => failure);
  assert.equal((await run("2026-10-09T12:00:00.000Z", async () => { throw new Error("should skip"); })).discovery.attempted, 0);
  assert.equal((await run("2026-10-10T00:00:00.000Z", async () => ({ status: "ok", jobs: [] }))).discovery.succeeded, 1);
  assert.equal((await run("2026-10-11T00:00:00.000Z", async () => { throw new Error("should skip"); })).discovery.attempted, 0);
});

test("headcount refreshes monthly with source evidence; missing values do not erase it", () => {
  const state = seeded(), co = state.companies["ashby:acme"];
  observeCompany(state, job({ staffCount: 250 }), { now: "2026-10-08T00:00:00.000Z", firmId: "vc", sourceUrl: "https://jobs.vc.test" });
  assert.equal(co.meta.staffCount, 100);
  observeCompany(state, job({ staffCount: 250 }), { now: "2026-11-01T00:00:00.000Z", firmId: "vc", sourceUrl: "https://jobs.vc.test" });
  assert.equal(co.meta.staffCount, 250);
  assert.equal(co.headcount.sourceUrl, "https://jobs.vc.test");
  assert.equal(co.headcount.seeded, false);
  observeCompany(state, job({ staffCount: null }), { now: "2026-12-02T00:00:00.000Z", firmId: "vc" });
  assert.equal(co.meta.staffCount, 250);
  assert.equal(co.headcount.observedAt, "2026-11-01T00:00:00.000Z");
});

test("repair starts on the third failure, validates a replacement and retains history", async () => {
  const state = seeded();
  state.companies["ashby:acme"].consecutiveFailures = 2;
  let checked;
  await refreshRegistry(state, () => {}, options({
    fetchAll: async () => new Map([["ashby:acme", { ok: false, reason: "404" }]]),
    resolveCareers: async () => ({ candidates: [{ ats: "greenhouse", slug: "acme-new", url: "https://boards.greenhouse.io/acme-new" }], errors: [] }),
    fetchCompany: async (entry) => { checked = entry.key; return { ok: true, jobs: [] }; },
  }));
  const co = state.companies["ashby:acme"];
  assert.equal(checked, "greenhouse:acme-new");
  assert.equal(co.key, checked);
  assert.equal(co.lastJobs.length, 0);
  assert.equal(co.consecutiveFailures, 0);
  assert.equal(co.boardHistory[0].key, "ashby:acme");
});

test("failed replacement cannot overwrite jobs and repair has a weekly cooldown", async () => {
  const state = seeded();
  state.companies["ashby:acme"].consecutiveFailures = 2;
  let repairs = 0;
  const opt = options({
    fetchAll: async () => new Map([["ashby:acme", { ok: false, reason: "offline" }]]),
    resolveCareers: async () => { repairs++; return { candidates: [{ ats: "lever", slug: "wrong", url: "https://jobs.lever.co/wrong" }], errors: [] }; },
    fetchCompany: async () => ({ ok: false, reason: "404", jobs: [] }),
  });
  await refreshRegistry(state, () => {}, opt);
  await refreshRegistry(state, () => {}, { ...opt, now: "2026-10-03T00:00:00.000Z" });
  assert.equal(repairs, 1);
  assert.equal(state.companies["ashby:acme"].key, "ashby:acme");
  assert.equal(state.companies["ashby:acme"].lastJobs.length, 1);
});

test("manual companies appear without inventing an investor, and are classified", async () => {
  const state = emptyState();
  observeCompany(state, job(), { now: initial, sourceUrl: "https://acme.test" });
  const result = await refreshRegistry(state, () => {}, options({ boards: {}, jobsOnly: true }));
  assert.equal(result.directJobs.length, 1);
  assert.deepEqual(mergeJobs(result)[0].firms, []);
  const cache = { [contentHash(result.directJobs[0], result.directJobs[0].description)]: { field: "cs", fieldConfidence: 1, level: "early", levelConfidence: 1, rubric: RUBRIC_VERSION } };
  await labelJobs(result, cache);
  assert.equal(result.directJobs[0].career, "early");
});

test("unresolved company survives empty discovery and duplicate portfolio references merge", async () => {
  const state = emptyState();
  const unknown = job({ url: "https://acme.test/careers/1", domain: null, source: "board" });
  observeCompany(state, unknown, { now: initial, firmId: "vc" });
  observeCompany(state, unknown, { now: initial, firmId: "second" });
  assert.equal(Object.keys(state.companies).length, 1);
  const result = await refreshRegistry(state, () => {}, options({ forceDiscovery: true, scrapeFirm: async () => ({ status: "ok", jobs: [] }) }));
  assert.equal(Object.keys(state.companies).length, 1);
  assert.equal(result.firms.vc.jobs.length, 0);
});

test("seed-only first run with every ATS failing refuses an empty publication", async () => {
  const state = emptyState();
  observeCompany(state, job(), { now: initial });
  await assert.rejects(refreshRegistry(state, () => {}, options({ boards: {}, jobsOnly: true, fetchAll: async () => new Map() })), /refusing an empty refresh/);
});

test("careers discovery follows actual links and finds embedded ATS boards", async () => {
  const pages = {
    "https://acme.test": '<a href="/careers">Careers</a><a href="https://other.test/careers">Other</a>',
    "https://acme.test/careers": '<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme&amp;foo=1"></iframe>',
  };
  const seen = [];
  const result = await resolveCareers({ meta: { domain: "acme.test" } }, { read: async (url) => {
    seen.push(url); assert.ok(url in pages);
    return { url, html: pages[url] };
  } });
  assert.deepEqual(result.candidates.map((c) => [c.ats, c.slug]), [["greenhouse", "acme"]]);
  assert.equal(seen.length, 2);
  assert.equal(detectAts("https://notashbyhq.com/acme"), null);
  assert.equal(privateAddress("127.0.0.1"), true);
  assert.equal(privateAddress("169.254.169.254"), true);
  assert.equal(privateAddress("::ffff:127.0.0.1"), true);
  assert.equal(privateAddress("8.8.8.8"), false);
});

test("real ATS adapters reject malformed payloads and omit unlisted Ashby jobs", async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ error: "unavailable" }), { status: 200 });
    for (const ats of ["ashby", "greenhouse", "lever"]) {
      const result = await fetchCompany({ ats, slug: "acme", company: "Acme", meta: {} });
      assert.equal(result.ok, false);
      assert.match(result.reason, /invalid .* response/);
    }
    global.fetch = async () => new Response(JSON.stringify({ jobs: [{ title: "Software Engineer", location: "Remote", isListed: false }] }));
    assert.deepEqual((await fetchCompany({ ats: "ashby", slug: "acme", company: "Acme", meta: {} })).jobs, []);
  } finally { global.fetch = original; }
});

test("disk restart preserves companies and jobs, adds new seed entries, and rejects corrupt state", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "company-registry-"));
  try {
    const file = path.join(dir, "state.json"), seedFile = path.join(dir, "seed.json");
    const state = seeded();
    await atomicJson(file, state);
    const extra = emptyState();
    observeCompany(extra, job({ company: "Extra", domain: "extra.test", url: "https://jobs.lever.co/extra" }), { now });
    await atomicJson(seedFile, { companies: Object.values(extra.companies) });
    const restored = await loadState(file, { seedFile });
    assert.equal(restored.companies["ashby:acme"].lastJobs[0].description, "A complete description");
    assert.equal(Object.keys(restored.companies).length, 2);
    await assert.rejects(withStateLock(file, () => withStateLock(file, () => {})), /Another registry operation/);
    await fs.writeFile(file, "invalid json");
    await assert.rejects(loadState(file, { seedFile }), SyntaxError);
    await atomicJson(file, { version: 999 });
    await assert.rejects(loadState(file, { seedFile }), /Invalid scraper state/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("migration retains multiple cities for one posting and prefers the direct ATS copy", () => {
  const state = emptyState();
  seedResults(state, { scrapedAt: initial, firms: {
    first: { status: "ok", jobs: [job({ source: "board", job_id: "vc-id" }), job({ city: "New York" })] },
    second: { status: "ok", jobs: [job()] },
  } });
  const jobs = state.companies["ashby:acme"].lastJobs;
  assert.equal(jobs.length, 2);
  assert.deepEqual(jobs.map(j => j.job_id), ["j1", "j1"]);
  assert.deepEqual(jobs.map(j => j.city), ["Remote", "New York"]);
});

test("a newly discovered ATS failure keeps its fresh VC fallback and compensation survives ATS refresh", async () => {
  const state = emptyState();
  const result = await refreshRegistry(state, () => {}, options({
    scrapeFirm: async () => ({ status: "ok", jobs: [job({ source: "board", salaryMin: 100000, salaryMax: 150000, salary: "$100k–150k" })] }),
    fetchAll: async () => new Map([["ashby:acme", { ok: false, reason: "timeout" }]]),
  }));
  assert.equal(result.firms.vc.jobs[0].description, "A complete description");
  const next = await refreshRegistry(state, () => {}, options({ jobsOnly: true }));
  assert.equal(next.firms.vc.jobs[0].salaryMin, 100000);
});

test("repair can consolidate a new board already discovered for the same employer", async () => {
  const state = seeded();
  observeCompany(state, job({ url: "https://jobs.lever.co/acme-new/j1" }), { now, firmId: "vc" });
  state.companies["ashby:acme"].consecutiveFailures = 2;
  await refreshRegistry(state, () => {}, options({
    fetchAll: async () => new Map([["ashby:acme", { ok: false, reason: "404" }], ["lever:acme-new", { ok: true, jobs: [] }]]),
    resolveCareers: async () => ({ candidates: [{ ats: "lever", slug: "acme-new", url: "https://jobs.lever.co/acme-new" }], errors: [] }),
    fetchCompany: async () => ({ ok: true, jobs: [] }),
  }));
  assert.equal(Object.keys(state.companies).length, 1);
  assert.equal(state.companies["ashby:acme"].key, "lever:acme-new");
});

test("durable storage round-trips state, retains a previous snapshot, and never resets on denied/corrupt reads", async () => {
  const { syncState } = require("../scripts/scraper-state");
  const syncFs = require("node:fs");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "registry-storage-"));
  const file = path.join(dir, "state.json"), objects = new Map();
  const current = "s3://test/_scraper/state.json.gz", previous = "s3://test/_scraper/previous.json.gz";
  const run = (args) => {
    if (args[0] === "s3api") return objects.has(current);
    const [, , from, to] = args;
    if (from.startsWith("s3://")) syncFs.writeFileSync(to, objects.get(from));
    else objects.set(to, syncFs.readFileSync(from));
    return true;
  };
  try {
    await atomicJson(file, seeded());
    await syncState("save", { file, bucket: "test", run });
    const first = objects.get(current);
    await fs.rm(file);
    await syncState("restore", { file, bucket: "test", run });
    assert.equal((await loadState(file, { seedFile: path.join(dir, "none") })).companies["ashby:acme"].lastJobs.length, 1);
    await syncState("save", { file, bucket: "test", run });
    assert.deepEqual(objects.get(previous), first);
    await assert.rejects(syncState("restore", { file, bucket: "test", run: () => { throw new Error("AccessDenied"); } }), /AccessDenied/);
    objects.set(current, Buffer.from("corrupt"));
    await assert.rejects(syncState("restore", { file, bucket: "test", run }));
    assert.equal((await loadState(file, { seedFile: path.join(dir, "none") })).companies["ashby:acme"].lastJobs.length, 1);
    const workflow = await fs.readFile(path.join(__dirname, "../.github/workflows/deploy.yml"), "utf8");
    assert.match(workflow, /--exclude "_scraper\/\*"/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});


test("discovery retains parallel platform lanes and deterministic company naming", async () => {
  const state = emptyState();
  let running = 0, peak = 0;
  await refreshRegistry(state, () => {}, options({
    boards: { first: { platform: "consider", host: "first.test" }, second: { platform: "consider", host: "second.test" }, yc: { platform: "yc", host: "yc.test" } },
    discoveryOnly: true,
    scrapeFirm: async (id) => {
      running++; peak = Math.max(peak, running);
      await new Promise(resolve => setTimeout(resolve, id === "first" ? 10 : 1));
      running--;
      return { status: "ok", jobs: [job({ company: id === "first" ? "Canonical" : "Alias" })] };
    },
  }));
  assert.ok(peak > 1);
  assert.equal(state.companies["ashby:acme"].company, "Canonical");
  assert.deepEqual(state.companies["ashby:acme"].firms, ["first", "second", "yc"]);
});
