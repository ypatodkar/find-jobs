// Upload a scrape artifact and invoke the importer through IAM, never the public API.
// AWS CLI uses the caller's existing profile/environment credentials.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
function main() {
  const bucket = process.env.CATALOGUE_BUCKET;
  const fn = process.env.CATALOGUE_LAMBDA_FUNCTION;
  if (!bucket || !fn) throw new Error('Set CATALOGUE_BUCKET and CATALOGUE_LAMBDA_FUNCTION before importing.');
  const file = path.join(__dirname, '../.catalogue/catalogue.json');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'find-jobs-import-'));
  try {
    const payload = path.join(temp, 'request.json'), response = path.join(temp, 'response.json');
    fs.writeFileSync(payload, JSON.stringify({ action: 'import-catalogue', sha256 }));
    execFileSync('aws', ['s3', 'cp', file, `s3://${bucket}/catalogue/current.json`, '--only-show-errors'], { stdio: 'inherit' });
    const invocation = JSON.parse(execFileSync('aws', ['lambda', 'invoke', '--function-name', fn,
      '--cli-binary-format', 'raw-in-base64-out', '--payload', `file://${payload}`, '--cli-read-timeout', '180', response], { encoding: 'utf8' }));
    if (invocation.FunctionError) throw new Error('Catalogue import failed. Check the Lambda configuration and database migration before publishing.');
    const result = JSON.parse(fs.readFileSync(response, 'utf8'));
    if (!Number.isInteger(result.jobs) || result.jobs < 1) throw new Error('Importer did not confirm a populated catalogue.');
    console.log(`Catalogue ready: ${result.jobs} jobs; ${result.changed} changed; ${result.retired} retired.`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exitCode = 1; } }
