// Checking résumé matching against people's own judgement.
//
// The page shows a 0–100 score alongside which requirements a résumé does and does not
// demonstrate. This script measures how often the model agrees with human reviewers,
// so the score's reliability is a number rather than a guess.
//
//   node scripts/validate-matches.js template <job_id> <résumé file> [name]
//       Adds a review to validation/reviews.json for that résumé and job, listing the
//       requirements the matcher will ask about, each with "status": null for a
//       person to fill in: "shown", "partial" or "unclear" (not demonstrated) — or
//       "skip" for an item that is not really a requirement. Also set "band" to the
//       overall label they would give: "Strong", "Good", "Partial" or "Weak".
//
//   node scripts/validate-matches.js run
//       Scores every completed review with Jev (one request each) and reports how
//       often the model agrees with the reviewer. Exits 1 below the thresholds.
//
// Needs TYPESAFE_API_KEY (read from .env) and descriptions.json from a scrape.
// Résumés live under validation/resumes/, which is git-ignored: real ones are personal.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REVIEWS = path.join(ROOT, "validation", "reviews.json");
const THRESHOLDS = {
  demonstratedAgreement: 0.8, // "demonstrated vs not" matches the reviewer
  bandAgreement: 0.7,         // same overall label
};

for (const line of fs.existsSync(path.join(ROOT, ".env")) ? fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/) : []) {
  const m = /^\s*(TYPESAFE_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const jev = require(path.join(ROOT, "jev"));
const { requestFor } = jev;

function band(score) {
  // Must match verdict() in resume-match.js.
  if (score >= 80) return "Strong";
  if (score >= 60) return "Good";
  if (score >= 40) return "Partial";
  return "Weak";
}

const readReviews = () => (fs.existsSync(REVIEWS) ? JSON.parse(fs.readFileSync(REVIEWS, "utf8")) : []);
const descriptions = () => JSON.parse(fs.readFileSync(path.join(ROOT, "descriptions.json"), "utf8"));
const isDemonstrated = (s) => s === "shown" || s === "partial";

function template(jobId, resumeFile, name) {
  const html = descriptions()[jobId];
  if (!html) throw new Error(`No description for ${jobId} in descriptions.json.`);
  const resume = fs.readFileSync(path.resolve(resumeFile), "utf8");
  const { items } = requestFor(resume, { job_id: jobId, title: "", html });
  const reviews = readReviews();
  reviews.push({
    name: name || `${path.basename(resumeFile)} × ${jobId}`,
    resume: path.relative(ROOT, path.resolve(resumeFile)),
    job_id: jobId,
    reviewer: null,
    band: null,
    requirements: items.map((it) => ({ text: it.text, kind: it.kind, status: null })),
  });
  fs.mkdirSync(path.dirname(REVIEWS), { recursive: true });
  fs.writeFileSync(REVIEWS, JSON.stringify(reviews, null, 2) + "\n");
  console.log(`Added "${reviews[reviews.length - 1].name}" with ${items.length} requirements to ${path.relative(ROOT, REVIEWS)}.`);
}

async function run() {
  const all = readReviews();
  const done = all.filter((r) => r.band && r.requirements.every((q) => q.status));
  if (!done.length) {
    console.log(`No completed reviews in ${path.relative(ROOT, REVIEWS)} yet (${all.length} started). Fill in every "status" and "band".`);
    process.exit(1);
  }
  const desc = descriptions();
  let items = 0, exact = 0, demo = 0, bands = 0;
  const confusion = {}; // reviewer -> model -> n
  for (const r of done) {
    const resume = fs.readFileSync(path.join(ROOT, r.resume), "utf8");
    const out = await jev.assess(resume, { job_id: r.job_id, title: r.name, html: desc[r.job_id] });
    const modelBand = band(out.score);
    if (modelBand === r.band) bands++;
    let rowExact = 0, rowDemo = 0, rowItems = 0;
    for (const q of r.requirements) {
      const f = out.findings.find((x) => x.text === q.text);
      const model = f ? f.status : "skip";
      if (q.status === "skip" && model === "skip") continue; // both agree it does not count
      rowItems++;
      if (model === q.status) rowExact++;
      if (isDemonstrated(model) === isDemonstrated(q.status)) rowDemo++;
      (confusion[q.status] = confusion[q.status] || {})[model] = (confusion[q.status][model] || 0) + 1;
    }
    items += rowItems; exact += rowExact; demo += rowDemo;
    console.log(`${r.name}\n  label: reviewer ${r.band}, model ${modelBand} (score ${out.score})` +
      `  ·  items: ${rowDemo}/${rowItems} same demonstrated-or-not, ${rowExact}/${rowItems} exact`);
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  console.log(`\n${done.length} reviews, ${items} requirement judgements`);
  console.log(`  demonstrated-or-not agreement  ${pct(demo, items)}%   (needs ${THRESHOLDS.demonstratedAgreement * 100}%)`);
  console.log(`  exact status agreement         ${pct(exact, items)}%`);
  console.log(`  overall label agreement        ${pct(bands, done.length)}%   (needs ${THRESHOLDS.bandAgreement * 100}%)`);
  console.log("\n  reviewer ↓ / model →   shown  partial  unclear  skip");
  for (const s of ["shown", "partial", "unclear", "skip"]) {
    const row = confusion[s] || {};
    console.log(`  ${s.padEnd(22)} ${["shown", "partial", "unclear", "skip"].map((m) => String(row[m] || 0).padStart(5)).join("  ")}`);
  }
  const ok = demo / items >= THRESHOLDS.demonstratedAgreement && bands / done.length >= THRESHOLDS.bandAgreement;
  console.log(ok ? "\nPasses the agreement thresholds." : "\nBelow the agreement thresholds.");
  process.exit(ok ? 0 : 1);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "template" && args.length >= 2) template(args[0], args[1], args[2]);
else if (cmd === "run") run().catch((e) => { console.error(e.message); process.exit(1); });
else {
  console.log("Usage:\n  node scripts/validate-matches.js template <job_id> <résumé file> [name]\n  node scripts/validate-matches.js run");
  process.exit(1);
}
