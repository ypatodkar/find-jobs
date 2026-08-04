const test = require("node:test");
const assert = require("node:assert/strict");
const { classifySponsorship, toPlainText } = require("../sponsorship");

test("detects explicit sponsorship availability", () => {
  const result = classifySponsorship("Visa sponsorship is available for qualified candidates.");
  assert.equal(result.status, "yes");
  assert.match(result.evidence, /available/i);
});

test("detects explicit refusal and lets negation win", () => {
  const result = classifySponsorship("Applicants may ask about visas. We are unable to provide visa sponsorship now or in the future.");
  assert.equal(result.status, "no");
  assert.match(result.evidence, /unable/i);
});

test("handles concise sponsor and cannot-sponsor wording", () => {
  assert.equal(classifySponsorship("We can sponsor qualified applicants.").status, "yes");
  assert.equal(classifySponsorship("Unfortunately, we cannot sponsor at this time.").status, "no");
  assert.equal(classifySponsorship("The employer is unable to sponsor.").status, "no");
});

test("does not infer sponsorship from generic authorization language", () => {
  assert.equal(classifySponsorship("Must be authorized to work in the United States.").status, "unknown");
  assert.equal(classifySponsorship("We consider applicants without regard to citizenship or immigration status.").status, "unknown");
});

test("reads encoded HTML and extracts visa types", () => {
  const input = "&lt;p&gt;We offer H-1B visa sponsorship and STEM OPT support.&lt;/p&gt;";
  const result = classifySponsorship(input);
  assert.equal(result.status, "yes");
  assert.deepEqual(result.types, ["STEM OPT", "H-1B"]);
  assert.equal(toPlainText(input), "We offer H-1B visa sponsorship and STEM OPT support.");
});

test("reports unknown when descriptions omit sponsorship", () => {
  assert.deepEqual(classifySponsorship("Build reliable distributed systems."), {
    status: "unknown", evidence: null, types: [],
  });
});

// The cases below are verbatim from a 7,011-posting sample of live boards; each was
// the most common wording in its category and each was previously missed.

test("ignores 'sponsor' used in its business senses", () => {
  assert.equal(classifySponsorship("Serve as an executive sponsor for key enterprise accounts.").status, "unknown");
  assert.equal(classifySponsorship("Flexport provides an employer-sponsored program at no cost to you.").status, "unknown");
  assert.equal(classifySponsorship("Align with executives and gain sponsorship for enterprise wide deployments.").status, "unknown");
  // Read as a visa refusal before the noise filter existed.
  assert.equal(classifySponsorship("You'll pitch sessions to events we don't sponsor, not just the ones we do.").status, "unknown");
});

test("reads plain present-tense offers with no modal", () => {
  const r = classifySponsorship("Visa sponsorship: We sponsor visas: H1B, O1, EB1, L1, STEM + OPT, and more.");
  assert.equal(r.status, "yes");
  assert.ok(r.types.includes("H-1B"));
  assert.equal(classifySponsorship("We also help with visa transfers if needed.").status, "yes");
});

test("reads refusals with an adverb or 'employer' in the way", () => {
  assert.equal(classifySponsorship("Please note we cannot currently sponsor or support visa transfers at this time.").status, "no");
  assert.equal(
    classifySponsorship("Candidates must be authorized to work in the United States without current or future employer sponsorship.").status,
    "no"
  );
});

test("treats citizenship and clearance requirements as no sponsorship", () => {
  const r = classifySponsorship("Due to federal contract requirements, U.S. citizenship is required for this position.");
  assert.equal(r.status, "no");
  assert.equal(r.reason, "citizenship");
  assert.equal(classifySponsorship("Citizenship, Lawful Permanent Residency, or Refugee/Asylee Status Required.").status, "no");
  assert.equal(classifySponsorship("Active Secret Clearance required.").status, "no");
  // "citizen" on its own is not a requirement.
  assert.equal(classifySponsorship("We aim to be a good corporate citizen in every market.").status, "unknown");
});

test("an explicit offer outranks a clearance mentioned elsewhere", () => {
  const r = classifySponsorship("We sponsor visas for this role. Some adjacent programs require an active Secret clearance.");
  assert.equal(r.status, "yes");
});

test("E-Verify is not a sponsorship signal", () => {
  assert.equal(classifySponsorship("Headway participates in E-Verify.").status, "unknown");
  assert.equal(classifySponsorship("Carta uses E-Verify in the United States for employment authorization.").status, "unknown");
});
