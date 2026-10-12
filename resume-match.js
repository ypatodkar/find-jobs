(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  if (!$('resume-form') || !window.JobsAPI) return;
  const fileInput = $('resume-file'), selected = $('resume-selected');
  const fileName = $('resume-file-name'), fileState = $('resume-file-state');
  const selectedIcon = selected.querySelector('.resume-selected-icon');
  const status = $('resume-status'), results = $('resume-results');
  const actions = document.querySelector('.resume-actions');
  const retry = $('resume-retry'), clear = $('resume-clear');
  const section = document.querySelector('.resume-match');
  const form = $('resume-form'), availability = $('resume-availability');
  const summaryNote = $('resume-summary-note'), actionLabel = $('resume-action-closed');
  const runSaved = $('resume-run'), forget = $('resume-forget');
  const fileBtn = $('resume-file-btn');

  // The résumé lives in this browser and nowhere else.
  //
  // Server-side storage was the other option and buys only cross-device use, at the
  // cost of holding a document full of names, addresses and employment history for
  // every visitor — and of reversing a promise this page makes a few lines above the
  // upload control. localStorage answers the actual complaint, which is being asked
  // for the same file on every visit.
  //
  // Scores are not stored here. The server already caches an assessment against a hash
  // of the résumé and the job, so re-running a comparison the same résumé has had
  // before costs nothing and returns immediately; duplicating that in the browser
  // would mean two caches to invalidate when the rubric changes.
  const STORE = 'find-jobs-resume';
  const store = {
    read() {
      try {
        const raw = localStorage.getItem(STORE);
        if (!raw) return null;
        const saved = JSON.parse(raw);
        return saved && typeof saved.text === 'string' && saved.text.length >= 100 ? saved : null;
      } catch { return null; }
    },
    write(text, name) {
      // Safari in private mode throws on write, and a browser that will not remember
      // the file is not a reason to refuse to compare it.
      try { localStorage.setItem(STORE, JSON.stringify({ text, name, at: Date.now() })); } catch {}
    },
    clear() { try { localStorage.removeItem(STORE); } catch {} },
  };

  let resumeText = '', controller, version = 0, comparedFilters = null;
  let matchingReady = false;
  const singleJobControllers = new Set();
  const node = (tag, text, cls) => {
    const el = document.createElement(tag); if (text != null) el.textContent = text;
    if (cls) el.className = cls; return el;
  };
  function invalidate() {
    version++; controller?.abort(); controller = null;
    for (const pending of singleJobControllers) pending.abort();
    singleJobControllers.clear();
    results.replaceChildren(); results.removeAttribute('aria-busy');
    document.querySelectorAll('[data-match-result]').forEach(slot => slot.replaceChildren());
    retry.disabled = false; retry.textContent = 'Compare current filters';
    retry.hidden = !resumeText; comparedFilters = null;
  }
  function disableMatching() {
    matchingReady = false;
    resumeText = '';
    invalidate();
    fileInput.value = '';
    fileInput.disabled = true;
    selected.hidden = true;
    runSaved.hidden = true; forget.hidden = true;
    actions.hidden = true;
    form.hidden = true;
    section.classList.add('is-unavailable');
    availability.hidden = false;
    availability.textContent = 'Résumé matching is unavailable right now. You can still search and filter jobs.';
    summaryNote.textContent = 'Résumé matching is unavailable right now.';
    actionLabel.textContent = 'View status';
    document.body.classList.remove('matching-ready');
    document.body.classList.remove('resume-has-file');
  }
  // One primary action at a time. With a résumé saved, matching is the obvious press
  // and uploading becomes the alternative; with none, uploading is the only thing to do.
  function showSaved() {
    const kept = matchingReady ? store.read() : null;
    runSaved.hidden = !kept;
    forget.hidden = !kept;
    if (fileBtn) fileBtn.textContent = kept ? 'Replace r\u00e9sum\u00e9' : 'Upload r\u00e9sum\u00e9';
    document.body.classList.toggle('resume-saved-ready', !!kept);
  }

  // One click, no file picker: the whole point of keeping it.
  runSaved.addEventListener('click', async () => {
    const kept = store.read();
    if (!kept) { showSaved(); return; }
    resumeText = kept.text;
    document.body.classList.add('resume-has-file');
    invalidate();
    selected.hidden = false;
    fileName.textContent = kept.name || 'Saved r\u00e9sum\u00e9';
    selected.dataset.state = 'ready'; selectedIcon.textContent = '\u2713';
    actions.hidden = false; clear.hidden = false;
    await compare();
  });

  forget.addEventListener('click', () => {
    store.clear();
    resumeText = '';
    document.body.classList.remove('resume-has-file');
    invalidate();
    showSaved(); selected.hidden = true; actions.hidden = true;
    status.textContent = 'Saved r\u00e9sum\u00e9 removed from this browser.';
  });

  // Keep the section visible while the service is checked. An unavailable service
  // removes the file control, but explains the state where people expect to find it.
  const configController = new AbortController();
  const configTimer = setTimeout(() => configController.abort(), 5000);
  JobsAPI.request('/jobs/config', undefined, configController.signal).then(config => {
    if (!config.matching) { disableMatching(); return; }
    matchingReady = true;
    section.classList.remove('is-unavailable');
    availability.hidden = true;
    form.hidden = false;
    fileInput.disabled = false;
    summaryNote.textContent = 'Choose a résumé file to compare it with jobs in your current filters.';
    actionLabel.textContent = 'Match my résumé';
    document.body.classList.add('matching-ready');
    // A résumé from a previous visit is offered rather than re-run: returning to the
    // page should not silently spend a provider call before anyone has asked for one.
    showSaved();
    if (store.read()) summaryNote.textContent = 'Your saved r\u00e9sum\u00e9 is ready \u2014 match it against your current filters.';
  }).catch(disableMatching).finally(() => clearTimeout(configTimer));
  function card({ job, assessment: a }) {
    const article = node('article', null, 'resume-result');
    const heading = node('div', null, 'resume-result-heading');
    const title = node('h3');
    if (/^https?:\/\//i.test(job.url || '')) {
      const link = node('a', job.title, 'job-title'); link.href = job.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.dataset.jobId = job.job_id; link.dataset.company = job.company; link.dataset.city = job.city || '';
      title.append(link);
    } else title.textContent = job.title;
    heading.append(title, node('span', `${a.score}/100 alignment`, 'resume-score'));
    article.append(heading, node('p', [job.company, job.city, job.salary].filter(Boolean).join(' · '), 'resume-meta'));
    const dimensions = node('dl', null, 'resume-dimensions');
    for (const d of a.dimensions) {
      const row = node('div'); row.append(node('dt', d.label), node('dd', `${d.score}/100${d.confidence < 0.5 ? ' · uncertain' : ''}`));
      dimensions.append(row);
    }
    article.append(dimensions);
    if (a.evidence?.text) article.append(node('p', 'Relevant résumé evidence', 'resume-evidence-label'), node('blockquote', a.evidence.text));
    if (a.gap?.text) article.append(node('p', 'Requirement to check against your experience', 'resume-evidence-label'), node('blockquote', a.gap.text));
    if (a.uncertain) article.append(node('p', 'The model is uncertain about part of this assessment. Review the description before relying on the score.', 'resume-note'));
    if (a.truncated) article.append(node('p', 'This long description was shortened for comparison; review the full posting.', 'resume-note'));
    const button = node('button', 'Read full description', 'job-description-link');
    button.type = 'button'; button.dataset.description = job.job_id; article.append(button);
    return article;
  }
  async function compare() {
    if (!matchingReady || !resumeText) return;
    controller?.abort(); controller = new AbortController();
    const requestController = controller;
    const current = ++version;
    const filters = window.JobView ? window.JobView.getFilters() : {};
    comparedFilters = JSON.stringify(filters);
    const timer = setTimeout(() => requestController.abort(), 60000);
    results.replaceChildren(); results.setAttribute('aria-busy', 'true');
    retry.hidden = false; retry.disabled = true; retry.textContent = 'Comparing descriptions…';
    fileState.textContent = 'Comparing with jobs in your current filters…';
    status.textContent = 'Finding relevant jobs and comparing up to 30 full descriptions. This may take a moment.';
    try {
      const data = await JobsAPI.request('/matches', { resume: resumeText, consent: true,
        filters: JobsAPI.withHistory(filters) }, requestController.signal);
      if (current !== version) return;
      JobsAPI.remember(data.matches.map(m => m.job));
      data.matches.forEach(m => results.append(card(m)));
      fileState.textContent = 'Comparison complete';
      const coverage = data.assessed ? `Compared ${data.assessed} shortlisted jobs from ${data.described.toLocaleString()} roles with descriptions (${data.total.toLocaleString()} roles match your filters).` : '';
      status.textContent = [coverage, data.message].filter(Boolean).join(' ');
      if (comparedFilters !== JSON.stringify(window.JobView?.getFilters() || {})) status.textContent += ' Your filters changed during this comparison. Run it again to use the current filters.';
    } catch (error) {
      if (current === version) {
        if (error.status === 503) { disableMatching(); return; }
        fileState.textContent = 'Comparison could not finish';
        status.textContent = error.name === 'AbortError' ? 'The comparison timed out. Please try again.' : error.message;
      }
    } finally {
      clearTimeout(timer);
      if (current === version) {
        controller = null;
        results.removeAttribute('aria-busy'); retry.disabled = false; retry.textContent = 'Compare current filters';
      }
    }
  }
  retry.addEventListener('click', compare);
  // Dropping a file hands it to the same input and fires the same change event, so
  // there is one read path rather than two that drift. A page-level dragover guard
  // stops the browser from navigating away when a file lands outside the zone —
  // which otherwise discards whatever the person was in the middle of.
  const dropZone = $('resume-drop');
  if (dropZone) {
    let depth = 0;
    const show = on => dropZone.classList.toggle('is-dragging', on);
    const carriesFile = e => [...(e.dataTransfer?.types || [])].includes('Files');
    for (const type of ['dragenter', 'dragover']) {
      dropZone.addEventListener(type, event => {
        if (!matchingReady || !carriesFile(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (type === 'dragenter') depth++;
        show(true);
      });
    }
    dropZone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; show(false); } });
    dropZone.addEventListener('drop', event => {
      if (!matchingReady || !carriesFile(event)) return;
      event.preventDefault();
      depth = 0; show(false);
      const file = event.dataTransfer.files[0];
      if (!file) return;
      const carrier = new DataTransfer();
      carrier.items.add(file);
      fileInput.files = carrier.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    for (const type of ['dragover', 'drop']) {
      window.addEventListener(type, event => {
        if (carriesFile(event) && !dropZone.contains(event.target)) event.preventDefault();
      });
    }
  }

  fileInput.addEventListener('change', async event => {
    if (!matchingReady) { event.target.value = ''; return; }
    const file = event.target.files[0]; if (!file) return;
    resumeText = '';
    document.body.classList.remove('resume-has-file');
    invalidate(); const current = version;
    selected.hidden = false; fileName.textContent = file.name;
    selected.dataset.state = 'reading'; selectedIcon.textContent = '…';
    fileState.textContent = 'Reading file…';
    actions.hidden = false; clear.hidden = false; retry.hidden = true;
    status.textContent = '';
    try {
      const text = (await window.ResumeImport.extract(file)).trim();
      if (current !== version) return;
      if (text.length < 100) throw new Error('This résumé has too little readable text. Choose a file with at least 100 characters.');
      if (new TextEncoder().encode(text).length > 16000) throw new Error('This résumé is over 16 KB of text. Choose a shorter version to compare.');
      resumeText = text;
      store.write(text, file.name);
      showSaved();
      document.body.classList.add('resume-has-file');
      selected.dataset.state = 'ready'; selectedIcon.textContent = '✓';
      // Deliberately does not compare here. Reading a file is not the same as asking
      // for 30 provider calls, and a picker that spends money the moment it closes
      // gives no chance to set filters first — which is what the comparison is scoped
      // to. showSaved() has already revealed the match button; pressing it is the ask.
      fileState.textContent = 'Ready \u00b7 open a role and press \u201cCheck r\u00e9sum\u00e9 score\u201d';
      status.textContent = '';
    } catch (err) {
      if (current !== version) return;
      // The specific reason goes in the zone, beside the control that caused it,
      // rather than on a line underneath where it reads as unrelated. Every failure
      // reachable here is a problem with the file — too short, too long, unreadable —
      // so the way out is choosing another one. A retry would fail identically, which
      // is why the guidance reserves retry for network and server errors.
      selected.dataset.state = 'error'; selectedIcon.textContent = '!';
      fileState.textContent = (err && err.message) || 'This file could not be read. Choose another résumé file.';
      status.textContent = '';
    } finally {
      event.target.value = '';
    }
  });
  // ---- one job at a time ----
  //
  // The shortlist answers "where do I fit?"; this answers "do I fit *this* one?", which
  // is the question someone actually has while reading a row. It is the same endpoint
  // and the same cache — a job_id instead of filters — so a row already compared in a
  // shortlist run comes back instantly and free.
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-match]');
    if (!button || !matchingReady) return;
    const jobId = button.getAttribute('data-match');
    const slot = document.querySelector(`[data-match-result="${CSS.escape(jobId)}"]`);
    if (!slot) return;

    const resume = resumeText;
    if (!resume) {
      slot.replaceChildren(node('p', 'Choose a r\u00e9sum\u00e9 file above to start matching jobs.', 'job-match-msg'));
      // Nothing to expand any more — the upload button is always on the page — so
      // take them to it and put the focus there. Scrolling the label rather than the
      // input, because the input itself is visually hidden behind it.
      ($('resume-file-btn') || fileInput).scrollIntoView({ behavior: 'smooth', block: 'center' });
      fileInput.focus({ preventScroll: true });
      return;
    }

    button.disabled = true;
    const label = button.textContent;
    button.textContent = 'Comparing\u2026';
    slot.replaceChildren(node('p', 'Comparing your r\u00e9sum\u00e9 with this description\u2026', 'job-match-msg'));
    const ctrl = new AbortController();
    const current = version;
    singleJobControllers.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const data = await JobsAPI.request('/matches',
        { resume, consent: true, job_id: jobId }, ctrl.signal);
      if (current !== version || ctrl.signal.aborted || !slot.isConnected) return;
      const match = data.matches && data.matches[0];
      if (!match) throw new Error(data.message || 'No assessment came back for this role.');
      slot.replaceChildren(card(match));
    } catch (error) {
      if (current !== version || !slot.isConnected) return;
      if (error.status === 503) { disableMatching(); return; }
      slot.replaceChildren(node('p',
        error.name === 'AbortError' ? 'That comparison timed out. Please try again.' : error.message,
        'job-match-msg'));
    } finally {
      clearTimeout(timer);
      singleJobControllers.delete(ctrl);
      button.disabled = false; button.textContent = label;
    }
  });

  clear.addEventListener('click', () => {
    resumeText = '';
    document.body.classList.remove('resume-has-file');
    invalidate(); fileInput.value = '';
    selected.hidden = true; selected.removeAttribute('data-state');
    fileName.textContent = ''; fileState.textContent = '';
    actions.hidden = true; clear.hidden = true; retry.hidden = true;
    status.textContent = 'Résumé and results removed from this page.';
  });
  window.JobView?.onChange(() => {
    if (results.children.length && comparedFilters !== JSON.stringify(window.JobView.getFilters())) {
      status.textContent = 'These matches use your previous filters. Select “Compare current filters” to run them again.';
    }
  });
})();
