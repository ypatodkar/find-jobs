const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS } = require("../scraper/boards");
const { failedPlatforms, failedBoards, allJobsPayload, firmPayload, mergeJobs } = require("../scraper/pipeline");

function resultWith(statusFor) {
  const firms = {};
  for (const [id, cfg] of Object.entries(BOARDS)) {
    firms[id] = { status: cfg.platform ? statusFor(cfg.platform, id) : "unsupported" };
  }
  return { firms };
}

test("rejects a scrape when an entire platform failed", () => {
  const results = resultWith((platform) => platform === "consider" ? "error" : "ok");
  assert.deepEqual(failedPlatforms(results), ["consider"]);
});

test("accepts partial board failures when each platform still returned data", () => {
  let failedOne = false;
  const results = resultWith((platform) => {
    if (platform === "consider" && !failedOne) {
      failedOne = true;
      return "error";
    }
    return "ok";
  });
  assert.deepEqual(failedPlatforms(results), []);
});

// The failure that actually cost us data: a16z and Greylock stopped returning, twenty
// other Consider boards kept going, failedPlatforms saw nothing wrong, and the deploy
// shipped without 86 companies no other portfolio lists. Partial loss has to be
// nameable even though it is correctly not fatal.
test("names individual boards that failed, where failedPlatforms stays quiet", () => {
  const results = resultWith(() => "ok");
  results.firms.lightspeed = { status: "error", reason: "fetch failed" };
  results.firms.nea = { status: "error", reason: "HTTP 503" };

  assert.deepEqual(failedPlatforms(results), [], "one platform still has working boards");

  const lost = failedBoards(results);
  assert.equal(lost.length, 2);
  // Sorted so the assertion does not depend on the order boards happen to sit in
  // BOARDS, which is editorial and reshuffled whenever a firm is added.
  assert.deepEqual(lost.map(([id]) => id).sort(), ["lightspeed", "nea"]);
  assert.deepEqual(
    Object.fromEntries(lost),
    { lightspeed: "fetch failed", nea: "HTTP 503" },
    "carries each board's own reason, not a generic one"
  );
});

// A board we have deliberately marked unsupported is a decision, not an outage, and
// must not show up as something to go and fix every single run.
test("does not report boards that are configured as unsupported", () => {
  const results = resultWith(() => "ok");
  const unsupported = Object.keys(BOARDS).filter((id) => !BOARDS[id].platform);
  assert.ok(unsupported.length > 0, "fixture needs at least one unsupported board");
  assert.deepEqual(failedBoards(results), []);
});

test("marks jobs that have a stored description, on both payloads", () => {
  const { allJobsPayload, firmPayload } = require("../scraper/pipeline");
  const data = { scrapedAt: "t", firms: { f1: { status: "ok", jobs: [
    { job_id: "a", company: "Acme", title: "Engineer", city: "SF" },
    { job_id: "b", company: "Acme", title: "Designer", city: "SF" },
  ] } } };
  const described = new Set(["a"]);
  const all = allJobsPayload(data, described).jobs;
  assert.equal(all.find((j) => j.job_id === "a").described, true);
  assert.equal(all.find((j) => j.job_id === "b").described, undefined);
  assert.equal(firmPayload(data, "f1", described).jobs.find((j) => j.job_id === "a").described, true);
  // Without the set (no descriptions.json), nothing is marked.
  assert.ok(allJobsPayload(data).jobs.every((j) => j.described === undefined));
});

// What the browser downloads. Fields no page reads stay in results.json; empty values
// are left out, since every reader treats a missing field as empty — except city, which
// the location filter indexes on directly.
const job = (over) => ({
  job_id: "acme_ats_1", company: "Acme", title: "Software Engineer", city: "New York", url: "https://acme.test/jobs/1",
  roles: ["swe"], seniority: "mid", posted: "2026-10-01", remote: false, salary: "", salaryMin: null, salaryMax: null,
  locations: ["New York, NY"], sponsorship: "unknown", sponsorshipEvidence: "", sponsorshipTypes: [],
  size: "51-200", stage: "Series A", markets: ["AI"], staffCount: 120, domain: "acme.test", logo: null, source: "ats",
  ...over,
});
const scrape = (jobs, extra = {}) => ({
  scrapedAt: "2026-10-16T00:00:00Z",
  enrichment: { companies: 1, failures: [{ company: "Acme", reason: "board not found" }] },
  firms: { a16z: { status: "ok", jobs, totalOnBoard: 3, atsCompanies: 1, fromAts: 1, fromBoard: 0, slugMap: { internal: true }, ...extra } },
});

test("the all-jobs download leaves out server-only fields and empty values", () => {
  const out = allJobsPayload(scrape([job()]), new Set(["acme_ats_1"]));
  assert.equal(out.enrichment, undefined, "scrape diagnostics are not published");
  assert.equal(out.scrapedAt, undefined);
  const [row] = out.jobs;
  for (const k of ["locations", "sponsorship", "sponsorshipEvidence", "sponsorshipTypes", "staffCount", "domain"]) {
    assert.equal(k in row, false, `${k} is not sent`);
  }
  for (const k of ["remote", "salary", "salaryMin", "salaryMax"]) assert.equal(k in row, false, `empty ${k} is left out`);
  assert.equal(row.described, true);
  assert.deepEqual(row.roles, ["swe"]);
  assert.equal(row.title, "Software Engineer");
  // Company facts are hoisted into the companies table, without the server-only ones.
  const co = out.companies[row.c];
  assert.equal(co.n, "Acme");
  assert.equal(co.size, "51-200");
  assert.equal("staffCount" in co || "domain" in co, false);
});

test("a job with no city keeps the field, so the location filter can still read it", () => {
  const [row] = allJobsPayload(scrape([job({ city: null })])).jobs;
  assert.equal("city" in row, true);
  assert.equal(row.city, null);
});

test("mergeJobs keeps every field for the scripts that need them", () => {
  const [merged] = mergeJobs(scrape([job()]));
  assert.equal(merged.staffCount, 120);
  assert.equal(merged.domain, "acme.test");
  assert.deepEqual(merged.firms, ["a16z"]);
});

test("a firm's file carries only what the firm page reads", () => {
  const out = firmPayload(scrape([job()]), "a16z");
  assert.deepEqual(Object.keys(out).sort(), ["atsCompanies", "fromAts", "fromBoard", "host", "jobs", "reason", "status", "totalOnBoard"]);
  assert.equal("locations" in out.jobs[0], false);
});
