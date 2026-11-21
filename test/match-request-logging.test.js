const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('analysis requests log status and correlation even before Jev runs', async () => {
  for (const status of [200, 401, 429, 503]) {
    const logs = [];
    let received;
    const sandbox = {
      require: name => name === './account-api.cjs' ? { createAccountApi: () => ({ handle: async req => {
        received = req;
        if (status !== 200) throw Object.assign(new Error('safe user-facing failure'), { status });
        return [200, { score: 50 }];
      } }) } : name === '../../shared/description' ? { shardOf: () => '000' } : require(name),
      process, Buffer, URLSearchParams, module: { exports: {} },
      console: { info: line => logs.push(JSON.parse(line)), error: () => {} },
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../aws/lambda/api.cjs'), 'utf8'), sandbox);
    const response = await sandbox.module.exports.handle({ rawPath: '/api/match', requestContext: { http: { method: 'POST' } }, body: 'DO_NOT_LOG_RESUME', headers: { cookie: 'DO_NOT_LOG_COOKIE' } }, { awsRequestId: 'lambda-request-123' });
    assert.equal(response.statusCode, status);
    assert.equal(received.requestId, 'lambda-request-123');
    assert.equal(logs.length, 1);
    assert.equal(logs[0].requestId, 'lambda-request-123');
    assert.equal(logs[0].status, status);
    assert.equal(logs[0].outcome, status === 200 ? 'success' : 'error');
    assert.doesNotMatch(JSON.stringify(logs), /DO_NOT_LOG/);
  }
});
