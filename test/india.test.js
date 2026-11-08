// The India list: Indian places, a row per country, where a company is based, the
// Indian careers systems, portfolio discovery and the per-country payloads.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { keep, placeRows, matchIndiaCity, countryOf, companyCountry } = require("../scraper/match");
const { detectAts, fetchCompany } = require("../scraper/ats");
const { allJobsPayload, firmPayload } = require("../scraper/pipeline");
const { refreshRegistry, hqOf } = require("../scraper/registry-pipeline");
const { emptyState } = require("../scraper/registry");
const { cleanName, discoverPortfolios } = require("../scraper/portfolio");
const { INDIA_PORTFOLIOS, isIndianFirm } = require("../scraper/india");
const { BOARDS } = require("../scraper/boards");

test("buckets Indian places into metros, remote and the rest, and never reads IN as India", () => {
  assert.equal(matchIndiaCity(["Bangalore, Karnataka, India"]), "Bengaluru");
  assert.equal(matchIndiaCity(["Gurugram, Haryana"]), "Delhi NCR");
  assert.equal(matchIndiaCity(["Remote", "India"]), "Remote (India)");
  assert.equal(matchIndiaCity(["Kochi, Kerala, India"]), "Other India");
  assert.equal(matchIndiaCity(["Indianapolis, IN"]), null);
  assert.equal(matchIndiaCity(["Remote"]), null);
});

test("keeps only US places by default, as before India was tracked", () => {
  assert.equal(keep("Backend Engineer", ["Bengaluru, India"]), null);
  const us = keep("Backend Engineer", ["San Francisco, CA"]);
  assert.equal(us.city, "San Francisco");
  assert.equal(us.country, "US");
});

test("a role in both countries gets a row in each, and the US row keeps its id", () => {
  const hit = keep("Backend Engineer", ["San Francisco, CA", "Bengaluru, India"], ["US", "IN"]);
  assert.deepEqual(hit.places, [{ city: "San Francisco", country: "US" }, { city: "Bengaluru", country: "IN" }]);
  const rows = placeRows({ job_id: "us-id", city: hit.city, title: "Backend Engineer" }, hit, (city) => `id-${city}`);
  assert.deepEqual(rows.map((r) => [r.job_id, r.city, r.country]), [["us-id", "San Francisco", "US"], ["id-Bengaluru", "Bengaluru", "IN"]]);
  // A bare "Remote" stays a US remote role; it is not also an Indian one.
  assert.deepEqual(keep("Backend Engineer", ["Remote"], ["US", "IN"]).places, [{ city: "Remote", country: "US" }]);
  // An Indian board asks for India only.
  assert.equal(keep("Backend Engineer", ["San Francisco, CA"], ["IN"]), null);
});

test("an Indian row keeps rupee pay only; the US row keeps its dollars", async () => {
  const both = keep("Backend Engineer", ["San Francisco, CA", "Bengaluru"], ["US", "IN"]);
  const usd = { job_id: "x", salaryMin: 150000, salaryMax: 250000, salary: "USD 150,000–250,000 / year" };
  assert.deepEqual(placeRows(usd, both, (c) => c).map((r) => r.salary), ["USD 150,000–250,000 / year", null]);
  const india = keep("Backend Engineer", ["Bengaluru"], ["US", "IN"]);
  const inr = { job_id: "y", salaryMin: 5600000, salaryMax: 7350000, salary: "INR 5,600,000–7,350,000 / year" };
  assert.equal(placeRows(inr, india, (c) => c)[0].salary, inr.salary);
  assert.equal(placeRows(usd, india, (c) => c)[0].salaryMin, null);
  const { compactPay } = await import("../web/src/lib/jobs.js");
  assert.equal(compactPay(inr), "₹56–73.5 LPA");
  assert.equal(compactPay(usd), "$150k–$250k");
});

test("tells where a company is based from where its openings are", () => {
  assert.equal(countryOf(["New York, NY", "Bengaluru"]), "US");
  assert.equal(countryOf(["Pune, Maharashtra, India"]), "IN");
  assert.equal(countryOf(["London, United Kingdom"]), "other");
  assert.equal(countryOf(["Remote"]), null);
  assert.equal(companyCountry({ mix: { US: 30, IN: 4, other: 0 } }), "US");
  assert.equal(companyCountry({ mix: { US: 2, IN: 40, other: 1 } }), "IN");
  assert.equal(companyCountry({ mix: { US: 0, IN: 3, other: 9 } }), "other");
  assert.equal(companyCountry({ domain: "razorpay.in", mix: { US: 9, IN: 1 } }), "IN");
  assert.equal(companyCountry({ mix: {}, fallback: "IN" }), "IN");
});

