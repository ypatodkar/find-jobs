const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fixture } = require('./fixtures/catalogue');
const { MemoryCatalogue } = require('../aws/lambda/catalogue.cjs');
const { PostgresCatalogue } = require('../aws/lambda/catalogue-postgres.cjs');
const { importCatalogue } = require('../aws/lambda/catalogue-import.cjs');

test('Postgres catalogue integration', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const { Pool } = require('../aws/lambda/node_modules/pg');
  const schema = 'jobs_test_' + crypto.randomBytes(8).toString('hex');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}`, max: 4 });
  t.after(async () => { await pool.end(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); });
  await pool.query(fs.readFileSync(path.join(__dirname, '../aws/catalogue-schema.sql'), 'utf8'));
  const data = fixture(); const metadata = { firms: { accel: { status: 'ok' }, sequoia: { status: 'ok' } }, failures: [] };
  const store = new PostgresCatalogue(pool); const memory = new MemoryCatalogue(data);

  await t.test('imports once, updates changed content only, and rejects older snapshots', async () => {
    assert.equal((await importCatalogue(pool, data, metadata)).changed, 110);
    assert.equal((await importCatalogue(pool, data, metadata)).changed, 0);
    await assert.rejects(importCatalogue(pool, { ...data, scrapedAt: '2026-01-01' }, metadata), { status: 409 });
  });
  await t.test('SQL filtering, facets, pagination and grouping agree with local development', async () => {
    for (const query of [{}, { page: 2 }, { query: 'Backend' }, { selected: { city: ['Seattle'], company: ['Alpha'] } },
      { selected: { notcompany: ['Alpha'], industry: ['Developer Tools'], sponsorship: ['unknown'] } },
      { selected: { role: ['frontend'], firm: ['sequoia'], seniority: ['senior'], size: ['51-200'] } },
      { scopeFirm: 'accel', salary: '250' }, { hideOpenedCompanies: true, seenIds: ['job_99'] },
      { hideOpened: true, seenIds: ['job_99'] }, { query: "' OR 1=1 --" }, { page: 999 },
      ...['newest', 'oldest', 'count', 'title', 'company', 'salary'].flatMap(sort => [{ sort }, { sort, view: 'grouped' }])]) {
      const sql = await store.search(query), local = await memory.search(query);
      assert.equal(sql.total, local.total, JSON.stringify(query));
      assert.equal(sql.page, local.page);
      assert.deepEqual(sql.jobs.map(j => j.job_id), local.jobs.map(j => j.job_id), JSON.stringify(query));
      assert.deepEqual(sql.groups.map(g => [g.company, g.count]), local.groups.map(g => [g.company, g.count]));
      for (const key of Object.keys(local.facets)) assert.deepEqual(new Map(sql.facets[key]), new Map(local.facets[key]), key);
      assert.ok(!JSON.stringify(sql).includes('Five years'));
    }
  });
  await t.test('full-text shortlist, detail and legacy history are available without a full feed download', async () => {
    const candidate = await store.candidates({}, 'Python AWS PostgreSQL distributed systems', 10);
    assert.equal(candidate.jobs.length, 10); assert.equal(candidate.described, 110);
    assert.ok((await store.get('job_0')).description.includes('Python'));
    assert.equal((await store.history(['job_99'])).length, 1);
  });
  await t.test('database budget reservation is atomic across concurrent invocations', async () => {
    const reservations = await Promise.all(Array.from({ length: 10 }, () => store.quota('test', 3, 3600000)));
    assert.equal(reservations.filter(Boolean).length, 3);
    assert.equal(await store.quota('too-large', 3, 3600000, 4), false);
    await store.cacheSet('test', { score: 75 });
    assert.deepEqual(await store.cacheGet('test'), { score: 75 });
  });
  await t.test('failed sources preserve jobs; a later successful refresh retires them', async () => {
    const fewer = { ...data, scrapedAt: '2026-10-01T00:00:00Z', jobs: data.jobs.filter(j => j.job_id !== 'job_0') };
    assert.equal((await importCatalogue(pool, fewer, { ...metadata, failures: [{ company: 'Alpha' }] })).retired, 0);
    assert.equal((await importCatalogue(pool, fewer, { ...metadata, firms: { accel: { status: 'error' }, sequoia: { status: 'ok' } } })).retired, 0);
    assert.equal((await importCatalogue(pool, fewer, metadata)).retired, 1);
    assert.equal(await store.get('job_0'), null);
    assert.equal((await store.history(['job_0'])).length, 1);
  });
});
