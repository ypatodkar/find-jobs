// Checking job classification (classify.js) against hand labels.
//
//   node scripts/validate-classify.js
//
// Puts every job in validation/classify-labels.json to Jev, in batches as the scrape
// would, and reports how often its field and level agree with the label, with and
// without the title override. Each label is { job_id, field, level } with field cs |
// not_cs and level early | experienced | unclear; `borderline: "field" | "level"`
// marks a label a reasonable person could give the other way, and those are reported
// apart rather than counted. Exits 1 below the thresholds.
//
// Needs TYPESAFE_API_KEY (read from .env) and descriptions.json from a scrape.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const LABELS = path.join(ROOT, "validation", "classify-labels.json");
const THRESHOLDS = {
  field: 0.95,      // cs vs not_cs
  earlyRecall: 0.9, // labelled early and kept as early: a missed early job is never seen
  earlyPrecision: 0.85,
};

for (const line of fs.existsSync(path.join(ROOT, ".env")) ? fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/) : []) {
  const m = /^\s*(TYPESAFE_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
}

const { classify, withTitle } = require(path.join(ROOT, "classify"));
const { deriveSeniority } = require(path.join(ROOT, "match"));

async function main() {
  const labels = JSON.parse(fs.readFileSync(LABELS, "utf8"));
  const descriptions = JSON.parse(fs.readFileSync(path.join(ROOT, "descriptions.json"), "utf8"));
  const jobs = labels.map((l) => ({ company: l.company, title: l.title, html: descriptions[l.job_id] || "" }));
  const missing = jobs.filter((j) => !j.html).length;
  if (missing) console.log(`${missing} labelled jobs have no stored description; they are judged on the title alone.\n`);

  let tokens = 0;
  const started = Date.now();
  const raw = await classify(jobs, { onUsage: (u) => (tokens += u.input_tokens || 0) });
  console.log(`${labels.length} jobs, ${Math.ceil(labels.length / 30)} requests, ${tokens.toLocaleString()} input tokens, ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  const report = (name, got) => {
    const firm = (key) => labels.map((l, i) => ({ l, g: got[i] })).filter(({ l }) => l.borderline !== key);
    const field = firm("field");
    const fieldOk = field.filter(({ l, g }) => l.field === g.field).length / field.length;

    // Level matters only for computing roles; a hardware job's level hides it either way.
    const cs = firm("level").filter(({ l }) => l.field === "cs");
    const labelledEarly = cs.filter(({ l }) => l.level === "early");
    const calledEarly = cs.filter(({ g }) => g.level === "early");
    const recall = labelledEarly.filter(({ g }) => g.level === "early").length / labelledEarly.length;
    const precision = calledEarly.length ? calledEarly.filter(({ l }) => l.level === "early").length / calledEarly.length : 0;
    const levelOk = cs.filter(({ l, g }) => l.level === g.level).length / cs.length;

    const pct = (x) => (x * 100).toFixed(0) + "%";
    console.log(`${name}`);
    console.log(`  field agreement      ${pct(fieldOk)}  (${field.length} jobs)`);
    console.log(`  level agreement      ${pct(levelOk)}  (${cs.length} CS jobs, all three levels)`);
    console.log(`  early-career recall  ${pct(recall)}  (of ${labelledEarly.length} labelled early)`);
    console.log(`  early precision      ${pct(precision)}  (of ${calledEarly.length} called early)\n`);
    return { fieldOk, recall, precision };
  };

  const final = labels.map((l, i) => withTitle(raw[i], deriveSeniority(l.title)));
  report("Jev alone", raw);
  const scores = report("Jev, with the title deciding when it states a level", final);

  console.log("Disagreements (label → answer, confidence):");
  labels.forEach((l, i) => {
    const g = final[i];
    const diffs = [];
    if (l.field !== g.field) diffs.push(`field ${l.field} → ${g.field} ${g.fieldConfidence}`);
    if (l.field === "cs" && l.level !== g.level) diffs.push(`level ${l.level} → ${g.level} ${g.levelConfidence}${g.levelFromTitle ? " (title)" : ""}`);
    if (diffs.length) console.log(`  ${l.borderline ? "~" : " "} ${l.company} — ${l.title}: ${diffs.join("; ")}`);
  });
  console.log("\n  ~ borderline label, not counted above");

  const failed = scores.fieldOk < THRESHOLDS.field || scores.recall < THRESHOLDS.earlyRecall || scores.precision < THRESHOLDS.earlyPrecision;
  if (failed) {
    console.log(`\nBelow the thresholds (field ${THRESHOLDS.field * 100}%, early recall ${THRESHOLDS.earlyRecall * 100}%, early precision ${THRESHOLDS.earlyPrecision * 100}%).`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
