const test = require('node:test');
const assert = require('node:assert/strict');

test('production proxy keeps static description shards on Pages and forwards authenticated writes', async () => {
  const worker = (await import('../deploy/pages-worker.mjs')).default;
  let assetPath, forwarded;
  const env = { ASSETS: { fetch: async request => { assetPath = new URL(request.url).pathname; return new Response('static'); } } };
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    forwarded = { url: String(url), init };
    return new Response(JSON.stringify({ ok: true }), { headers: { 'set-cookie': 'fj_session=token; Secure; HttpOnly', 'cache-control': 'no-store' } });
  };
  try {
    await worker.fetch(new Request('https://jobs.ypatodkar.com/api/desc/abc.json'), env);
    assert.equal(assetPath, '/api/desc/abc.json'); assert.equal(forwarded, undefined);
    const response = await worker.fetch(new Request('https://jobs.ypatodkar.com/api/sync/saved?test=1', {
      method: 'PUT', headers: { cookie: 'fj_session=token', 'content-type': 'application/json' }, body: '{"items":[]}',
    }), env);
    assert.ok(forwarded.url.endsWith('/api/sync/saved?test=1'));
    assert.equal(forwarded.init.method, 'PUT'); assert.equal(forwarded.init.headers.get('cookie'), 'fj_session=token');
    assert.equal(forwarded.init.headers.get('x-forwarded-proto'), 'https');
    assert.equal(await new Response(forwarded.init.body).text(), '{"items":[]}');
    assert.ok(response.headers.get('set-cookie').includes('HttpOnly'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    global.fetch = async () => { throw new Error('upstream unavailable'); };
    assert.equal((await worker.fetch(new Request('https://jobs.ypatodkar.com/api/resumes'), env)).status, 503);
  } finally { global.fetch = originalFetch; }
});
