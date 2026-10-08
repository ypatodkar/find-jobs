const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryCatalogue, normalize, entries } = require('../aws/lambda/catalogue.cjs');
const { allJobsPayload, firmPayload } = require('../pipeline');
const { fixture } = require('./fixtures/catalogue');

test('pages return bounded summaries and disjoint stable rows even when timestamps tie', async () => {
  const catalogue = new MemoryCatalogue(fixture());
  const first = await catalogue.search({}); const second = await catalogue.search({ page: 2 });
  assert.equal(first.jobs.length, 45); assert.equal(second.jobs.length, 45);
  assert.equal(first.total, 110);
  assert.equal(new Set([...first.jobs, ...second.jobs].map(j => j.job_id)).size, 90);
  assert.ok(first.jobs.every(j => !Object.hasOwn(j, 'description') && j.hasDescription));
  assert.equal((await catalogue.search({ page: 999 })).page, 3);
  assert.ok((await catalogue.get(first.jobs[0].job_id)).description.includes('Python'));
});
test('facets cover the complete result set and omit only their own filter', async () => {
  const c = new MemoryCatalogue(fixture());
  const r = await c.search({ selected: { city: ['Seattle'], company: ['Alpha'] } });
  assert.equal(r.total, 19);
  assert.deepEqual(new Map(r.facets.city), new Map([['Seattle', 19], ['San Francisco', 18]]));
  assert.equal(new Map(r.facets.company).get('Beta'), 18);
  assert.equal((await c.search({ selected: { notcompany: ['Alpha'] } })).total, 73);
  assert.equal((await c.search({ scopeFirm: 'accel' })).total, 55);
});
test('company previews are bounded and counts include roles beyond the current page', async () => {
  const r = await new MemoryCatalogue(fixture()).search({ view: 'grouped', sort: 'company' });
  assert.equal(r.groups.length, 3); assert.equal(r.jobs.length, 0);
  assert.equal(r.groups[0].count, 37); assert.equal(r.groups[0].jobs.length, 3);
  assert.equal(r.groups.reduce((sum, g) => sum + g.count, 0), r.total);
});
test('opened-company filtering finds history outside the requested page', async () => {
  const c = new MemoryCatalogue(fixture());
  const r = await c.search({ hideOpenedCompanies: true, seenIds: ['job_99'] });
  assert.ok(r.jobs.every(j => j.company !== 'Alpha')); assert.equal(r.total, 73);
  assert.equal((await c.search({ hideOpened: true, seenIds: ['job_99'] })).total, 109);
});
test('descriptions stay out of legacy static feeds and remain in ingestion records', () => {
  const data = { scrapedAt: new Date().toISOString(), firms: { accel: { status: 'ok', jobs: fixture().jobs } } };
  assert.ok(allJobsPayload(data).jobs.every(j => !Object.hasOwn(j, 'description')));
  assert.ok(firmPayload(data, 'accel').jobs.every(j => !Object.hasOwn(j, 'description')));
  assert.ok(entries(allJobsPayload(data, { descriptions: true })).every(j => j.description));
});
test('invalid filters are rejected before querying and duplicate posting ids are merged', () => {
  assert.throws(() => normalize({ selected: { company: 'Alpha' } }), { status: 400 });
  assert.throws(() => normalize({ page: '1; DROP TABLE jobs' }), { status: 400 });
  const j = fixture().jobs[0];
  const rows = entries({ jobs: [j, { ...j, firms: ['sequoia'], posted: 'not-a-date' }] });
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.posted, null);
  assert.deepEqual(rows[0].payload.firms, ['accel', 'sequoia']);
});
