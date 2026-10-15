// Real Postgres + HTTP checks in an isolated temporary cluster; no model calls.
// Requires local initdb/pg_ctl binaries. Always shuts down the app and database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createStore, poolFromEnv } = require('../aws/lambda/match-store.cjs');
const { RUBRIC_VERSION } = require('../jev');
const root = path.resolve(__dirname, '..');

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message || result.stderr || result.stdout}`);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'findjobs-feedback-'));
  const data = path.join(dir, 'data');
  let started = false, pool, app;
  try {
    const dbPort = await freePort();
    run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${dbPort} -k ${dir}`, '-w', 'start']);
    started = true;
    const env = { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(dbPort), PGDATABASE: 'postgres', PGUSER: 'postgres', PGPASSWORD: '', PGSSL: 'off' };
    pool = poolFromEnv(env);
    await pool.query(fs.readFileSync(path.join(root, 'aws/schema.sql'), 'utf8'));
    // Applying the additive migration twice must be safe on an existing install.
    const migration = fs.readFileSync(path.join(root, 'aws/migrations/001-analysis-feedback.sql'), 'utf8');
    await pool.query(migration); await pool.query(migration);
    const now = Date.now(), resume = 'r_abcdefghijklmnop';
    for (const account of ['owner', 'other']) {
      await pool.query('INSERT INTO accounts (id, google_sub, email, created_at, last_login_at) VALUES ($1,$1,$2,$3,$3)', [account, `${account}@example.invalid`, now]);
      await pool.query('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES ($1,$2,$3,$4)', [crypto.createHash('sha256').update(`${account}-feedback-test-session-token`).digest('hex'), account, now, now + 60000]);
    }
    await pool.query('INSERT INTO resumes (id, account_id, visitor_id, label, body, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [resume, 'owner', '', 'Test resume', 'Fixture only. '.repeat(20), now]);
    const store = createStore(pool);
    const original = await store.saveMatch(resume, 'fixture_job', { score: 76, model: 'test-model', rubricVersion: RUBRIC_VERSION, findings: [{ text: 'Test requirement', status: 'shown', evidence: 'Test excerpt' }] }, 'fixture-hash');

    const appPort = await freePort();
    app = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...env, PORT: String(appPort), HOST: '127.0.0.1', GOOGLE_CLIENT_ID: 'test-client' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    app.stdout.on('data', chunk => { output += chunk; });
    app.stderr.on('data', chunk => { output += chunk; });
    const base = `http://127.0.0.1:${appPort}`;
    for (let i = 0; i < 100; i++) {
      if (app.exitCode !== null) throw new Error(output);
      try { if ((await fetch(base + '/api/auth/config')).ok) break; } catch { /* starting */ }
      if (i === 99) throw new Error('Test app did not start: ' + output);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const body = { resume_id: resume, job_id: 'fixture_job', checked_at: original.checkedAt, rating: 'up' };
    async function review(payload = body, account = 'owner', type = 'application/json') {
      const response = await fetch(base + '/api/match/feedback', { method: 'POST', headers: { 'content-type': type, ...(account ? { cookie: `fj_session=${account}-feedback-test-session-token` } : {}) }, body: JSON.stringify(payload) });
      return { status: response.status, body: await response.json() };
    }
    assert.equal((await review(body, null)).status, 401, 'signed-out feedback is rejected');
    assert.equal((await review(body, 'other')).status, 409, 'another account cannot review the resume');
    for (const payload of [null, {}, { ...body, rating: 'invalid' }, { ...body, checked_at: String(original.checkedAt) }, { ...body, checked_at: -1 }, { ...body, job_id: '' }]) {
      assert.equal((await review(payload)).status, 400, 'malformed feedback is rejected');
    }
    assert.equal((await review(body, 'owner', 'text/plain')).status, 415);
    assert.equal((await review({ ...body, checked_at: original.checkedAt - 1 })).status, 409, 'stale feedback is rejected');
    assert.equal((await review()).body.feedback.rating, 'up');
    assert.equal((await review({ ...body, rating: 'down' })).body.feedback.rating, 'down');
    assert.equal((await review({ ...body, rating: 'down' })).status, 200, 'retries are idempotent');
    let saved = (await pool.query('SELECT * FROM resume_match_feedback')).rows;
    assert.equal(saved.length, 1, 'changing a vote does not inflate review counts');
    assert.equal(saved[0].account_id, 'owner');
    assert.equal(saved[0].rating, 'down');
    assert.equal(saved[0].score, 76);
    assert.equal(saved[0].desc_hash, 'fixture-hash');
    assert.deepEqual(saved[0].result, { score: 76, model: 'test-model', rubricVersion: RUBRIC_VERSION, findings: [{ text: 'Test requirement', status: 'shown', evidence: 'Test excerpt' }] });
    const get = async () => (await fetch(base + `/api/match?resume=${resume}&job=fixture_job`, { headers: { cookie: 'fj_session=owner-feedback-test-session-token' } })).json();
    assert.equal((await get()).match.feedback.rating, 'down', 'feedback is returned with a saved analysis');
    assert.equal((await store.getMatch('other', resume, 'fixture_job')), null, 'feedback cannot leak through another account');
    const next = await store.saveMatch(resume, 'fixture_job', { score: 80, model: 'test-model', rubricVersion: RUBRIC_VERSION, findings: [] }, 'new-hash');
    assert.equal(next.feedback, null);
    assert.equal((await get()).match.feedback, null, 'a new analysis starts unrated');
    assert.equal((await review(body)).status, 409, 'a superseded analysis cannot be rated');
    assert.equal((await review({ ...body, checked_at: next.checkedAt })).status, 200);
    saved = (await pool.query('SELECT * FROM resume_match_feedback ORDER BY analysis_checked_at')).rows;
    assert.equal(saved.length, 2, 'historical reviews remain tied to their analysis version');
    assert.equal(saved[0].result.score, 76);
    assert.equal(saved[1].result.score, 80);
    // Exercise the production Function URL adapter against the same real database.
    Object.assign(process.env, env, { GOOGLE_CLIENT_ID: 'test-client' });
    const lambda = require('../aws/lambda/api.cjs');
    const context = {};
    const invoke = (rawPath, method = 'GET', payload, cookie = 'fj_session=owner-feedback-test-session-token') => lambda.handle({
      rawPath, requestContext: { http: { method } }, headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
      cookies: cookie ? [cookie] : [], body: payload === undefined ? undefined : JSON.stringify(payload),
    }, context);
    try {
      assert.equal(JSON.parse((await invoke('/api/auth/config')).body).clientId, 'test-client');
      assert.equal((await invoke('/api/resumes', 'GET', undefined, null)).statusCode, 401);
      assert.equal((await invoke('/api/resumes', 'GET', undefined, 'fj_session=%broken')).statusCode, 401);
      const list = JSON.parse((await invoke('/api/resumes')).body).resumes;
      assert.equal(list.length, 1); assert.equal(list[0].id, resume);
      assert.equal(context.callbackWaitsForEmptyEventLoop, false);
      const voted = await invoke('/api/match/feedback', 'POST', { ...body, checked_at: next.checkedAt, rating: 'down' });
      assert.equal(voted.statusCode, 200); assert.equal(JSON.parse(voted.body).feedback.rating, 'down');
      assert.equal((await lambda.releaseAction({ releaseAction: 'migrate' }, context)).ok, true);
      await assert.rejects(lambda.releaseAction({ releaseAction: 'migrate', requestContext: {} }, context), /internal invocation/);
      const logout = await invoke('/api/auth/logout', 'POST', {});
      assert.equal(logout.statusCode, 200); assert.ok(logout.cookies[0].includes('HttpOnly; SameSite=Lax; Max-Age=0; Secure'));
      assert.equal((await invoke('/api/resumes')).statusCode, 401);
    } finally { await lambda.close(); }
    console.log('Analysis feedback passed: real Postgres persistence, API auth/validation, deduplication, change vote, saved result readback, and analysis version isolation.');
  } finally {
    if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill('SIGTERM'); await exited; }
    await pool?.end();
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
