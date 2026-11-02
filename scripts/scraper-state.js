#!/usr/bin/env node
// Durable CI state in S3, separate from disposable Actions classification caches.
// It contains public company/job observations only, never accounts or credentials.
const fs = require("node:fs/promises");
const { spawnSync } = require("node:child_process");
const { gzipSync, gunzipSync } = require("node:zlib");
const { STATE_FILE, atomicJson, validateState } = require("../scraper/registry");
const BUCKET = process.env.SCRAPER_STATE_BUCKET || "find-jobs-site-075521919080";
const KEY = "_scraper/state.json.gz";

function aws(args, { missingOK = false } = {}) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (missingOK && /\((?:404|NoSuchKey|NotFound)\)/.test(result.stderr)) return false;
    throw new Error(`Scraper state storage failed: ${result.stderr.trim()}`);
  }
  return true;
}
async function syncState(action, { file = STATE_FILE, bucket = BUCKET, run = aws } = {}) {
  if (!["restore", "save"].includes(action)) throw new Error("Usage: node scripts/scraper-state.js restore|save");
  const compressed = `${file}.gz`;
  await fs.mkdir(require("node:path").dirname(file), { recursive: true });
  if (action === "restore") {
    if (!run(["s3api", "head-object", "--bucket", bucket, "--key", KEY], { missingOK: true })) {
      console.log("No remote scraper snapshot yet; bootstrapping from the checked-in company seed.");
      return;
    }
    run(["s3", "cp", `s3://${bucket}/${KEY}`, compressed, "--only-show-errors"]);
    const state = validateState(JSON.parse(gunzipSync(await fs.readFile(compressed)).toString("utf8")));
    await atomicJson(file, state);
    await fs.rename(compressed, `${compressed}.previous`);
    console.log(`Restored ${Object.keys(state.companies).length} companies from durable storage.`);
  } else {
    const raw = await fs.readFile(file);
    validateState(JSON.parse(raw));
    await fs.writeFile(compressed, gzipSync(raw));
    try {
      await fs.access(`${compressed}.previous`);
      run(["s3", "cp", `${compressed}.previous`, `s3://${bucket}/_scraper/previous.json.gz`, "--only-show-errors", "--cache-control", "no-store"]);
    } catch (err) { if (err.code !== "ENOENT") throw err; }
    run(["s3", "cp", compressed, `s3://${bucket}/${KEY}`, "--only-show-errors", "--cache-control", "no-store"]);
    console.log("Saved durable scraper state and retained the previous snapshot.");
  }
}
if (require.main === module) syncState(process.argv[2]).catch((err) => { console.error(err.message); process.exitCode = 1; });
module.exports = { aws, syncState };
