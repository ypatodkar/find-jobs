const test = require('node:test');
const assert = require('node:assert/strict');
const { post, assess } = require('../shared/jev');

const secret = 'DO_NOT_LOG_API_KEY';
const body = { model: 'jev-1.13.0', state: { resume: 'DO_NOT_LOG_RESUME', job: 'DO_NOT_LOG_JOB' }, questions: { private: 'DO_NOT_LOG_PROMPT' } };
function capture(extra = {}) {
  const events = [];
  return { events, options: { apiKey: secret, requestId: 'test-request-123', log: line => events.push(JSON.parse(line)), ...extra } };
}
function checkPrivacy(events) {
  assert.doesNotMatch(JSON.stringify(events), /DO_NOT_LOG|Bearer|authorization|state|questions|answers/i);
  assert.ok(events.every(e => e.callId && e.requestId === 'test-request-123'));
}

test('successful requests log metadata, not prompts, keys or answers', async () => {
  const c = capture({ fetch: async () => new Response(JSON.stringify({ answers: 'DO_NOT_LOG_RESPONSE' })) });
  assert.deepEqual(await post(body, c.options), { answers: 'DO_NOT_LOG_RESPONSE' });
  assert.deepEqual(c.events.map(e => e.event), ['jev_attempt_started', 'jev_attempt_completed', 'jev_request_completed']);
  assert.equal(new Set(c.events.map(e => e.callId)).size, 1);
  assert.equal(c.events.at(-1).httpStatus, 200);
  assert.ok(c.events.at(-1).durationMs >= 0);
  checkPrivacy(c.events);
});

test('rate limiting logs retry and eventual success', async () => {
  let calls = 0;
  const c = capture({ fetch: async () => ++calls === 1 ? new Response('DO_NOT_LOG_ERROR', { status: 429, headers: { 'retry-after': '0' } }) : new Response('{}') });
  await post(body, c.options);
  const retry = c.events.find(e => e.event === 'jev_retry');
  assert.equal(retry.httpStatus, 429);
  assert.equal(retry.delayMs, 500);
  assert.equal(c.events.at(-1).attempts, 2);
  checkPrivacy(c.events);
});

test('HTTP failures log safe categories and preserve client status', async () => {
  for (const [httpStatus, status, category] of [[401,503,'authentication'], [403,503,'authentication'], [429,429,'rate_limit'], [529,503,'overloaded'], [500,502,'provider_http']]) {
    const c = capture({ fetch: async () => new Response('DO_NOT_LOG_ERROR', { status: httpStatus }) });
    await assert.rejects(post(body, c.options), e => e.status === status);
    assert.equal(c.events.at(-1).category, category);
    assert.equal(c.events.at(-1).httpStatus, httpStatus);
    assert.equal(c.events.at(-1).attempts, [429,529].includes(httpStatus) ? 2 : 1);
    checkPrivacy(c.events);
  }
});

test('timeouts and network errors never log exception messages', async () => {
  for (const [name, category] of [['TimeoutError','timeout'], ['AbortError','timeout'], ['TypeError','network']]) {
    const c = capture({ fetch: async () => { throw Object.assign(new Error('DO_NOT_LOG_RESUME'), { name }); } });
    await assert.rejects(post(body, c.options), e => e.status === 502);
    assert.equal(c.events.at(-1).category, category);
    assert.equal(c.events.at(-1).httpStatus, null);
    checkPrivacy(c.events);
  }
});

test('a failed retry does not report the previous attempt HTTP status', async () => {
  let calls = 0;
  const c = capture({ fetch: async () => {
    if (++calls === 1) return new Response('', { status: 429 });
    throw new TypeError('DO_NOT_LOG_NETWORK_DETAIL');
  } });
  await assert.rejects(post(body, c.options), e => e.status === 502);
  assert.equal(c.events.at(-1).attempts, 2);
  assert.equal(c.events.at(-1).httpStatus, null);
  assert.equal(c.events.at(-1).category, 'network');
  checkPrivacy(c.events);
});

test('malformed JSON is distinguishable from an invalid assessment', async () => {
  const c = capture({ fetch: async () => new Response('DO_NOT_LOG_INVALID_JSON') });
  await assert.rejects(post(body, c.options), /unreadable response/);
  assert.equal(c.events.at(-1).category, 'invalid_json');
  checkPrivacy(c.events);
  const a = capture({ fetch: async () => new Response(JSON.stringify({ answers: 'DO_NOT_LOG_RESPONSE' })) });
  await assert.rejects(assess('DO_NOT_LOG_RESUME: Built production services in Python.', { title: 'Engineer', html: '<h2>Requirements</h2><ul><li>Experience building production services in Python.</li></ul>' }, a.options), /unexpected model/);
  assert.equal(a.events.at(-1).event, 'jev_assessment_failed');
  assert.equal(a.events.at(-1).category, 'invalid_assessment');
  assert.equal(new Set(a.events.map(e => e.callId)).size, 1);
  checkPrivacy(a.events);
});

test('logging failure cannot fail an otherwise successful request', async () => {
  assert.deepEqual(await post(body, { apiKey: secret, fetch: async () => new Response('{}'), log: () => { throw new Error('broken logger'); } }), {});
});