test("an Indian investor's company with no openings to go by is Indian; a US one's is American", () => {
  const co = (firms) => ({ firms, meta: { domain: null }, lastJobs: [] });
  assert.equal(hqOf(co(["peak-xv"]), BOARDS), "IN");
  assert.equal(hqOf(co(["accel"]), BOARDS), "US");
  assert.equal(hqOf(co(["accel", "elevation"]), BOARDS), "US");
});

test("recognises the Indian careers systems by their URLs", () => {
  assert.deepEqual(detectAts("https://jupiter.keka.com/careers/jobdetails/145340"), { ats: "keka", slug: "jupiter", postingId: "145340" });
  assert.equal(detectAts("https://cdn.keka.com/careers/v/2026/"), null);
  assert.deepEqual(detectAts("https://apply.workable.com/lokal-app/j/64075F4565/"), { ats: "workable", slug: "lokal-app", postingId: "64075F4565" });
  assert.equal(detectAts("https://jobs.smartrecruiters.com/Wizikey/744000150346079-sales").slug, "Wizikey");
  assert.equal(detectAts("https://acme.recruitee.com/o/backend").ats, "recruitee");
  assert.equal(detectAts("https://zeni.bamboohr.com/careers/51").postingId, "51");
});

test("reads a Keka board through the portal id its careers page names", async (t) => {
  const portal = "b5279857-cf81-4dde-a215-fc48957ee2b5";
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).endsWith("/careers/")) return new Response(`<script>fetch('/ats/documents/${portal}/careerportal/x.html')</script>`);
    assert.match(String(url), new RegExp(`/careers/api/embedjobs/default/active/${portal}$`));
    return Response.json([
      { id: 1, title: "Backend Engineer", description: "<p>Go</p>", publishedOn: "2026-11-01T00:00:00Z", jobLocations: [{ city: "Bengaluru", state: "KA", countryName: "India", name: "HQ" }] },
      { id: 2, title: "Sales Manager", description: "", jobLocations: [{ city: "Mumbai", countryName: "India" }] },
      { id: 3, title: "Backend Engineer", description: "", jobLocations: [{ city: "Austin", state: "TX", countryName: "United States" }] },
    ]);
  });
  const res = await fetchCompany({ company: "Jupiter", ats: "keka", slug: "jupiter", key: "keka:jupiter", meta: {} });
  assert.equal(res.ok, true);
  assert.deepEqual(res.jobs.map((j) => [j.title, j.city, j.country]), [["Backend Engineer", "Bengaluru", "IN"], ["Backend Engineer", "Austin", "US"]]);
  assert.equal(res.jobs[0].url, "https://jupiter.keka.com/careers/jobdetails/1");
  assert.deepEqual(res.mix, { US: 1, IN: 2, other: 0 });
  // A company only Indian investors list is read for the India list alone.
  const india = await fetchCompany({ company: "Jupiter", ats: "keka", slug: "jupiter", key: "keka:jupiter", meta: {}, countries: ["IN"] });
  assert.deepEqual(india.jobs.map((j) => j.city), ["Bengaluru"]);
});

test("names a company by a name that matches its website, else by the website", () => {
  assert.equal(cleanName(["Druva Resilience Cloud"], "druva.com"), "Druva");
  assert.equal(cleanName(["Eka Care: AI-Native Health OS"], "eka.care"), "Eka Care");
  assert.equal(cleanName(["Subscribe toKalaari’s Newsletters"], "digantara.co.in"), "Digantara");
  assert.equal(cleanName(["https://www.airalo.com/"], "airalo.com"), "Airalo");
  assert.equal(cleanName(["Razorpay POS Machine"], "ezetap.com"), "Ezetap");
  assert.equal(cleanName(["Razorpay USA"], "razorpay.com"), "Razorpay");
  assert.equal(cleanName(["DeHaat"], "agrevolution.in"), "DeHaat");
});

