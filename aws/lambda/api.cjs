const crypto = require('node:crypto');
if (process.env.AWS_LAMBDA_FUNCTION_NAME) require('node:dns').setDefaultResultOrder('ipv6first');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createAccountApi } = require('../../account-api.cjs');
const { shardOf } = require('../../description');

// Read the same published, sanitized description shards that the browser reads.
// A short cache bounds network work without retaining removed postings indefinitely.
const shards = new Map();
async function getDescription(jobId) {
  const shard = shardOf(jobId), now = Date.now();
  let entry = shards.get(shard);
  if (!entry || entry.until < now) {
    const origin = process.env.SITE_ORIGIN || 'https://jobs.ypatodkar.com';
    const response = await fetch(`${origin}/api/desc/${shard}.json`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Object.assign(new Error('The job description could not be loaded. Please try again shortly.'), { status: 503 });
    entry = { until: now + 120000, data: await response.json() };
    if (shards.size >= 64) shards.delete(shards.keys().next().value);
    shards.set(shard, entry);
  }
  const html = entry.data[jobId] || '';
  return { html, hash: html ? crypto.createHash('sha256').update(html).digest('hex').slice(0, 32) : null };
}
const api = createAccountApi({ getDescription });

function response(statusCode, body, extra = {}) {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra };
  const cookie = headers['set-cookie']; delete headers['set-cookie'];
  return { statusCode, headers, ...(cookie ? { cookies: [cookie] } : {}), body: JSON.stringify(body) };
}
async function handle(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  if (event.cookies?.length) headers.cookie = event.cookies.join('; ');
  const req = Readable.from(event.body ? [Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')] : []);
  req.method = event.requestContext?.http?.method || 'GET';
  req.headers = headers;
  const query = new URLSearchParams(event.rawQueryString || event.queryStringParameters || {});
  try {
    const [status, body, outHeaders] = await api.handle(req, event.rawPath.replace(/\.json$/, ''), query);
    return response(status, body, outHeaders);
  } catch (error) {
    if (!error.status) console.error('account API:', error.message);
    return response(error.status || 500, { error: error.status ? error.message : 'Something went wrong. Please try again.', ...(error.code ? { code: error.code } : {}), ...(error.usage ? { usage: error.usage } : {}) });
  }
}

// These actions require an IAM-authenticated Lambda invocation; Function URL
// requests always have requestContext and cannot call the migration or smoke check.
async function releaseAction(event, context) {
  if (context) context.callbackWaitsForEmptyEventLoop = false;
  if (event.requestContext) throw new Error('Release actions require an internal invocation.');
  if (event.releaseAction === 'migrate') {
    await api.migrate(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
    return { ok: true, migrated: true };
  }
  if (event.releaseAction === 'smoke') {
    await api.migrate('SELECT 1');
    const google = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
    if (!google.ok || !(await google.json()).keys?.length) throw new Error('Google key fetch failed.');
    const model = await fetch('https://api.typesafe.ai/v1/systemone', { signal: AbortSignal.timeout(10000) });
    if (model.status >= 500) throw new Error('Model API connectivity failed.');
    return { ok: true, database: true, google: true, modelReachable: true, authConfigured: !!process.env.GOOGLE_CLIENT_ID, modelConfigured: !!process.env.TYPESAFE_API_KEY };
  }
  throw new Error('Unknown release action.');
}
module.exports = { handle, releaseAction, close: () => api.close() };
