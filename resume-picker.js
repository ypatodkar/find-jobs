(function (global) {
  'use strict';
  // The résumé selector in the description pane.
  //
  // Was a native <select>, which on macOS draws a system menu that matches nothing
  // else on the page and cannot hold an "Add résumé" action. This is a button that
  // opens a listbox, following the WAI-ARIA select-only pattern: focus moves into the
  // list, arrows move the active option, Enter or Space chooses it, Escape backs out,
  // and focus returns to the button either way.
  //
  // It owns no storage. The list, the selection and the upload all go through
  // window.Resumes, which is the same path the navigation's résumé manager uses, so a
  // file added here is a file added there.
  //
  // The popover is position: fixed and placed from the trigger's rectangle. The pane
  // is a scroll container, and an absolutely positioned popover inside it would be
  // clipped by it or would stretch its scroll height instead of floating over it.
  // It stays next to the trigger in the DOM so Tab moves through it in reading order.

  const ACCEPT = '.pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown';
  const svg = (paths, size = 16) => `<svg class="i" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const FILE = '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>';
  const CHEVRON = '<path d="m6 9 6 6 6-6"/>';
  const CHECK = '<path d="M20 6 9 17l-5-5"/>';
  const PLUS = '<path d="M5 12h14"/><path d="M12 5v14"/>';
  const GUTTER = 16;

  const labelOf = item => item.label || item.name || 'Résumé';
  let uid = 0;

  // The markup the pane writes where the selector goes. Built here so the pane does
  // not need to know what the selector is made of.
  function markup() {
    const id = 'resume-picker-' + (++uid);
    return `
      <div class="resume-picker" data-resume-picker>
        <button type="button" class="resume-picker-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
          ${svg(FILE)}<span class="resume-picker-value"></span>${svg(CHEVRON)}
        </button>
        <div class="resume-picker-pop" hidden>
          <p class="resume-picker-heading" id="${id}-heading">Your résumés</p>
          <ul class="resume-picker-list" id="${id}-list" role="listbox" tabindex="0" aria-labelledby="${id}-heading"></ul>
          <p class="resume-picker-empty" hidden>No résumés yet. Add one to score this role.</p>
          <p class="resume-picker-status" role="status" aria-live="polite"></p>
          <div class="resume-picker-foot">
            <button type="button" class="resume-picker-add">${svg(PLUS)}<span>Add résumé</span></button>
          </div>
          <input class="resume-picker-file" type="file" accept="${ACCEPT}" multiple hidden tabindex="-1">
        </div>
      </div>`;
  }

  const parts = root => ({
    trigger: root.querySelector('.resume-picker-trigger'),
    value: root.querySelector('.resume-picker-value'),
    pop: root.querySelector('.resume-picker-pop'),
    list: root.querySelector('.resume-picker-list'),
    empty: root.querySelector('.resume-picker-empty'),
    status: root.querySelector('.resume-picker-status'),
    add: root.querySelector('.resume-picker-add'),
    file: root.querySelector('.resume-picker-file'),
  });

  function paintTrigger(root) {
    const { trigger, value } = parts(root);
    const active = global.Resumes?.active();
    value.textContent = active ? labelOf(active) : 'No résumé added';
    value.classList.toggle('is-placeholder', !active);
    trigger.setAttribute('aria-label', `Compare with: ${active ? labelOf(active) : 'no résumé added'}`);
    trigger.title = active ? labelOf(active) : '';
  }

  function paintList(root) {
    const { list, empty } = parts(root);
    const { items, active } = global.Resumes.list();
    const base = list.id;
    list.replaceChildren();
    list.hidden = items.length === 0;
    empty.hidden = items.length !== 0;
    for (const item of items) {
      const option = document.createElement('li');
      option.id = `${base}-${item.id}`;
      option.className = 'resume-picker-option';
      option.setAttribute('role', 'option');
      option.dataset.id = item.id;
      option.setAttribute('aria-selected', String(item.id === active));
      option.innerHTML = svg(FILE) + '<span class="resume-picker-name"></span>' + svg(CHECK);
      option.querySelector('.resume-picker-name').textContent = labelOf(item);
      option.title = labelOf(item);
      list.append(option);
    }
    setActive(root, list.querySelector('[aria-selected="true"]') || list.firstElementChild);
  }

  // The option keyboard focus is on, which is not necessarily the selected one.
  function setActive(root, option) {
    const { list } = parts(root);
    for (const el of list.querySelectorAll('.is-active')) el.classList.remove('is-active');
    if (!option) { list.removeAttribute('aria-activedescendant'); return; }
    option.classList.add('is-active');
    list.setAttribute('aria-activedescendant', option.id);
    // Scrolls the list only; scrollIntoView would also scroll the pane behind it.
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }

  function place(root) {
    const { trigger, pop, list } = parts(root);
    const rect = trigger.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = global.innerHeight;
    const width = Math.min(Math.max(rect.width, 320), 360, vw - GUTTER * 2);
    const left = Math.min(Math.max(rect.left, GUTTER), vw - GUTTER - width);
    pop.style.width = width + 'px';
    pop.style.left = left + 'px';
    // Below the trigger unless there is clearly more room above it. The list scrolls
    // rather than the popover running off the screen.
    const below = vh - rect.bottom - GUTTER;
    const above = rect.top - GUTTER;
    const up = below < 240 && above > below;
    const room = Math.max((up ? above : below) - 6, 160);
    pop.style.maxHeight = room + 'px';
    list.style.maxHeight = Math.max(room - 120, 88) + 'px';
    if (up) { pop.style.top = ''; pop.style.bottom = (vh - rect.top + 6) + 'px'; }
    else { pop.style.bottom = ''; pop.style.top = (rect.bottom + 6) + 'px'; }
    pop.dataset.side = up ? 'top' : 'bottom';
  }

  let openRoot = null;
  const follow = () => { if (openRoot) { if (openRoot.isConnected) place(openRoot); else openRoot = null; } };

  function open(root, focusList = true) {
    if (!global.Resumes) return;
    if (openRoot && openRoot !== root) close(openRoot);
    const { trigger, pop, list, status } = parts(root);
    status.textContent = '';
    paintList(root);
    pop.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    place(root);
    openRoot = root;
    global.addEventListener('scroll', follow, true);
    global.addEventListener('resize', follow);
    if (focusList) (list.hidden ? parts(root).add : list).focus({ preventScroll: true });
  }

  function close(root, restoreFocus = false) {
    const { trigger, pop } = parts(root);
    if (pop.hidden) return;
    pop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (openRoot === root) openRoot = null;
    global.removeEventListener('scroll', follow, true);
    global.removeEventListener('resize', follow);
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function choose(root, option) {
    if (!option) return;
    const { active } = global.Resumes.list();
    if (option.dataset.id !== active) global.Resumes.select(option.dataset.id);
    close(root, true);
  }

  async function upload(root, files) {
    const { add, status } = parts(root);
    const label = add.querySelector('span');
    add.disabled = true;
    const failures = [];
    let added = 0;
    for (const file of files) {
      label.textContent = `Reading ${file.name}…`;
      try { if (await global.Resumes.addFile(file)) added++; }
      catch (error) { failures.push(files.length > 1 ? `${file.name}: ${error.message}` : error.message); }
    }
    add.disabled = false;
    label.textContent = 'Add résumé';
    // Disabling the focused button dropped focus to the page; give it back.
    if (document.activeElement === document.body && root.isConnected) add.focus({ preventScroll: true });
    if (failures.length) status.textContent = failures.join(' ');
    else if (added) status.textContent = added === 1 ? 'Added and selected.' : `Added ${added} résumés. The last one is selected.`;
    if (root.isConnected && !parts(root).pop.hidden) { paintList(root); place(root); }
  }

  // ---- wiring -------------------------------------------------------------------
  // Delegated from the document because the pane rewrites its contents for every role.

  const rootOf = el => el && el.closest('[data-resume-picker]');

  document.addEventListener('click', event => {
    const root = rootOf(event.target);
    if (!root) return;
    if (event.target.closest('.resume-picker-trigger')) {
      if (parts(root).pop.hidden) open(root); else close(root);
      return;
    }
    const option = event.target.closest('.resume-picker-option');
    if (option) { choose(root, option); return; }
    if (event.target.closest('.resume-picker-add')) parts(root).file.click();
  });

  document.addEventListener('change', event => {
    if (!event.target.matches('.resume-picker-file')) return;
    const root = rootOf(event.target);
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (root && files.length) upload(root, files);
  });

  document.addEventListener('mousemove', event => {
    const option = event.target.closest?.('.resume-picker-option');
    if (option && !option.classList.contains('is-active')) setActive(rootOf(option), option);
  });

  // On pointerdown, not click, for the same reason as the navigation's menu: a click
  // on something that re-renders would arrive detached and look like it came from
  // outside.
  document.addEventListener('pointerdown', event => {
    if (openRoot && !openRoot.contains(event.target)) close(openRoot);
  });

  // Tabbing out of the popover closes it. A null relatedTarget is the file dialog
  // taking focus, or a click on nothing focusable, which pointerdown already handles.
  document.addEventListener('focusout', event => {
    const root = rootOf(event.target);
    if (root && root === openRoot && event.relatedTarget && !root.contains(event.relatedTarget)) close(root);
  });

  let typed = '', typedAt = 0;
  document.addEventListener('keydown', event => {
    const root = rootOf(event.target);
    if (!root) return;
    const { trigger, pop, list } = parts(root);

    if (event.target === trigger) {
      if (pop.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(root); }
      else if (!pop.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(root, true); }
      return;
    }
    if (pop.hidden || !pop.contains(event.target)) return;

    if (event.key === 'Escape') {
      // Stopped so the pane, which closes itself on Escape on narrow screens, does
      // not shut along with the popover.
      event.preventDefault(); event.stopPropagation();
      close(root, true);
      return;
    }
    if (event.target !== list) return;
    const options = [...list.querySelectorAll('.resume-picker-option')];
    const current = list.querySelector('.is-active');
    const at = options.indexOf(current);
    const move = index => { event.preventDefault(); setActive(root, options[Math.max(0, Math.min(options.length - 1, index))]); };
    switch (event.key) {
      case 'ArrowDown': move(at + 1); return;
      case 'ArrowUp': move(at - 1); return;
      case 'Home': move(0); return;
      case 'End': move(options.length - 1); return;
      case 'Enter': case ' ': event.preventDefault(); choose(root, current); return;
    }
    // Typing the start of a name jumps to it, as a native select does.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      typed = (now - typedAt > 700 ? '' : typed) + event.key.toLowerCase();
      typedAt = now;
      const hit = options.find(o => o.textContent.trim().toLowerCase().startsWith(typed));
      if (hit) { event.preventDefault(); setActive(root, hit); }
    }
  // Capture phase: the pane's own Escape handler also listens on the document, and
  // only stopping the event before it reaches the bubble phase keeps it from firing.
  }, true);

  function paint(scope) {
    for (const root of (scope || document).querySelectorAll('[data-resume-picker]')) {
      paintTrigger(root);
      if (!parts(root).pop.hidden) paintList(root);
    }
  }
  document.addEventListener('resumes:changed', () => paint());

  global.ResumePicker = { markup, paint };
})(window);
