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
  // ---- the description pane -------------------------------------------------
  // Was a modal. A dialog cannot be linked to or opened in a tab, and it put a
  // 6,000-character posting in a scroll inside a scroll. This renders into a pane
  // that sits beside the list on wide screens and covers it on narrow ones, and
  // writes the open job into the URL so a role can be shared.
  const SPLIT = '(min-width: 1280px)';
  const wide = () => global.matchMedia && global.matchMedia(SPLIT).matches;
  let controller, lastOpener, openId = null;

  const pane = () => document.getElementById('job-detail');
  const paneInner = () => document.getElementById('job-detail-inner');

  function markSelected(id) {
    for (const row of document.querySelectorAll('.job.is-selected')) row.classList.remove('is-selected');
    if (!id) return;
    const row = document.querySelector(`.job[data-job-id="${CSS.escape(id)}"]`);
    if (row) row.classList.add('is-selected');
  }

  // The job id lives in the query string so the back button steps through what was
  // read, and a copied URL opens on the same posting.
  function syncUrl(id, replace) {
    const url = new URL(global.location.href);
    if (id) url.searchParams.set('job', id);
    else url.searchParams.delete('job');
    if (url.href === global.location.href) return;
    global.history[replace ? 'replaceState' : 'pushState']({ job: id || null }, '', url);
  }

  function closeDescription(restoreFocus) {
    controller?.abort();
    openId = null;
    markSelected(null);
    const el = pane();
    if (el) {
      el.classList.remove('is-open');
      const inner = paneInner();
      if (inner) inner.innerHTML = '<p class="job-detail-empty">Choose a role to read its description here.</p>';
    }
    document.body.classList.remove('detail-open');
    if (restoreFocus && lastOpener?.isConnected) lastOpener.focus();
  }

  async function description(id, opener, options = {}) {
    const el = pane();
    const inner = paneInner();
    if (!el || !inner) return;
    lastOpener = opener;
    openId = id;
    markSelected(id);
    if (!options.fromUrl) syncUrl(id, false);

    // On narrow screens the pane covers the list, so it needs a way back and must
    // not leave the list scrolling underneath it.
    if (!wide()) { el.classList.add('is-open'); document.body.classList.add('detail-open'); }

    controller?.abort(); controller = new AbortController();
    const current = controller;

    inner.innerHTML = `
      <button type="button" class="job-detail-back">← Back to results</button>
      <div class="job-detail-head">
        <p class="job-detail-eyebrow">Job description</p>
        <h2></h2>
        <p class="job-detail-meta"></p>
        <p class="job-detail-actions" hidden><a class="description-original" target="_blank" rel="noopener noreferrer">Open original posting ↗</a></p>
      </div>
      <div class="description-body" aria-busy="true"></div>`;
    const body = inner.querySelector('.description-body');
    const render = text => global.DescriptionFormat?.render
      ? global.DescriptionFormat.render(body, text)
      : body.replaceChildren(Object.assign(document.createElement('p'), { textContent: text }));
    render('Loading description…');
    if (!wide()) inner.scrollTop = 0; else el.scrollTop = 0;

    try {
      const { job } = await request('/jobs/' + encodeURIComponent(id), undefined, current.signal);
      if (current !== controller || openId !== id) return;
      inner.querySelector('.job-detail-head h2').textContent = job.title;
      inner.querySelector('.job-detail-meta').textContent =
        [job.company, job.city, job.remote && job.city !== 'Remote' ? 'Remote option' : null, job.salary].filter(Boolean).join(' · ');
      render(job.description || 'A full description is not available. Check the original posting.');
      body.removeAttribute('aria-busy');
      if (/^https?:\/\//i.test(job.url || '')) {
        const link = inner.querySelector('.description-original');
        link.href = job.url;
        link.dataset.jobId = job.job_id || id;
        link.dataset.company = job.company || '';
        link.dataset.city = job.city || '';
        link.dataset.title = job.title || '';
        inner.querySelector('.job-detail-actions').hidden = false;
      }
      inner.scrollTop = 0;
    } catch (error) {
      if (current === controller && openId === id && error.name !== 'AbortError') {
        render(error.message); body.removeAttribute('aria-busy');
      }
    }
  }

  // A plain click on a card previews it rather than leaving the page — the pattern
  // every job board uses. Modified clicks are left alone, so cmd-click and middle
  // click still open the posting in a tab, and the card stays a real link for
  // keyboard users and for "copy link address".
  //
  // Registered on the capture phase, and before track.js, which is what lets that
  // file treat a prevented click as "previewed, not opened" and leave the count
  // alone. track.js deliberately captures too, so that analytics cannot be stopped
  // by anything downstream — a bubble-phase listener here would run after it and
  // every preview would be counted as someone opening the posting.
  document.addEventListener('click', event => {
    if (!wide()) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const card = event.target.closest('a.job-card-open[data-job-id]');
    if (!card) return;
    const id = card.getAttribute('data-job-id');
    if (!id) return;
    event.preventDefault();
    description(id, card);
  }, true);

  document.addEventListener('click', event => {
    if (event.target.closest('.job-detail-back')) { closeDescription(true); syncUrl(null, false); }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openId && !wide()) { closeDescription(true); syncUrl(null, false); }
  });

  // Back and forward move between the postings that were opened.
  global.addEventListener('popstate', () => {
    const id = new URL(global.location.href).searchParams.get('job');
    if (id) description(id, null, { fromUrl: true });
    else closeDescription(false);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-description]');
    if (button) description(button.dataset.description, button);
  });

  // A URL carrying ?job=<id> opens straight onto that posting.
  function openFromUrl() {
    const id = new URL(global.location.href).searchParams.get('job');
    if (id) description(id, null, { fromUrl: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { history(); openFromUrl(); });
  else { history(); openFromUrl(); }
  global.JobsAPI = { request, search, remember, withHistory, description, closeDescription };
})(window);
