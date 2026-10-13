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

  // A collection, not a file. Someone applying to two kinds of job has two résumés and
  // wants to know how each one reads against a role — storing one meant re-uploading
  // every time they switched, which is the same complaint saving solved in the first
  // place.
  //
  // Shape: { v: 2, active: <id>, items: [{ id, label, name, text, at }] }. The old
  // single-file shape is migrated on first read rather than discarded, because the
  // résumé already saved is the one the visitor would be most annoyed to lose. `name`
  // is the file it came from and never changes; `label` is what they call it and does.
  const store = {
    read() {
      try {
        const raw = localStorage.getItem(STORE);
        if (!raw) return { items: [], active: null };
        const saved = JSON.parse(raw);
        if (saved && saved.v === 2 && Array.isArray(saved.items)) {
          const items = saved.items.filter(r => r && typeof r.text === 'string' && r.text.length >= 100 && r.id);
          const active = items.some(r => r.id === saved.active) ? saved.active : (items[0]?.id || null);
          return { items, active };
        }
        // v1: one résumé, no label. Its filename becomes its label.
        if (saved && typeof saved.text === 'string' && saved.text.length >= 100) {
          const item = { id: 'r1', label: saved.name || 'My résumé', name: saved.name || '', text: saved.text, at: saved.at || Date.now() };
          const next = { items: [item], active: item.id };
          store.save(next);
          return next;
        }
      } catch { /* unreadable storage is the same as none */ }
      return { items: [], active: null };
    },
    save(state) {
      // Safari in private mode throws on write, and a browser that will not remember
      // the file is not a reason to refuse to compare it.
      try { localStorage.setItem(STORE, JSON.stringify({ v: 2, active: state.active, items: state.items })); } catch {}
    },
    add(text, name) {
      const state = store.read();
      const id = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      // The first one is not named: there is nothing to tell it apart from, and asking
      // for a label before there is a choice to make is a question with no purpose.
      const label = state.items.length === 0 ? (name || 'My résumé') : (name || 'Résumé ' + (state.items.length + 1));
      state.items.push({ id, label, name: name || '', text, at: Date.now() });
      state.active = id;
      store.save(state);
      return { state, id, isFirst: state.items.length === 1 };
    },
    rename(id, label) {
      const state = store.read();
      const item = state.items.find(r => r.id === id);
      if (!item) return state;
      item.label = String(label || '').trim().slice(0, 60) || item.label;
      store.save(state);
      return state;
    },
    remove(id) {
      const state = store.read();
      state.items = state.items.filter(r => r.id !== id);
      if (state.active === id) state.active = state.items[0]?.id || null;
      store.save(state);
      return state;
    },
    select(id) {
      const state = store.read();
      if (state.items.some(r => r.id === id)) { state.active = id; store.save(state); }
      return state;
    },
    activeItem() {
      const state = store.read();
      return state.items.find(r => r.id === state.active) || null;
    },
    clear() { try { localStorage.removeItem(STORE); } catch {} },
  };

  // Anything showing the list — the zone, and the picker in each description pane —
  // redraws from one event rather than each keeping its own copy to fall behind.
  const announce = () => { document.dispatchEvent(new CustomEvent('resumes:changed')); paintChip(); };

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
    // The chip offers a feature that has just stopped existing, so it goes with it.
    paintChip();
    if (region) region.hidden = true;
  }
  // The pane draws its own picker and needs the list; it does not need the storage,
  // so only these four things cross the boundary.
  window.Resumes = {
    list: () => store.read(),
    select: id => { store.select(id); const c = store.activeItem(); if (c) { resumeText = c.text; fileName.textContent = c.label || c.name; invalidate(); } renderList(); announce(); },
    active: () => store.activeItem(),
    addFile: file => { if (fileInput) { const dt = new DataTransfer(); dt.items.add(file); fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change', { bubbles: true })); } },
  };

  // ---- the status chip -------------------------------------------------------
  // Uploading a résumé is a thing you do once; browsing jobs is why you came. The
  // panel is kept behind a status line in the masthead so the document step stops
  // taking the top of the page from the list it is meant to help you read.
  const chip = $('resume-status-chip');
  const chipText = $('resume-chip-text');
  const manage = $('resume-manage');
  const region = $('resume-panel-region');

  function paintChip() {
    if (!chip) return;
    const { items } = matchingReady ? store.read() : { items: [] };
    chip.hidden = !matchingReady;
    if (!chipText) return;
    chipText.textContent = items.length === 0 ? 'No résumé'
      : items.length === 1 ? 'Résumé ready'
      : items.length + ' résumés';
    if (manage) manage.textContent = items.length === 0 ? 'Add' : 'Manage';
  }

  function togglePanel(open) {
    if (!region) return;
    const next = open === undefined ? region.hidden : open;
    region.hidden = !next;
    if (manage) manage.setAttribute('aria-expanded', String(next));
    if (next) {
      region.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const target = $('resume-file-btn');
      if (target) target.focus({ preventScroll: true });
    }
  }
  manage?.addEventListener('click', () => togglePanel());

  // Asking for a score without a résumé opens the panel rather than scrolling to a
  // block that is no longer on the page.
  document.addEventListener('resumes:needed', () => togglePanel(true));

  // ---- the collection -------------------------------------------------------
  // A list of one is not a choice, so it only appears from the second résumé on.
  // Naming works the same way: the first file is never asked for a label, because
  // there is nothing to tell it apart from. Adding a second is what makes both
  // ambiguous, so that is when both are asked for at once.
  const listEl = $('resume-list');
  let naming = false;

  function renderList() {
    if (!listEl) return;
    const { items, active } = store.read();
    listEl.replaceChildren();
    listEl.hidden = items.length < 2;
    if (items.length < 2) { naming = false; return; }

    if (naming) {
      listEl.append(node('p', 'Name your résumés so you can tell them apart.', 'resume-list-hint'));
    }
    for (const item of items) {
      const row = node('div', null, 'resume-row');
      row.dataset.id = item.id;
      if (item.id === active) row.classList.add('is-active');

      const pick = document.createElement('input');
      pick.type = 'radio'; pick.name = 'resume-pick'; pick.value = item.id;
      pick.checked = item.id === active;
      pick.className = 'resume-row-pick';
      pick.setAttribute('aria-label', 'Use ' + (item.label || item.name));
      row.append(pick);

      if (naming) {
        const input = document.createElement('input');
        input.type = 'text'; input.value = item.label || item.name || '';
        input.className = 'resume-row-name'; input.maxLength = 60;
        input.setAttribute('aria-label', 'Name for ' + (item.name || 'this résumé'));
        input.dataset.nameFor = item.id;
        row.append(input);
      } else {
        const copy = node('span', null, 'resume-row-copy');
        copy.append(node('strong', item.label || item.name || 'Résumé'));
        if (item.name && item.name !== item.label) copy.append(node('span', item.name, 'resume-row-file'));
        row.append(copy);
      }

      const remove = node('button', 'Remove', 'resume-row-remove');
      remove.type = 'button'; remove.dataset.removeResume = item.id;
      remove.setAttribute('aria-label', 'Remove ' + (item.label || item.name));
      row.append(remove);
      listEl.append(row);
    }
    if (naming) {
      const done = node('button', 'Save names', 'resume-names-done');
      done.type = 'button'; done.id = 'resume-names-done';
      listEl.append(done);
    } else {
      // The guidance the single-résumé status line carried, kept here because that
      // line is hidden once the list is doing the same job better.
      listEl.append(node('p', 'Open a role and press \u201cCheck r\u00e9sum\u00e9 score\u201d to use the selected r\u00e9sum\u00e9.', 'resume-list-hint resume-list-foot'));
    }
  }

  function promptLabels(newId) {
    naming = true;
    renderList();
    const input = listEl && listEl.querySelector('[data-name-for="' + newId + '"]');
    if (input) { input.focus(); input.select(); }
  }

  function commitNames() {
    if (!listEl) return;
    for (const input of listEl.querySelectorAll('[data-name-for]')) {
      store.rename(input.dataset.nameFor, input.value);
    }
    naming = false;
    renderList();
    announce();
    const current = store.activeItem();
    if (current) fileName.textContent = current.label || current.name;
  }

  listEl?.addEventListener('change', event => {
    const pick = event.target.closest('.resume-row-pick');
    if (!pick) return;
    store.select(pick.value);
    const current = store.activeItem();
    if (current) {
      resumeText = current.text;
      fileName.textContent = current.label || current.name;
      fileState.textContent = 'Ready \u00b7 open a role and press \u201cCheck r\u00e9sum\u00e9 score\u201d';
      invalidate();
    }
    renderList(); announce();
  });

  listEl?.addEventListener('click', event => {
    if (event.target.closest('#resume-names-done')) { commitNames(); return; }
    const remove = event.target.closest('[data-remove-resume]');
    if (!remove) return;
    store.remove(remove.dataset.removeResume);
    const next = store.activeItem();
    resumeText = next ? next.text : '';
    if (!next) { document.body.classList.remove('resume-has-file'); selected.hidden = true; }
    else fileName.textContent = next.label || next.name;
    invalidate(); showSaved(); renderList(); announce();
  });

  listEl?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-name-for]')) { event.preventDefault(); commitNames(); }
  });

  // One primary action at a time. With a résumé saved, matching is the obvious press
  // and uploading becomes the alternative; with none, uploading is the only thing to do.
  function showSaved() {
    const kept = matchingReady ? store.activeItem() : null;
    runSaved.hidden = !kept;
    forget.hidden = !kept;
    const count = matchingReady ? store.read().items.length : 0;
    if (fileBtn) fileBtn.textContent = count === 0 ? 'Upload r\u00e9sum\u00e9' : 'Add another r\u00e9sum\u00e9';
    renderList();
    document.body.classList.toggle('resume-saved-ready', !!kept);
    paintChip();
  }

  // One click, no file picker: the whole point of keeping it.
  runSaved.addEventListener('click', async () => {
    const kept = store.activeItem();
    if (!kept) { showSaved(); return; }
    resumeText = kept.text;
    document.body.classList.add('resume-has-file');
    invalidate();
    selected.hidden = false;
    fileName.textContent = kept.label || kept.name || 'Saved r\u00e9sum\u00e9';
    selected.dataset.state = 'ready'; selectedIcon.textContent = '\u2713';
    actions.hidden = false; clear.hidden = false;
    await compare();
  });

  forget.addEventListener('click', () => {
    const current = store.activeItem();
    if (current) store.remove(current.id);
    const next = store.activeItem();
    resumeText = next ? next.text : '';
    announce();
    if (next) {
      showSaved(); renderList();
      fileName.textContent = next.label || next.name;
      status.textContent = 'Removed. Now using \u201c' + (next.label || next.name) + '\u201d.';
      return;
    }
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
    if (store.activeItem()) summaryNote.textContent = 'Your saved r\u00e9sum\u00e9 is ready \u2014 match it against your current filters.';
  }).catch(disableMatching).finally(() => clearTimeout(configTimer));
  // Bands for colour, not decoration: a number alone makes you work out whether 23 is
  // good. The thresholds are the rubric's own — each dimension is a 0-4 judgement
  // rendered as 0/25/50/75/100, so 50 is "partially meets" and 75 is "meets".
  const band = n => (n >= 70 ? 'strong' : n >= 45 ? 'fair' : 'weak');

  // Three columns in a 470px pane cannot hold "Experience and responsibility", and a
  // truncated label says less than a short one. The full wording stays as the tile's
  // title attribute, so nothing is lost for anyone who wants it.
  const SHORT = { skills: 'Skills', experience: 'Experience', domain: 'Domain' };

  function meter(key, label, score, uncertain) {
    const tile = node('div', null, 'fit-tile');
    tile.dataset.band = band(score);
    tile.title = label;
    tile.append(node('p', SHORT[key] || label, 'fit-tile-label'));
    const value = node('p', null, 'fit-tile-value');
    value.append(node('span', String(score), 'fit-tile-score'), node('span', '/100', 'fit-tile-max'));
    tile.append(value);
    const track = node('div', null, 'fit-track');
    const fill = node('div', null, 'fit-fill');
    // Width is the score; the element carries it as a style because it is data, not
    // design — there is no class for "23 per cent".
    fill.style.width = `${Math.max(2, score)}%`;
    track.append(fill);
    tile.append(track);
    if (uncertain) tile.append(node('p', 'uncertain', 'fit-tile-flag'));
    return tile;
  }

  function card({ job, assessment: a }, options = {}) {
    const article = node('article', null, 'resume-result');
    article.dataset.band = band(a.score);

    const heading = node('div', null, 'resume-result-heading');
    const title = node('h3');
    if (/^https?:\/\//i.test(job.url || '')) {
      const link = node('a', job.title, 'job-title'); link.href = job.url;
      link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.dataset.jobId = job.job_id; link.dataset.company = job.company; link.dataset.city = job.city || '';
      title.append(link);
    } else title.textContent = job.title;
    heading.append(title, node('span', `${a.score}/100`, 'resume-score'));
    article.append(heading);

    const meta = [job.company, job.city, job.salary].filter(Boolean).join(' · ');
    if (meta) article.append(node('p', meta, 'resume-meta'));

    const grid = node('div', null, 'fit-grid');
    for (const d of a.dimensions) grid.append(meter(d.key, d.label, d.score, d.confidence < 0.5));
    article.append(grid);

    // The gap is the one line worth reading first: it is the thing the résumé does not
    // answer, which is what decides whether to apply. It gets the accent border.
    if (a.gap?.text) {
      const callout = node('div', null, 'fit-callout');
      callout.append(node('span', 'Requirement to check', 'fit-callout-label'), node('p', a.gap.text));
      article.append(callout);
    }
    if (a.evidence?.text) {
      article.append(node('p', 'Strongest evidence in your résumé', 'resume-evidence-label'), node('blockquote', a.evidence.text));
    }
    if (a.uncertain) article.append(node('p', 'The model is uncertain about part of this assessment. Read the description before relying on the score.', 'resume-note'));
    if (a.truncated) article.append(node('p', 'This long description was shortened for comparison; read the full posting.', 'resume-note'));

    // In the pane the description is already open beside this, so the link would point
    // at what you are looking at.
    if (!options.inPane) {
      const button = node('button', 'Read full description', 'job-description-link');
      button.type = 'button'; button.dataset.description = job.job_id; article.append(button);
    }
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
      const added = store.add(text, file.name);
      announce();
      showSaved();
      // The first résumé is not named — there is nothing to tell it apart from yet.
      // The second makes the first ambiguous, so both get asked for at once.
      if (!added.isFirst) promptLabels(added.id);
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
      document.dispatchEvent(new CustomEvent('resumes:needed'));
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
      slot.replaceChildren(card(match, { inPane: true }));
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
