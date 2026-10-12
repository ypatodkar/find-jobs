// Real browser checks against an isolated local server and synthetic jobs.
// npm ci && npx playwright install chromium && npm run test:browser
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { createServer } = require('../server');
const { MemoryCatalogue } = require('../aws/lambda/catalogue.cjs');
const { fixture } = require('./fixtures/catalogue');
async function main() {
  const data = fixture();
  data.jobs[0].remote = true;
  data.jobs[1].city = 'Remote'; data.jobs[1].remote = true;
  const store = new MemoryCatalogue(data, { firms: { accel: { status: 'ok', host: 'example.com' } } });
  const server = createServer(async () => store);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
    // Keep the test entirely local, including analytics and image requests.
    await page.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
    const unavailableConfig = route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"matching":false}' });
    await page.route('**/api/jobs/config', unavailableConfig);
    await page.goto(base);
    await page.waitForFunction(() => document.getElementById('job-count').textContent.includes('110 open roles'));
    assert.equal(await page.locator('.resume-match').isVisible(), true);
    assert.ok((await page.locator('#resume-summary-note').textContent()).includes('unavailable'));
    assert.equal(await page.locator('#resume-form').isVisible(), false);
    assert.equal(await page.locator('.job-match-link:visible').count(), 0);
    await page.unroute('**/api/jobs/config', unavailableConfig);
    const oldApiConfig = route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' });
    await page.route('**/api/jobs/config', oldApiConfig);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('resume-summary-note').textContent.includes('unavailable'));
    assert.equal(await page.locator('.resume-match').isVisible(), true);
    assert.equal(await page.locator('#resume-form').isVisible(), false);
    await page.unroute('**/api/jobs/config', oldApiConfig);
    await page.route('**/api/jobs/config', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"matching":true}' }));
    await page.reload();
    await page.waitForFunction(() => document.getElementById('job-count').textContent.includes('110 open roles'));
    await page.locator('.resume-match').waitFor({ state: 'visible' });
    fs.mkdirSync('.catalogue', { recursive: true });
    await page.screenshot({ path: '.catalogue/top-desktop.png', fullPage: false });
    assert.equal(await page.locator('#job-list .job').count(), 45);
    assert.equal(await page.locator('#job-list .job-description-open[data-description]').count(), 45);
    const firstCard = page.locator('#job-list .job').first();
    assert.equal(await firstCard.locator('a.job-card-open').getAttribute('href'), data.jobs[0].url);
    assert.equal(await firstCard.locator('a.job-card-open').getAttribute('target'), '_blank');
    let popups = 0; page.on('popup', () => popups++);
    await firstCard.locator('a.job-card-open').click();
    await page.waitForFunction(() => document.querySelector('#job-detail .description-body')?.textContent.includes('Five years'));
    assert.equal(popups, 0, 'a plain card click previews rather than opening the posting');
    assert.ok(new URL(page.url()).searchParams.get('job'), 'the open job is in the URL so it can be shared');
    assert.equal(await page.locator('.job.is-selected').count(), 1);
    // track.js captures clicks, so the preview must cancel before it is counted.
    assert.equal(await page.evaluate(() => window.Seen.has('job_0')), false, 'previewing is not opening');
    await firstCard.locator('.job-description-open').click();
    await page.waitForFunction(() => document.querySelector('#job-detail .description-body')?.textContent.includes('Five years'));
    assert.equal(popups, 0);
    assert.equal(await page.evaluate(() => window.Seen.has('job_0')), false);
    await page.context().route('https://example.com/jobs/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Original posting</title>' }));
    // The posting is opened from the pane now, not by clicking the card — a plain
    // card click previews. A modified click still goes straight to the posting.
    const postingPromise = page.waitForEvent('popup');
    await page.locator('#job-detail .description-original').click();
    const posting = await postingPromise;
    await posting.waitForLoadState();
    assert.equal(posting.url(), data.jobs[0].url);
    assert.equal(await posting.title(), 'Original posting');
    assert.equal(await page.evaluate(() => window.Seen.has('job_0')), true);
    await posting.close();
    assert.equal(await page.locator('.job-match-link:visible').count(), 0);
    assert.equal(await page.locator('#job-list .job').first().locator('.job-work-mode').textContent(), 'Remote option');
    const remoteRow = page.locator('#job-list .job').filter({ hasText: 'Frontend Engineer 001' });
    assert.equal(await remoteRow.locator('.job-place').textContent(), 'Remote');
    assert.equal(await remoteRow.locator('.job-work-mode').textContent(), 'Remote');
    await page.evaluate(() => window.scrollTo(0, document.getElementById('job-list').getBoundingClientRect().top + window.scrollY - 40));
    await page.screenshot({ path: '.catalogue/list-desktop.png', fullPage: false });
    assert.ok(!requests.some(url => /all-jobs\.json|api\/firm\//.test(url)));
    const first = await page.locator('#job-list .job-title').first().textContent();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-current="page"]')?.textContent === '2');
    assert.notEqual(await page.locator('#job-list .job-title').first().textContent(), first);
    await page.goBack();
    await page.waitForFunction(() => document.querySelector('[aria-current="page"]')?.textContent === '1');
    await page.getByRole('searchbox', { name: 'Search roles', exact: true }).fill('Backend');
    await page.waitForFunction(() => document.getElementById('job-count').textContent.includes('55 matching roles'));
    await page.locator('#sum-city').click();
    await page.locator('#list-city input[type="checkbox"]').first().check();
    await page.locator('#sum-city').click();
    await page.getByRole('button', { name: /Company directory/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('#job-list .cgroup').length === 3);
    await page.locator('.cg-head').first().click();
    const groupedCard = page.locator('.cgroup.is-open .job').first();
    assert.match(await groupedCard.locator('a.job-card-open').getAttribute('href'), /^https:\/\/example\.com\/jobs\//);
    await groupedCard.locator('.job-description-open').click();
    await page.waitForFunction(() => document.querySelector('#job-detail .description-body')?.textContent.includes('Five years'));
    await page.locator('[data-company-more]').first().click();
    await page.waitForFunction(() => document.getElementById('job-count').textContent.includes('19 matching roles'));
    await page.locator('[data-description]').first().click();
    await page.waitForFunction(() => document.querySelector('#job-detail .description-body').textContent.includes('Five years'));
    assert.equal(await page.locator('#job-detail h2').textContent(), await page.locator('#job-list .job-title').first().textContent());
    assert.ok(await page.locator('.description-body p').count() > 0);
    assert.ok(await page.locator('.description-original').isVisible());
    const openedId = await page.locator('.description-original').getAttribute('data-job-id');
    await page.locator('.description-original').evaluate(link => link.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.evaluate(id => window.Seen.has(id), openedId), true);
    assert.equal(await page.locator(`.job[data-job-id="${openedId}"]`).first().evaluate(row => row.classList.contains('row-seen')), true);
    assert.equal(await page.locator('#advanced-filters').evaluate(el => el.open), false);
    await page.locator('#advanced-filters > summary').click();
    assert.ok(await page.locator('#sum-company').isVisible());
    await page.locator('#advanced-filters > summary').click();
    // One button, always on the page: there is no expander to open any more.
    assert.equal(await page.locator('#resume-file-btn').isVisible(), true);
    assert.equal(await page.locator('#resume-panel, #resume-text, #resume-consent').count(), 0);
    const resumeFile = page.locator('#resume-file');
    const resume = 'Built Python services on AWS and PostgreSQL for six years. Owned distributed systems and mentored four engineers. Delivered production deployments and monitoring.';
    const updatedResume = 'Built Python services on AWS and PostgreSQL for seven years. Owned distributed systems and mentored four engineers. Delivered production deployments and monitoring.';
    // A provider outage must be explicit, without fabricated successful matches.
    const sent = [];
    await page.route('**/api/matches', route => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Comparison service is temporarily unavailable.' }) });
    });
    await resumeFile.setInputFiles({ name: 'short.txt', mimeType: 'text/plain', buffer: Buffer.from('Too short') });
    await page.waitForFunction(() => document.getElementById('resume-file-state').textContent.includes('at least 100 characters'));
    assert.equal(sent.length, 0);
    await resumeFile.setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from(resume) });
    // Choosing a file no longer starts a comparison; it has to be asked for.
    await page.waitForFunction(() => document.getElementById('resume-file-state').textContent.includes('press'));
    assert.equal(sent.length, 0, 'no provider call before the button is pressed');
    await page.locator('#resume-run').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.getElementById('resume-status').textContent.includes('temporarily unavailable'));
    assert.equal(await page.locator('#resume-file-name').textContent(), 'resume.txt');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].resume, resume);
    assert.equal(sent[0].consent, true);
    assert.equal(await page.locator('.resume-result').count(), 0);
    // Exercise presentation with a clearly synthetic, test-only assessment.
    const job = data.jobs[0];
    const successful = [];
    await page.route('**/api/matches', route => {
      const body = route.request().postDataJSON();
      successful.push(body);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        matches: [{ job, assessment: { score: 75, dimensions: [{ key: 'skills', label: 'Technical skills', score: 75, confidence: .8 }],
          evidence: { text: body.resume.split('.')[0] + '.' }, gap: null, uncertain: false } }],
        total: 19, described: 19, assessed: 1, failed: 0,
      }) });
    });
    const requestBodies = [];
    page.on('request', r => { const d = r.postData(); if (d) requestBodies.push(d); });
    await page.locator('#resume-retry').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForSelector('.resume-result');
    assert.ok((await page.locator('.resume-score').textContent()).includes('75/100'));
    // The résumé is now deliberately kept, so returning visitors are not asked for the
    // same file again. This assertion inverted when that was asked for; what it still
    // guards is *where*. localStorage is this browser and nobody else's — the promise
    // beside the upload control says exactly that, and the server stores nothing.
    const stored = await page.evaluate(() => JSON.stringify(localStorage));
    assert.ok(stored.includes('Built Python'), 'résumé should be kept in this browser');
    assert.ok(stored.includes('find-jobs-resume'), 'kept under its own key');
    // Nothing in the request path asks the server to retain it: the only time the text
    // leaves the browser is the consented comparison call, which stores a hash.
    const sentBodies = requestBodies.filter(b => b.includes('Built Python'));
    assert.ok(sentBodies.every(b => !/\bstore\b|\bpersist\b|\bsave\b/.test(b)),
      'résumé is sent for comparison only, never with a store instruction');
    // The score is asked for and answered in the description pane, not on the row.
    assert.equal(await page.locator('#job-list [data-match]').count(), 0);
    await page.locator('#job-list .job-card-open').first().click();
    await page.waitForFunction(() => document.querySelector('#job-detail .description-body')?.textContent.includes('Five years'));
    const matchButton = page.locator('#job-detail .job-score-check');
    await matchButton.click();
    await page.waitForSelector('#job-detail [data-match-result] .resume-result');
    await resumeFile.setInputFiles({ name: 'updated.txt', mimeType: 'text/plain', buffer: Buffer.from(updatedResume) });
    await page.waitForFunction(() => document.getElementById('resume-file-state').textContent.includes('press'));
    await page.locator('#resume-run').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.waitForFunction(() => document.getElementById('resume-file-state').textContent === 'Comparison complete');
    assert.equal(successful.at(-1).resume, updatedResume);
    assert.equal(await page.locator('#job-detail [data-match-result] .resume-result').count(), 0);
    assert.ok((await page.locator('#resume-results .resume-result blockquote').textContent()).includes('seven years'));
    await matchButton.click();
    await page.waitForSelector('#job-detail [data-match-result] .resume-result');
    await page.locator('#resume-clear').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.locator('#resume-selected').isVisible(), false);
    assert.equal(await page.locator('.resume-result').count(), 0);
    assert.equal(await page.locator('.job-match-link:visible').count(), 0);
    fs.mkdirSync('.catalogue', { recursive: true });
    await page.screenshot({ path: '.catalogue/desktop.png', fullPage: false });
    await page.route('**/api/matches', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Resume matching is not configured yet. Job browsing is available.' }) }));
    await resumeFile.setInputFiles({ name: 'resume.txt', mimeType: 'text/plain', buffer: Buffer.from(resume) });
    // The 503 is only discovered when a comparison is actually requested.
    await page.locator('#resume-run').evaluate(el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await page.locator('#resume-form').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.resume-match').isVisible(), true);
    assert.ok((await page.locator('#resume-summary-note').textContent()).includes('unavailable'));
    assert.equal(await page.locator('.job-match-link:visible').count(), 0);
    assert.equal(await page.locator('#resume-selected').isVisible(), false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base);
    await page.waitForFunction(() => /open roles/.test(document.getElementById('job-count').textContent));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.ok(await page.locator('#mobile-job-search').isVisible());
    await page.locator('#mobile-job-search').fill('Frontend');
    await page.waitForFunction(() => document.getElementById('job-count').textContent.includes('55 matching roles'));
    await page.screenshot({ path: '.catalogue/mobile.png', fullPage: false });
    await page.evaluate(() => window.scrollTo(0, document.getElementById('job-list').getBoundingClientRect().top + window.scrollY - 40));
    await page.screenshot({ path: '.catalogue/list-mobile.png', fullPage: false });
    await page.goto(base + '/?company=Alpha');
    await page.waitForFunction(() => document.getElementById('job-count').textContent.includes('matching roles'));
    assert.equal(await page.locator('#advanced-filters').evaluate(el => el.open), true);
    assert.ok((await page.locator('#advanced-filter-count').textContent()).includes('1 active'));
    await page.goto(base + '/firm.html?id=accel');
    await page.waitForFunction(() => document.getElementById('firm-stats').textContent.includes('55 matching roles'));
    assert.equal(await page.locator('#job-list .job').count(), 45);
    assert.deepEqual(errors, []);
    console.log('Browser checks passed: paging, URL history, filters, company previews, descriptions, résumé states, mobile layout, and investor pages.');
  } finally {
    await browser?.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
