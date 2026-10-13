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

  // The id interpolated below can arrive from ?job= in the URL, so it is escaped
  // before it reaches innerHTML. Everything else in that template is static.
  const attr = v => String(v).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

  // The picker lists the résumés and is hidden when there is only one, because a
  // select with a single option is a control that cannot be used. It redraws on the
  // same event the zone does, so adding or renaming in one place shows in the other.
  function paintPicker(root) {
    const scope = root || document;
    const api = global.Resumes;
    for (const pick of scope.querySelectorAll('.job-score-pick')) {
      const select = pick.querySelector('.job-score-select');
      if (!api || !select) { pick.hidden = true; continue; }
      const { items, active } = api.list();
      pick.hidden = items.length < 2;
      if (items.length < 2) continue;
      select.replaceChildren();
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label || item.name || 'Résumé';
        option.selected = item.id === active;
        select.append(option);
      }
    }
  }
  document.addEventListener('resumes:changed', () => paintPicker());
  document.addEventListener('change', event => {
    const select = event.target.closest('.job-score-select');
    if (select) { global.Resumes?.select(select.value); return; }
    const add = event.target.closest('.job-score-add input[type="file"]');
    if (add && add.files && add.files[0]) { global.Resumes?.addFile(add.files[0]); add.value = ''; }
  });

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
        <p class="job-detail-actions" hidden><a class="description-original" target="_blank" rel="noopener noreferrer">View job <span aria-hidden="true">↗</span></a></p>
      </div>
      <div class="job-score" data-score-for="${attr(id)}">
        <div class="job-score-controls">
          <label class="job-score-pick" hidden><span class="visually-hidden">Résumé to score against</span><select class="job-score-select"></select></label>
          <label class="job-score-add" title="Add another résumé"><input type="file" accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"><span aria-hidden="true">+</span><span class="visually-hidden">Add another résumé</span></label>
          <button type="button" class="job-score-check" data-match="${attr(id)}">Check résumé score</button>
        </div>
        <div class="job-match-result" data-match-result="${attr(id)}"></div>
      </div>
      <div class="description-body" aria-busy="true"></div>`;
    const body = inner.querySelector('.description-body');
    paintPicker(inner);
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
    // Every width now: the row carries no buttons, so selecting it is the only way in
    // to the description, and on a phone the pane covers the list instead of sitting
    // beside it. The posting is reached from the panel's one primary action.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // "Open role" sits inside the card's action row; a click on it is a request for
    // the posting, not for a preview, so it is left to navigate.
    if (event.target.closest('a.job-open-role')) return;
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
    if (id) { description(id, null, { fromUrl: true }); return true; }
    return false;
  }

  // On a wide screen the pane is already on the page, so leaving it empty wastes the
  // half of the screen it occupies and leaves the layout looking unfinished. The first
  // result opens itself, which is what every list-detail product does — once, on the
  // first load only, so paging or filtering later does not keep spending a request on
  // a row nobody asked about.
  function openFirstOnce() {
    if (!wide() || openId) return;
    const row = document.querySelector('#job-list > .job[data-job-id]');
    const id = row && row.getAttribute('data-job-id');
    if (id) description(id, null, { fromUrl: true });
  }
  function awaitFirstPage() {
    const list = document.getElementById('job-list');
    if (!list) return;
    if (list.querySelector('.job[data-job-id]')) { openFirstOnce(); return; }
    const watch = new MutationObserver(() => {
      if (!list.querySelector('.job[data-job-id]')) return;
      watch.disconnect();
      openFirstOnce();
    });
    watch.observe(list, { childList: true, subtree: true });
    // Never leave an observer running on a page that failed to load any rows.
    setTimeout(() => watch.disconnect(), 30000);
  }
  const start = () => { history(); if (!openFromUrl()) awaitFirstPage(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
  global.JobsAPI = { request, search, remember, withHistory, description, closeDescription };
})(window);
