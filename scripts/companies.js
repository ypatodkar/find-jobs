#!/usr/bin/env node
// Small local registry administration tool; does not deploy or publish changes.
const path = require("node:path");
const { BOARDS } = require("../scraper/boards");
const { detectAts, fetchCompany } = require("../scraper/ats");
const { resolveCareers } = require("../scraper/careers");
const { recordSuccess } = require("../scraper/registry-pipeline");
const { STATE_FILE, SEED_FILE, loadState, atomicJson, withStateLock, observeCompany, atsEntry, domainOf, seedPayload } = require("../scraper/registry");

async function main() {
  const [command = "list", url, ...args] = process.argv.slice(2);
  if (command === "--help") {
    console.log("node scripts/companies.js list\nnode scripts/companies.js seed\nnode scripts/companies.js export-seed\nnode scripts/companies.js add <website-or-careers-url> [--name <name>] [--website <url>]\nImports and changes are local. export-seed writes config/companies.json for review and deployment.");
    return;
  }
  if (!["list", "seed", "export-seed", "add"].includes(command)) throw new Error("Unknown command; use --help");
  const flags = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--name", "--website"].includes(args[i]) || !args[i + 1]) throw new Error("Expected --name or --website with a value");
    flags[args[i]] = args[i + 1];
  }
  return withStateLock(STATE_FILE, async () => {
    const state = await loadState(STATE_FILE, {
      resultsFile: path.join(__dirname, "../data/results.json"),
      descriptionsFile: path.join(__dirname, "../data/descriptions.json"), boards: BOARDS,
    });
    if (command === "add") {
      if (!url || !/^https?:\/\//i.test(url)) throw new Error("Provide a full HTTP(S) website or careers URL");
      const ats = detectAts(url), now = new Date().toISOString();
      const co = observeCompany(state, {
        company: flags["--name"] || ats?.slug || domainOf(url), url,
        domain: domainOf(flags["--website"] || (!ats ? url : null)),
      }, { now, sourceUrl: url });
      if (!co) throw new Error("Company is excluded by scraper configuration");
      const { candidates, errors } = await resolveCareers(co);
      co.lastRepairAt = now;
      for (const candidate of candidates) {
        const key = `${candidate.ats}:${candidate.slug}`;
        const existing = Object.values(state.companies).find((c) => c.id !== co.id && c.key === key);
        if (existing) {
          existing.meta.domain ||= co.meta.domain;
          existing.sources = [...new Set([...existing.sources, ...co.sources])];
          if (!co.lastSuccessAt) delete state.companies[co.id];
          await atomicJson(STATE_FILE, state);
          console.log(`Already tracking ${existing.company}: ${key}`);
          return;
        }
        const result = await fetchCompany({ ...atsEntry(co), ...candidate, key });
        if (!result.ok) { errors.push(result.reason); continue; }
        co.key = key; co.ats = candidate.ats; co.slug = candidate.slug; co.careersUrl = candidate.url;
        recordSuccess(co, result, now);
        break;
      }
      if (!co.lastSuccessAt) co.repairError = errors.join("; ") || "No supported careers board found";
      console.log(`${co.company}: ${co.lastSuccessAt ? `${co.key}, ${co.lastJobs.length} matching jobs` : `saved for retry (${co.repairError})`}`);
    }
    if (command === "seed" || command === "add") await atomicJson(STATE_FILE, state);
    if (command === "export-seed") {
      const seed = seedPayload(state);
      const companies = seed.companies;
      await atomicJson(SEED_FILE, seed, 2);
      console.log(`Exported ${companies.length} companies to config/companies.json (no jobs or descriptions).`);
    } else if (command !== "add") {
      const companies = Object.values(state.companies);
      console.log(JSON.stringify({ companies: companies.length, connected: companies.filter((c) => c.key).length, unresolved: companies.filter((c) => !c.key).length, failing: companies.filter((c) => c.lastError).length, updatedAt: state.updatedAt }, null, 2));
    }
  });
}
if (require.main === module) main().catch((err) => { console.error(err.message); process.exitCode = 1; });
module.exports = { main };
