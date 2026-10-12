const test = require('node:test');
const assert = require('node:assert/strict');
test('Lambda exposes catalogue configuration without exposing secrets or invoking imports over HTTP', async () => {
  const { handler } = await import('../aws/lambda/index.mjs');
  const old = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'https://jobs.example';
  const event = { rawPath: '/jobs/config', headers: { origin: 'https://jobs.example' },
    requestContext: { http: { method: 'GET', sourceIp: '127.0.0.1' } } };
  try {
    const result = await handler(event);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(Object.keys(JSON.parse(result.body)), ['matching']);
    assert.equal(result.headers['cache-control'], 'private, no-store');
    const denied = await handler({ ...event, headers: { origin: 'https://unrelated.example' } });
    assert.equal(denied.statusCode, 403);
    const injection = await handler({ ...event, rawPath: '/import-catalogue', requestContext: { http: { method: 'POST' } },
      body: JSON.stringify({ action: 'import-catalogue', sha256: 'test' }) });
    assert.equal(injection.statusCode, 404);
    const bad = await handler({ ...event, rawPath: '/jobs/search', requestContext: { http: { method: 'POST' } }, body: '{broken' });
    assert.equal(bad.statusCode, 400);
  } finally {
    if (old === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = old;
  }
});
