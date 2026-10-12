// Produces an import artifact for RDS, separate from the public browser payloads.
const fs = require('node:fs/promises');
const path = require('node:path');
const { allJobsPayload } = require('../src/pipeline');
const { entries } = require('../aws/lambda/catalogue.cjs');
function catalogueData(results) {
  const metadata = { scrapedAt: results.scrapedAt, firms: {}, failures: results.enrichment?.failures || [] };
  for (const [id, { jobs, ...info }] of Object.entries(results.firms || {})) metadata.firms[id] = { ...info, count: (jobs || []).length };
  const data = allJobsPayload(results, { descriptions: true });
  const jobs = entries(data);
  metadata.summary = { total: jobs.length, companies: new Set(jobs.map(j => j.payload.company)).size };
  return { data, metadata };
}
async function main() {
  const results = JSON.parse(await fs.readFile(path.join(__dirname, '..', 'results.json'), 'utf8'));
  await fs.mkdir(path.join(__dirname, '..', '.catalogue'), { recursive: true });
  await fs.writeFile(path.join(__dirname, '..', '.catalogue/catalogue.json'), JSON.stringify(catalogueData(results)));
  console.log('Wrote .catalogue/catalogue.json for the database import.');
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { catalogueData };
