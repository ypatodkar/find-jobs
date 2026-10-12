const { storeFor } = require('./traces.cjs');
const { fail } = require('./catalogue.cjs');
const { match } = require('./matching.cjs');
function parseBody(raw) {
  if (Buffer.byteLength(raw || '') > 1048576) throw fail(413, 'Request is too large.');
  try { return JSON.parse(raw || '{}'); } catch { throw fail(400, 'Invalid JSON.'); }
}
async function route(catalogue, method, path, body, clientId, context = {}) {
  if (method === 'GET' && path === '/jobs/config') return { matching: Boolean(process.env.TYPESAFE_API_KEY) };
  if (method === 'POST' && path === '/jobs/search') return catalogue.search(body);
  if (method === 'POST' && path === '/jobs/history') return { jobs: await catalogue.history(body?.ids) };
  if (method === 'POST' && path === '/matches') return match(catalogue, body, clientId);

  // Observability. Read-only, and guarded by the same admin token as /counts: a trace
  // names the jobs a particular résumé was shown, which is nobody else's business.
  if (method === 'GET' && path.startsWith('/traces')) {
    // Same guard as /counts. A trace names the jobs one résumé was shown, so it is
    // the operator's data, not a visitor's.
    const token = context.token || null;
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      throw fail(401, 'Unauthorized.');
    }
    const query = context.query || {};
    const store = storeFor(catalogue);
    if (path === '/traces') {
      return { runs: await store.list(Math.min(200, Number(query?.limit) || 50),
        query?.before ? Number(query.before) : null) };
    }
    if (path === '/traces/stats') {
      const days = Math.min(90, Math.max(1, Number(query?.days) || 7));
      return { since: days, stats: await store.stats(Date.now() - days * 86400000) };
    }
    const run = await store.get(decodeURIComponent(path.slice('/traces/'.length)));
    if (!run) throw fail(404, 'No such run.');
    return run;
  }
  if (method === 'GET' && path.startsWith('/jobs/')) {
    let id;
    try { id = decodeURIComponent(path.slice(6)); } catch { throw fail(400, 'Invalid job.'); }
    if (id.length > 200) throw fail(400, 'Invalid job.');
    const job = await catalogue.get(id);
    if (!job) throw fail(404, 'This role is no longer available.');
    return { job };
  }
  throw fail(404, 'Not found.');
}
module.exports = { route, parseBody };
