const test = require("node:test");
const assert = require("node:assert/strict");
const { requestFor, parseAssessment, assess, MODEL } = require("../jev");

const resume = "Senior engineer.\nBuilt distributed services in Go handling 50k requests per second.\nLed a Kubernetes migration that cut deploys to ten minutes.\nWrote Terraform modules for AWS networking.";
const job = {
  job_id: "x",
  title: "Backend Engineer",
  html: "<p><strong>About us</strong></p><p>We build payments software.</p>" +
    "<p><strong>Requirements</strong></p><ul><li>Experience building distributed services in Go</li><li>Hands-on Kubernetes experience in production</li><li>A degree in Computer Science or similar</li></ul>" +
    "<p><strong>Nice to have</strong></p><ul><li>Experience with Rust in production systems</li></ul>" +
    "<p><strong>Benefits</strong></p><ul><li>Health insurance for you and your family</li></ul>",
};

// Answers in the shape Jev returns. `status` and `evidence` map requirement text
// fragments to the choice wanted; everything else defaults to unclear / none.
function answers(request, status = {}, evidence = {}, conf = 0.9) {
  const out = { model: request.body.model, answers: {} };
  const statusKeys = ["shown", "partial", "unclear", "skip"];
  const evidenceKeys = ["none", ...Object.keys(request.resumePassages)];
  const dist = (keys, pick, c) => Object.fromEntries(keys.map((k) => [k, k === pick ? c : (1 - c) / (keys.length - 1)]));
  for (const it of request.items) {
    const s = Object.entries(status).find(([frag]) => it.text.includes(frag));
    const e = Object.entries(evidence).find(([frag]) => it.text.includes(frag));
    const sc = s ? s[1] : "unclear";
    const ec = e ? e[1] : "none";
    out.answers["c_" + it.id] = { type: "choice", choice: sc, confidence: conf, probabilities: dist(statusKeys, sc, conf) };
    out.answers["e_" + it.id] = { type: "choice", choice: ec, confidence: conf, probabilities: dist(evidenceKeys, ec, conf) };
  }
  return out;
}

test("asks one status and one evidence question per requirement, leaving benefits and company copy out", () => {
  const r = requestFor(resume, job);
  assert.deepEqual(r.items.map((i) => i.kind), ["required", "required", "required", "preferred"]);
  assert.equal(Object.keys(r.body.questions).length, 8);
  assert.ok(r.items.every((i) => !/insurance|payments/.test(i.text)));
  assert.equal(r.body.model, MODEL);
});

test("links each demonstrated requirement to the résumé line behind it", () => {
  const r = requestFor(resume, job);
  const go = Object.keys(r.resumePassages).find((k) => /Go handling/.test(r.resumePassages[k]));
  const out = parseAssessment(answers(r, { "in Go": "shown" }, { "in Go": go }), r);
  const f = out.findings.find((x) => x.text.includes("in Go"));
  assert.equal(f.status, "shown");
  assert.match(f.evidence, /Go handling/);
  assert.equal(out.summary.demonstrated, 1);
  assert.equal(out.summary.required.total, 3);
  assert.equal(out.summary.preferred.total, 1);
});

test("a requirement marked demonstrated with no supporting line is not shown as a strength", () => {
  const r = requestFor(resume, job);
  const out = parseAssessment(answers(r, { Kubernetes: "partial" }, {}, 0.6), r);
  const f = out.findings.find((x) => x.text.includes("Kubernetes"));
  assert.equal(f.status, "unclear");
  assert.equal(f.evidence, null);
});

test("rejects an assessment that contradicts itself too often", () => {
  const r = requestFor(resume, job);
  const all = { "in Go": "shown", Kubernetes: "shown", degree: "shown", Rust: "shown" };
  assert.throws(() => parseAssessment(answers(r, all, {}, 0.95), r), /contradicted itself/);
});

test("items the model calls not a requirement are left out of findings and score", () => {
  const r = requestFor(resume, job);
  const out = parseAssessment(answers(r, { degree: "skip" }), r);
  assert.ok(!out.findings.some((x) => x.text.includes("degree")));
  assert.equal(out.summary.total, 3);
});

test("weights required items above preferences", () => {
  const r = requestFor(resume, job);
  const go = Object.keys(r.resumePassages).find((k) => /Go handling/.test(r.resumePassages[k]));
  const required = parseAssessment(answers(r, { "in Go": "shown" }, { "in Go": go }, 1), r).score;
  const preferred = parseAssessment(answers(r, { Rust: "shown" }, { Rust: go }, 1), r).score;
  assert.ok(required > preferred, `${required} > ${preferred}`);
});

test("a normal résumé with many lines is neither shortened nor quote-capped", () => {
  const twoPages = Array.from({ length: 60 }, (_, i) => `Built system number ${i} with a long enough description line.`).join("\n");
  assert.deepEqual(
    { s: requestFor(twoPages, job).limits.resumeShortened, q: requestFor(twoPages, job).limits.resumeQuotesCapped },
    { s: false, q: false }
  );
});

test("says which résumé limit applied: quotes capped, or text cut", () => {
  const manyLines = Array.from({ length: 150 }, (_, i) => `Built system ${i} with a description line.`).join("\n");
  assert.equal(requestFor(manyLines, job).limits.resumeQuotesCapped, true);
  assert.equal(requestFor(manyLines, job).limits.resumeShortened, false);
  const huge = "Wrote production services in Go for payments. ".repeat(500);
  assert.equal(requestFor(huge, job).limits.resumeShortened, true);
});

test("rejects an invalid answer shape", () => {
  const r = requestFor(resume, job);
  const bad = answers(r);
  bad.answers.c_q0.choice = "maybe";
  assert.throws(() => parseAssessment(bad, r), /invalid answer/);
});

test("assess sends the key and refuses without one", async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = init;
    const body = JSON.parse(init.body);
    const r = requestFor(resume, job);
    return { ok: true, status: 200, json: async () => answers({ ...r, body }) };
  };
  const out = await assess(resume, job, { apiKey: "k", fetch });
  assert.equal(seen.headers.authorization, "Bearer k");
  assert.equal(typeof out.score, "number");
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  await assert.rejects(assess(resume, job, { fetch }), /not configured/);
  if (saved) process.env.TYPESAFE_API_KEY = saved;
});
