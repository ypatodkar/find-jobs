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
  // The panel this used to mark unavailable is now the popover in the navigation.
  const section = document.getElementById('resume-popover');
  const form = $('resume-form'), availability = $('resume-availability');
  const summaryNote = $('resume-summary-note'), actionLabel = $('resume-action-closed');
  const runSaved = $('resume-run'), forget = $('resume-forget');
  const fileBtn = $('resume-file-text');

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
    // Emptying the result slot used to be the whole story, which left the score block
    // with no result and no way to ask for one — the "Check match" button lives in
    // that slot. Repaint it instead, so it returns to whatever is true now: a cached
    // score for the selected résumé, or the offer to fetch one.
    paintScoreBlock();
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
    if (popover) popover.hidden = true;
  }
  // The pane draws its own picker and needs the list; it does not need the storage,
  // so only these four things cross the boundary.
  window.Resumes = {
    list: () => store.read(),
    select: id => { store.select(id); const c = store.activeItem(); if (c) { resumeText = c.text; fileName.textContent = c.label || c.name; invalidate(); } renderList(); announce(); },
    active: () => store.activeItem(),
    addFile: file => { if (fileInput) { const dt = new DataTransfer(); dt.items.add(file); fileInput.files = dt.files; fileInput.dispatchEvent(new Event('change', { bubbles: true })); } },
  };

  // ---- the résumé menu --------------------------------------------------------
  // A control in the navigation, not a panel above the job list. It states what it
  // holds and opens a popover anchored to itself, so switching résumés never moves
  // the list underneath it.
  const menu = $('resume-menu');
  const trigger = $('resume-manage');
  const popover = $('resume-popover');
  const chipText = $('resume-chip-text');

  function paintChip() {
    if (!trigger) return;
    const { items } = matchingReady ? store.read() : { items: [] };
    trigger.hidden = !matchingReady;
    if (!chipText) return;
    chipText.textContent = items.length === 0 ? 'Add résumé'
      : items.length === 1 ? '1 résumé'
      : items.length + ' résumés';
  }

  function openMenu(open) {
    if (!popover || !trigger) return;
    const next = open === undefined ? popover.hidden : open;
    popover.hidden = !next;
    trigger.setAttribute('aria-expanded', String(next));
    if (next) {
      const first = popover.querySelector('.resume-row-pick, #resume-file');
      if (first) first.focus({ preventScroll: true });
    }
  }
  trigger?.addEventListener('click', () => openMenu());

  // Closing on an outside click and on Escape, which is what a popover has to do to
  // behave like one rather than like a panel that happens to float.
  // On pointerdown, not click: a control inside the popover that re-renders the list —
  // naming, removing, switching — is detached from the document before its click event
  // bubbles here, so by then it looks like a click on the outside and the popover shuts
  // itself the moment it is used. pointerdown fires while the element is still in place.
  document.addEventListener('pointerdown', event => {
    if (!popover || popover.hidden) return;
    if (!menu.contains(event.target)) openMenu(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && popover && !popover.hidden) { openMenu(false); trigger.focus(); }
  });

  // Asking for a score without a résumé opens the menu where one is added.
  document.addEventListener('resumes:needed', () => openMenu(true));

  // ---- the collection -------------------------------------------------------
  // Every saved file stays visible in the manager, including a single file: its
  // filename and Remove action must not disappear just because there is no choice
  // to make yet. Selection and naming controls only appear with multiple files.
  const listEl = $('resume-list');
  let naming = false;

  function renderList() {
    if (!listEl) return;
    const { items, active } = store.read();
    listEl.replaceChildren();
    listEl.hidden = items.length === 0;
    if (items.length === 0) { naming = false; return; }

    if (naming) {
      listEl.append(node('p', 'Name your résumés so you can tell them apart.', 'resume-list-hint'));
    }
    for (const item of items) {
      const row = node('div', null, 'resume-row');
      row.dataset.id = item.id;
      if (item.id === active) row.classList.add('is-active');

      if (items.length > 1) {
        const pick = document.createElement('input');
        pick.type = 'radio'; pick.name = 'resume-pick'; pick.value = item.id;
        pick.checked = item.id === active;
        pick.className = 'resume-row-pick';
        pick.setAttribute('aria-label', 'Use ' + (item.label || item.name));
        row.append(pick);
      }

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

      const remove = node('button', null, 'resume-row-remove');
      remove.type = 'button'; remove.dataset.removeResume = item.id;
      remove.innerHTML = '<svg class="i" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';
      remove.setAttribute('aria-label', 'Remove ' + (item.label || item.name));
      row.append(remove);
      listEl.append(row);
    }
    if (naming) {
      const done = node('button', 'Save names', 'resume-names-done');
      done.type = 'button'; done.id = 'resume-names-done';
      listEl.append(done);
    } else if (items.length > 1) {
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
    const going = store.read().items.find(r => r.id === remove.dataset.removeResume);
    if (going) scores.forget(going);
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
    selected.dataset.state = 'ready'; selectedIcon.textContent = '';
    actions.hidden = false; clear.hidden = false;
    await compare();
  });

  forget.addEventListener('click', () => {
    const current = store.activeItem();
    if (current) { scores.forget(current); store.remove(current.id); }
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
    // The pane can open before /jobs/config answers, and paintScoreBlock refuses to
    // draw anything until matching is known to exist. Without this the score block
    // stays empty for the job already on screen after a reload — the one case where
    // a cached score should appear with no interaction at all.
    paintScoreBlock();
    repaintRowFits();
    if (store.activeItem()) summaryNote.textContent = 'Your saved r\u00e9sum\u00e9 is ready \u2014 match it against your current filters.';
  }).catch(disableMatching).finally(() => clearTimeout(configTimer));
  // ---- scores, per job and per résumé -----------------------------------------
  // A score belongs to a pair: this job, judged against this résumé's text. Keying on
  // the résumé's id alone would hand the old score back after someone replaced the
  // file behind it, so the key is a hash of the content, and the rubric version the
  // server reports is stored with every entry — a rubric change invalidates the lot,
  // because the numbers no longer mean the same thing.
  //
  // It lives in this browser beside the résumés themselves. Nothing new is stored on
  // the server: the API already caches an assessment against its own hash, so a repeat
  // request is cheap, and this only avoids making one at all.
  const SCORES = 'find-jobs-scores';
  const SCORE_LIMIT = 400;

  function contentHash(text) {
    // FNV-1a. Not a security boundary — it names a cache entry, and the thing it names
    // never leaves this browser.
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36) + ':' + text.length;
  }

  const scoreKey = (jobId, resume) => jobId + '\u0000' + contentHash(resume.text);

  const scores = {
    all() {
      try { const raw = JSON.parse(localStorage.getItem(SCORES) || '{}'); return raw && typeof raw === 'object' ? raw : {}; }
      catch { return {}; }
    },
    save(map) {
      try {
        const keys = Object.keys(map);
        if (keys.length > SCORE_LIMIT) {
          // Oldest first; an unbounded cache in localStorage eventually throws on write
          // and takes the feature down with it.
          keys.sort((a, b) => (map[a].at || 0) - (map[b].at || 0));
          for (const k of keys.slice(0, keys.length - SCORE_LIMIT)) delete map[k];
        }
        localStorage.setItem(SCORES, JSON.stringify(map));
      } catch { /* private mode: scoring still works, it just will not be remembered */ }
    },
    get(jobId, resume) {
      if (!resume) return null;
      const entry = this.all()[scoreKey(jobId, resume)];
      if (!entry || !entry.assessment) return null;
      if (rubric && entry.rubric && entry.rubric !== rubric) return null;
      return entry;
    },
    put(jobId, resume, match) {
      const map = this.all();
      map[scoreKey(jobId, resume)] = {
        at: Date.now(),
        rubric: match.assessment.rubricVersion || null,
        job: { job_id: match.job.job_id, title: match.job.title, company: match.job.company, url: match.job.url },
        assessment: match.assessment,
      };
      this.save(map);
    },
    forget(resume) {
      if (!resume) return;
      const map = this.all();
      const suffix = '\u0000' + contentHash(resume.text);
      let changed = false;
      for (const k of Object.keys(map)) if (k.endsWith(suffix)) { delete map[k]; changed = true; }
      if (changed) this.save(map);
    },
    dropOtherRubrics(version) {
      if (!version) return;
      const map = this.all();
      let changed = false;
      for (const k of Object.keys(map)) if (map[k].rubric && map[k].rubric !== version) { delete map[k]; changed = true; }
      if (changed) this.save(map);
    },
  };

  // The rubric the server is currently using, learned from the first assessment it
  // returns. Until one arrives nothing is invalidated, because nothing is known.
  let rubric = null;

  // ---- the score block in the inspector ---------------------------------------
  // One job on screen at a time, so one place to say which job that is. Switching
  // résumés repaints this and nothing else: the description, the scroll position and
  // the selected row all stay where they were.
  let openJob = null;
  let scoreRun = 0;
  const inflight = new Set();

  // Lucide, inline: the file set is small and fixed, and a sprite or a package would
  // be a dependency for six paths.
  const ICON = {
    file: '<svg class="i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
    chevron: '<svg class="i rpick-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
    check: '<svg class="i rpick-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    plus: '<svg class="i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
  };
  const PLUS = ICON.plus;

  const scoreHost = () => (openJob ? document.querySelector(`.job-score[data-score-for="${CSS.escape(openJob)}"]`) : null);

  function paintScoreBlock() {
    const host = scoreHost();
    if (!host) return;
    host.replaceChildren();
    if (!matchingReady) return;

    const { items, active } = store.read();
    host.append(node('p', 'Résumé match', 'fit-head-label'));

    if (!items.length) {
      const empty = node('div', null, 'score-empty');
      empty.append(node('p', 'Add a résumé to see how your experience reads against this role.', 'score-empty-note'));
      const add = node('button', 'Add résumé', 'btn btn-secondary btn-sm');
      add.type = 'button'; add.dataset.scoreAdd = '1';
      empty.append(add);
      host.append(empty);
      return;
    }

    // Which résumé this job is being judged against. The label is stated rather than
    // implied: a number with no name attached is a number you cannot act on.
    //
    // A listbox rather than a <select>: the native control renders as the operating
    // system's own menu, which on macOS looks nothing like the rest of this page and
    // cannot carry a file icon, a check, or an "add" action beneath the options.
    const current = items.find(r => r.id === active) || items[0];
    const controls = node('div', null, 'job-score-controls');
    controls.append(node('p', 'Compare this job against', 'job-score-pick-label'));

    const picker = node('div', null, 'rpick');
    const trigger = node('button', null, 'rpick-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = ICON.file +
      '<span class="rpick-label"></span>' + ICON.chevron;
    trigger.querySelector('.rpick-label').textContent = current ? (current.label || current.name || 'Résumé') : 'Choose a résumé';

    const menu = node('div', null, 'rpick-menu');
    menu.hidden = true;
    menu.append(node('p', 'Your résumés', 'rpick-title'));
    const list = node('div', null, 'rpick-list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Your résumés');
    for (const item of items) {
      const option = node('button', null, 'rpick-option');
      option.type = 'button';
      option.setAttribute('role', 'option');
      const chosen = item.id === active;
      option.setAttribute('aria-selected', String(chosen));
      // Roving tabindex: one stop for the whole list, arrows move within it.
      option.tabIndex = chosen ? 0 : -1;
      if (chosen) option.classList.add('is-selected');
      option.dataset.pickResume = item.id;
      option.innerHTML = ICON.file + '<span class="rpick-option-name"></span>' + (chosen ? ICON.check : '');
      option.querySelector('.rpick-option-name').textContent = item.label || item.name || 'Résumé';
      list.append(option);
    }
    menu.append(list);
    const foot = node('div', null, 'rpick-foot');
    const add = node('button', null, 'rpick-add');
    add.type = 'button'; add.dataset.scoreAdd = '1';
    add.innerHTML = ICON.plus + '<span>Add résumé</span>';
    foot.append(add);
    menu.append(foot);

    picker.append(trigger, menu);
    controls.append(picker);
    host.append(controls);

    const result = node('div', null, 'job-match-result');
    result.dataset.matchResult = openJob;
    host.append(result);
    paintResult();
    paintRoster(host, items, active);
  }

  // The result area for the selected résumé: its score if this pair has one, and the
  // offer to make the call if not.
  function paintResult(state) {
    const host = scoreHost();
    const result = host && host.querySelector('.job-match-result');
    if (!result) return;
    const current = store.activeItem();
    if (!current) { result.replaceChildren(); return; }

    if (state === 'loading') {
      result.replaceChildren(node('p', 'Comparing this résumé with the description…', 'job-match-msg'));
      return;
    }
    if (state && state.error) {
      const box = node('div', null, 'job-match-msg is-error');
      box.append(node('p', state.error));
      const retry = node('button', 'Try again', 'btn btn-secondary btn-sm');
      retry.type = 'button'; retry.dataset.match = openJob;
      box.append(retry);
      result.replaceChildren(box);
      return;
    }

    const hit = scores.get(openJob, current);
    if (hit) {
      result.replaceChildren(card({ job: hit.job, assessment: hit.assessment }, { inPane: true }));
      return;
    }
    const prompt = node('div', null, 'score-prompt');
    prompt.append(node('p', 'Not scored yet', 'score-prompt-note'));
    const check = node('button', 'Check match', 'btn btn-primary btn-sm');
    check.type = 'button'; check.dataset.match = openJob;
    prompt.append(check);
    result.replaceChildren(prompt);
  }

  // Every résumé against this one job, so the comparison people actually came for —
  // "which of mine reads best here" — is one glance rather than four switches.
  function paintRoster(host, items, active) {
    if (items.length < 2) return;
    const roster = node('div', null, 'score-roster');
    roster.append(node('p', 'Scores for this job', 'fit-finding-label'));
    for (const item of items) {
      const row = node('button', null, 'score-roster-row');
      row.type = 'button';
      row.dataset.pickResume = item.id;
      if (item.id === active) row.classList.add('is-active');
      row.append(node('span', item.label || item.name || 'Résumé', 'score-roster-name'));
      const hit = scores.get(openJob, item);
      row.append(node('span', hit ? String(hit.assessment.score) : 'Not evaluated',
        'score-roster-value' + (hit ? '' : ' is-empty')));
      roster.append(row);
    }
    host.append(roster);
  }

  // ---- the résumé picker's behaviour -------------------------------------------
  // Positioned with position:fixed and placed by hand. The inspector is an
  // overflow:hidden box with its own scroller, so anything absolutely positioned
  // inside it is clipped at the panel edge; fixed escapes that, and no ancestor
  // carries a transform that would trap it.
  let pickerOpen = null;

  function placeMenu(trigger, menu) {
    const r = trigger.getBoundingClientRect();
    const width = Math.min(344, Math.max(260, window.innerWidth - 24));
    menu.style.width = width + 'px';
    // Clamp into the viewport on both axes, and flip above the trigger when there is
    // more room up there than down.
    let left = Math.min(Math.max(12, r.left), window.innerWidth - width - 12);
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const flip = below < 220 && above > below;
    menu.style.maxHeight = Math.max(160, (flip ? above : below)) + 'px';
    menu.style.left = left + 'px';
    if (flip) { menu.style.top = 'auto'; menu.style.bottom = (window.innerHeight - r.top + 6) + 'px'; }
    else { menu.style.bottom = 'auto'; menu.style.top = (r.bottom + 6) + 'px'; }
  }

  function closePicker(restoreFocus) {
    if (!pickerOpen) return;
    const { trigger, menu } = pickerOpen;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    pickerOpen = null;
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    if (restoreFocus && trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  function reposition() {
    if (pickerOpen) placeMenu(pickerOpen.trigger, pickerOpen.menu);
  }

  function openPicker(trigger) {
    const menu = trigger.parentElement.querySelector('.rpick-menu');
    if (!menu) return;
    closePicker(false);
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    pickerOpen = { trigger, menu };
    placeMenu(trigger, menu);
    // The panel scrolls under a fixed menu, so follow it rather than let the two drift.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    const chosen = menu.querySelector('.rpick-option.is-selected') || menu.querySelector('.rpick-option');
    if (chosen) chosen.focus({ preventScroll: true });
  }

  document.addEventListener('click', event => {
    const trigger = event.target.closest('.rpick-trigger');
    if (trigger) {
      if (pickerOpen && pickerOpen.trigger === trigger) closePicker(true);
      else openPicker(trigger);
      return;
    }
    if (pickerOpen && !pickerOpen.menu.contains(event.target)) closePicker(false);
  });

  document.addEventListener('keydown', event => {
    if (!pickerOpen) {
      // Opening from the keyboard lands on the current choice, not on the first row.
      const trigger = event.target.closest && event.target.closest('.rpick-trigger');
      if (trigger && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault(); openPicker(trigger);
      }
      return;
    }
    const { menu, trigger } = pickerOpen;
    if (event.key === 'Escape') { event.preventDefault(); closePicker(true); return; }
    if (event.key === 'Tab') { closePicker(false); return; }
    if (!menu.contains(event.target)) return;

    const options = [...menu.querySelectorAll('.rpick-option')];
    const here = options.indexOf(event.target.closest('.rpick-option'));
    const move = to => {
      const next = options[Math.max(0, Math.min(options.length - 1, to))];
      if (!next) return;
      for (const o of options) o.tabIndex = -1;
      next.tabIndex = 0;
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
    };
    if (event.key === 'ArrowDown') { event.preventDefault(); move(here < 0 ? 0 : here + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(here < 0 ? options.length - 1 : here - 1); }
    else if (event.key === 'Home') { event.preventDefault(); move(0); }
    else if (event.key === 'End') { event.preventDefault(); move(options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') {
      if (here >= 0) { event.preventDefault(); options[here].click(); }
    }
  });

  document.addEventListener('job:opened', event => {
    openJob = event.detail && event.detail.id;
    paintScoreBlock();
  });
  // Uploading, renaming, removing or switching all change what this should show.
  document.addEventListener('resumes:changed', () => paintScoreBlock());

  document.addEventListener('change', event => {
    const select = event.target.closest('.job-score-select');
    if (!select) return;
    // Switching résumé repaints the score and the roster; the job, the description and
    // the scroll position are untouched.
    store.select(select.value);
    const current = store.activeItem();
    if (current) { resumeText = current.text; fileName.textContent = current.label || current.name; }
    renderList(); paintChip();
    paintScoreBlock(); repaintRowFits();
  });

  document.addEventListener('click', event => {
    const row = event.target.closest('[data-pick-resume]');
    if (row) {
      const fromPicker = !!row.closest('.rpick-menu');
      if (fromPicker) closePicker(false);
      store.select(row.dataset.pickResume);
      const current = store.activeItem();
      if (current) { resumeText = current.text; fileName.textContent = current.label || current.name; }
      renderList(); paintChip(); paintScoreBlock(); repaintRowFits();
      // The block was rebuilt, so focus the trigger that replaced the one just used.
      if (fromPicker) {
        const back = scoreHost() && scoreHost().querySelector('.rpick-trigger');
        if (back) back.focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.closest('[data-score-add]')) { fileInput.click(); }
  });

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

  // A score the user has already paid for is worth showing where they scan, not only
  // where they asked for it. Rows are re-rendered on paging and filtering, so this is
  // also replayed from the session's scores whenever the list changes.
  function paintRowFit(jobId, score) {
    const slot = document.querySelector(`[data-fit-for="${CSS.escape(jobId)}"]`);
    if (!slot) return;
    let value = score;
    if (typeof value !== 'number') {
      const hit = scores.get(jobId, store.activeItem());
      value = hit ? hit.assessment.score : null;
    }
    if (typeof value !== 'number') {
      if (slot.dataset.fitValue === '') return;
      slot.dataset.fitValue = '';
      slot.replaceChildren();
      slot.hidden = true;
      return;
    }
    // Writing the same number again would mutate the list, wake the observer below,
    // and bring us straight back here — a loop that pins the main thread and takes
    // the whole page with it. Only an actual change is written.
    if (slot.dataset.fitValue === String(value)) return;
    slot.dataset.fitValue = String(value);
    slot.replaceChildren(
      Object.assign(document.createElement('strong'), { textContent: value + '%', className: 'job-fit-score' }),
      Object.assign(document.createElement('span'), { textContent: 'Match', className: 'job-fit-word' }));
    slot.hidden = false;
  }
  function repaintRowFits() {
    for (const slot of document.querySelectorAll('[data-fit-for]')) paintRowFit(slot.dataset.fitFor);
  }
  // Rows are replaced wholesale on paging and filtering, so scores are replayed onto
  // the new ones. childList only, and not subtree: the score lives one level down and
  // watching the whole tree would see this function's own writes.
  const jobList = document.getElementById('job-list');
  if (jobList) new MutationObserver(repaintRowFits).observe(jobList, { childList: true });

  function card({ job, assessment: a }, options = {}) {
    const article = node('article', null, 'resume-result');
    article.dataset.band = band(a.score);

    if (options.inPane) {
      // The pane already names the role above this, so repeating the title and company
      // here would say it twice. What is missing from the pane is the number, so that
      // is what the card leads with.
      // The block around this already says "Résumé match" above the résumé picker,
      // so repeating it here would head the same section twice.
      const head = node('div', null, 'fit-head');
      const total = node('p', null, 'fit-total');
      total.append(node('span', String(a.score), 'fit-total-score'), node('span', '/100', 'fit-total-max'));
      head.append(total);
      const track = node('div', null, 'fit-track fit-track-total');
      const fill = node('div', null, 'fit-fill');
      fill.style.width = `${Math.max(2, a.score)}%`;
      track.append(fill);
      head.append(track);
      article.append(head);
    } else {
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
    }

    const grid = node('div', null, 'fit-grid');
    for (const d of a.dimensions) grid.append(meter(d.key, d.label, d.score, d.confidence < 0.5));
    article.append(grid);

    // Two findings, named for the questions they answer rather than for where the
    // data came from. Strength first, then the thing the résumé does not demonstrate,
    // which is what actually decides whether to apply.
    //
    // There is deliberately no "suggestions" section. The rubric returns three scores,
    // a supporting passage and a missing requirement; advice on how to improve is not
    // among them, and writing it from the score alone would be invention dressed as
    // analysis. Adding it means adding a question to the rubric, which is a model
    // change, not a layout one.
    if (a.evidence?.text) {
      const why = node('div', null, 'fit-finding');
      why.append(node('span', 'Why you match', 'fit-finding-label'), node('blockquote', a.evidence.text));
      article.append(why);
    }
    if (a.gap?.text) {
      const gap = node('div', null, 'fit-finding fit-finding-gap');
      gap.append(node('span', 'Potential gap', 'fit-finding-label'), node('p', a.gap.text));
      article.append(gap);
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
      //
      // The naming fields live in the manager, which may not be open: a résumé can be
      // added from the picker in the inspector, and asking someone to name files on a
      // panel they cannot see is asking nothing at all. Open it with the question.
      if (!added.isFirst) { openMenu(true); promptLabels(added.id); }
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

    // The résumé being compared is the one named in the control above the button, not
    // whatever was last uploaded.
    const resume = store.activeItem();
    if (!resume) { document.dispatchEvent(new CustomEvent('resumes:needed')); return; }

    // Already answered for this exact pair — show it rather than paying for it again.
    if (scores.get(jobId, resume)) { paintResult(); return; }

    const key = scoreKey(jobId, resume);
    if (inflight.has(key)) return;
    inflight.add(key);

    const run = ++scoreRun;
    paintResult('loading');
    const ctrl = new AbortController();
    singleJobControllers.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), 60000);
    try {
      const data = await JobsAPI.request('/matches',
        { resume: resume.text, consent: true, job_id: jobId }, ctrl.signal);
      const match = data.matches && data.matches[0];
      if (!match) throw new Error(data.message || 'No assessment came back for this role.');

      // Store it whatever happened on screen meanwhile: the answer is true for this
      // pair regardless of what is being looked at now, and throwing it away would
      // mean paying for it twice.
      rubric = match.assessment.rubricVersion || rubric;
      scores.dropOtherRubrics(rubric);
      scores.put(jobId, resume, match);
      paintRowFit(jobId, match.assessment.score);

      // Painting, though, is only correct if the question has not moved on — a slower
      // first request must not overwrite the answer to a second one.
      const live = store.activeItem();
      if (run !== scoreRun || jobId !== openJob || !live || live.id !== resume.id) return;
      paintScoreBlock();
    } catch (error) {
      if (run !== scoreRun || jobId !== openJob) return;
      if (error.status === 503) { disableMatching(); return; }
      paintResult({ error: error.name === 'AbortError'
        ? 'That comparison timed out. Please try again.'
        : (error.message || 'That comparison could not be completed.') });
    } finally {
      clearTimeout(timer);
      singleJobControllers.delete(ctrl);
      inflight.delete(key);
    }
  });

  clear.addEventListener('click', () => {
    // "Remove résumé and results" used to clear only what was on screen, which was
    // indistinguishable from removal while scores lived for one render. Now that a
    // score outlives its render, the control has to mean what it says: the résumé
    // goes, and its scores go with it, or the next paint brings the old number back
    // for a document the user believes they deleted.
    const going = store.activeItem();
    if (going) { scores.forget(going); store.remove(going.id); announce(); }
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