test("portfolio discovery admits companies on a supported system, credited to every firm", async () => {
  const state = emptyState();
  const portfolios = { "elevation": { name: "Elevation", portfolio: "https://www.elevationcapital.com/portfolio" }, "nexus": { name: "Nexus", portfolio: "https://www.nexusvp.com/companies" } };
  const extractPortfolio = async (cfg) => cfg.name === "Elevation"
    ? [{ website: "acme.in", name: "Acme" }, { website: "nojobs.in", name: "No Jobs" }]
    : [{ website: "acme.in", name: "Acme" }];
  const resolveCareers = async (co) => co.meta.domain === "acme.in"
    ? { candidates: [{ ats: "keka", slug: "acme", url: "https://acme.keka.com/careers/" }] }
    : { candidates: [], errors: ["No careers link"] };
  const now = "2026-11-08T00:00:00.000Z";
  const summary = await discoverPortfolios(state, { now, portfolios, extractPortfolio, resolveCareers, brandName: async () => null });
  assert.equal(summary.admitted, 1);
  const acme = Object.values(state.companies)[0];
  assert.equal(acme.key, "keka:acme");
  assert.deepEqual(acme.firms.sort(), ["elevation", "nexus"]);
  assert.equal(acme.meta.domain, "acme.in");
  assert.equal(state.portfolio.sites["nojobs.in"].key, null);
  // Nothing is re-crawled within the week, or re-checked within the month.
  let crawled = 0;
  await discoverPortfolios(state, { now: "2026-11-09T00:00:00.000Z", portfolios, extractPortfolio: async () => { crawled++; return []; }, resolveCareers: async () => { throw new Error("re-checked"); } });
  assert.equal(crawled, 0);
});

test("a company only Indian investors list never reaches the US list", async () => {
  const state = emptyState();
  state.companies["keka:acme"] = { id: "keka:acme", company: "Acme", key: "keka:acme", ats: "keka", slug: "acme", firms: ["elevation"], sources: [], meta: { domain: "acme.in", markets: [] }, careersUrl: null, lastJobs: [], consecutiveFailures: 0 };
  const asked = [];
  const results = await refreshRegistry(state, () => {}, {
    now: "2026-11-08T00:00:00.000Z", boards: {}, jobsOnly: true, portfolios: true,
    fetchAll: async (entries) => new Map(entries.map((e) => { asked.push(e.countries); return [e.key, { ok: true, jobs: [{ title: "Backend Engineer", city: "Bengaluru", country: "IN", job_id: "x" }], mix: { US: 0, IN: 1, other: 0 } }]; })),
  });
  assert.deepEqual(asked, [["IN"]]);
  const job = results.firms.elevation.jobs[0];
  assert.equal(job.hq, "IN");
  assert.equal(allJobsPayload(results).jobs.length, 0);
  assert.equal(allJobsPayload(results, null, "IN").jobs.length, 1);
});

test("each list carries only its own country's rows; investor pages are the US list's", () => {
  const data = { firms: { accel: { status: "ok", jobs: [
    { job_id: "a", company: "Acme", title: "Backend Engineer", city: "San Francisco", country: "US", hq: "US" },
    { job_id: "b", company: "Acme", title: "Backend Engineer", city: "Bengaluru", country: "IN", hq: "US" },
    { job_id: "c", company: "Old", title: "SRE", city: "Austin" }, // from before countries
  ] } }, directJobs: [] };
  const us = allJobsPayload(data), india = allJobsPayload(data, null, "IN");
  assert.deepEqual(us.jobs.map((j) => j.job_id), ["a", "c"]);
  assert.deepEqual(india.jobs.map((j) => j.job_id), ["b"]);
  assert.equal(india.companies[india.jobs[0].c].hq, "US");
  assert.equal("country" in india.jobs[0], false);
  assert.deepEqual(firmPayload(data, "accel").jobs.map((j) => j.job_id), ["a", "c"]);
});

test("every Indian source is a known Indian firm with a label on the site", () => {
  const site = fs.readFileSync(path.join(__dirname, "../web/src/data.js"), "utf8");
  const ids = [...Object.keys(INDIA_PORTFOLIOS), ...Object.keys(BOARDS).filter((id) => BOARDS[id].countries)];
  for (const id of ids) {
    assert.equal(isIndianFirm(id), true, id);
    assert.match(site, new RegExp(`\\["${id}", "`), `no label for ${id} in web/src/data.js`);
  }
  assert.equal(isIndianFirm("accel"), false);
});

test("the India list offers Company HQ, all ticked, and the US list does not", async () => {
  const { dimensions } = await import("../web/src/lib/filters.js");
  const hq = dimensions({ country: "IN" }).find((d) => d.key === "hq");
  assert.equal(hq.group, "primary");
  assert.equal(hq.allChecked, true);
  assert.deepEqual(hq.order, ["IN", "US", "other"]);
  assert.equal(hq.labelFor("IN"), "India");
  assert.equal(dimensions().some((d) => d.key === "hq"), false);
});
