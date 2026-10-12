(function (global) {
  'use strict';
  const base = (global.JOBS_ENDPOINT || global.API_ENDPOINT || '').replace(/\/$/, '');
  let known = new Map(), snapshot = [];
  function remember(jobs) {
    for (const job of jobs) known.set(job.job_id, { ...known.get(job.job_id), ...job });
    snapshot = [...known.values()];
    if (global.Viewed) global.Viewed.refresh();
    if (global.JobsUI) global.JobsUI.refreshOpenedCounts();
  }
  global.JobsData = { all: () => snapshot };
  async function request(path, body, signal) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal, cache: 'no-store', credentials: 'omit',
    });
    let data;
    try { data = await response.json(); } catch { throw new Error('The job service returned an unreadable response. Please try again.'); }
    if (!response.ok) {
      const error = new Error(data.error || 'The job service is temporarily unavailable.');
      error.status = response.status;
      throw error;
    }
    return data;
  }
  function withHistory(filters) {
    return { ...filters, seenIds: (filters.hideOpened || filters.hideOpenedCompanies) && global.Seen?.ids ? global.Seen.ids() : [] };
  }
  async function search(filters, signal) {
    const data = await request('/jobs/search', withHistory(filters), signal);
    remember([...data.jobs, ...data.groups.flatMap(g => g.jobs)]);
    return data;
  }
  async function history() {
    const ids = global.Seen?.ids ? global.Seen.ids() : [];
    if (!ids.length) return;
    try { remember((await request('/jobs/history', { ids })).jobs); }
    catch { /* Browsing remains available if the history lookup is temporarily down. */ }
  }
  let dialog, controller, dialogOpener;
  async function description(id, opener) {
    dialogOpener = opener;
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.className = 'job-description-dialog';
      dialog.setAttribute('aria-labelledby', 'description-title');
      dialog.innerHTML = `
        <div class="description-shell">
          <header class="description-header">
            <div class="description-heading">
              <p class="description-kicker">Job description</p>
              <h2 id="description-title">Job description</h2>
              <p class="description-company"></p>
            </div>
            <form method="dialog"><button type="submit" class="description-close" aria-label="Close job description" title="Close">×</button></form>
          </header>
          <div class="description-scroll"><div class="description-body" aria-busy="true"></div></div>
          <footer class="description-footer" hidden>
            <p>For full details and to apply, visit the original posting.</p>
            <a class="description-original" target="_blank" rel="noopener noreferrer">Open original posting ↗</a>
          </footer>
        </div>`;
      document.body.append(dialog);
      dialog.addEventListener('close', () => { controller?.abort(); dialogOpener?.focus(); });
    }
    controller?.abort(); controller = new AbortController();
    const current = controller;
    const body = dialog.querySelector('.description-body');
    const render = text => global.DescriptionFormat?.render
      ? global.DescriptionFormat.render(body, text)
      : body.replaceChildren(Object.assign(document.createElement('p'), { textContent: text }));
    dialog.querySelector('#description-title').textContent = 'Job description';
    dialog.querySelector('.description-company').textContent = '';
    body.setAttribute('aria-busy', 'true'); render('Loading description…');
    dialog.querySelector('.description-footer').hidden = true;
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('.description-scroll').scrollTop = 0;
    try {
      const { job } = await request('/jobs/' + encodeURIComponent(id), undefined, current.signal);
      if (current !== controller || !dialog.open) return;
      dialog.querySelector('#description-title').textContent = job.title;
      dialog.querySelector('.description-company').textContent =
        [job.company, job.city, job.remote && job.city !== 'Remote' ? 'Remote option' : null, job.salary].filter(Boolean).join(' · ');
      render(job.description || 'A full description is not available. Check the original posting.');
      body.removeAttribute('aria-busy');
      const link = dialog.querySelector('.description-original');
      if (/^https?:\/\//i.test(job.url || '')) {
        link.href = job.url;
        link.dataset.jobId = job.job_id || id;
        link.dataset.company = job.company || '';
        link.dataset.city = job.city || '';
        link.dataset.title = job.title || '';
        dialog.querySelector('.description-footer').hidden = false;
      }
    } catch (error) {
      if (current === controller && dialog.open && error.name !== 'AbortError') {
        render(error.message); body.removeAttribute('aria-busy');
      }
    }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-description]');
    if (button) description(button.dataset.description, button);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', history);
  else history();
  global.JobsAPI = { request, search, remember, withHistory };
})(window);
