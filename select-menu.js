(function (global) {
  'use strict';
  // A native <select> drawn as the same popover as the résumé selector.
  //
  // macOS draws a native select's menu itself, in a style that matches nothing else on
  // the page. Marking a select with data-select-menu puts a button and a listbox in
  // front of it and hides it, but leaves it as the source of truth: choosing an option
  // sets its value and fires its change event, and code that sets its value directly
  // is reflected in the button. Nothing that already reads or writes the select has to
  // know it is no longer what people see.
  //
  // It follows the WAI-ARIA select-only pattern, as resume-picker.js does: focus moves
  // into the list, arrows move the active option, Enter or Space chooses it, Escape
  // backs out, and focus returns to the button. The popover is position: fixed and
  // placed from the button's rectangle, so no scroll container can clip it.

  const svg = paths => `<svg class="i" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const CHEVRON = '<path d="m6 9 6 6 6-6"/>';
  const CHECK = '<path d="M20 6 9 17l-5-5"/>';
  const GUTTER = 16;
  let uid = 0;
  let openMenu = null;

  function enhance(select) {
    if (select.dataset.selectMenuReady) return;
    select.dataset.selectMenuReady = '1';
    const id = 'select-menu-' + (++uid);
    const root = document.createElement('div');
    root.className = 'select-menu';
    const heading = select.dataset.selectMenu || '';
    root.innerHTML = `
      <button type="button" class="select-menu-trigger" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
        <span class="select-menu-value"></span>${svg(CHEVRON)}
      </button>
      <div class="select-menu-pop" hidden>
        ${heading ? `<p class="select-menu-heading" id="${id}-heading"></p>` : ''}
        <ul class="select-menu-list" id="${id}-list" role="listbox" tabindex="0"></ul>
      </div>`;
    select.after(root);
    select.classList.add('select-menu-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const trigger = root.querySelector('.select-menu-trigger');
    const value = root.querySelector('.select-menu-value');
    const pop = root.querySelector('.select-menu-pop');
    const list = root.querySelector('.select-menu-list');
    const label = select.getAttribute('aria-label') || '';
    if (heading) {
      root.querySelector('.select-menu-heading').textContent = heading;
      list.setAttribute('aria-labelledby', `${id}-heading`);
    } else list.setAttribute('aria-label', label);

    const current = () => select.options[select.selectedIndex];
    function paint() {
      const option = current();
      value.textContent = option ? option.textContent : '';
      trigger.setAttribute('aria-label', `${label}: ${value.textContent}`);
    }

    // Code elsewhere sets select.value without an event (restoring a URL, applying a
    // saved filter). Wrapping the setter on this one element keeps the button honest
    // without asking every such caller to announce what it did.
    const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() { return proto.get.call(this); },
      set(v) { proto.set.call(this, v); paint(); },
    });
    select.addEventListener('change', paint);

    function paintList() {
      list.replaceChildren();
      for (const option of select.options) {
        const li = document.createElement('li');
        li.id = `${id}-${option.index}`;
        li.className = 'select-menu-option';
        li.setAttribute('role', 'option');
        li.dataset.value = option.value;
        li.setAttribute('aria-selected', String(option.selected));
        li.innerHTML = '<span class="select-menu-name"></span>' + svg(CHECK);
        li.firstChild.textContent = option.textContent;
        list.append(li);
      }
      setActive(list.querySelector('[aria-selected="true"]') || list.firstElementChild);
    }

    function setActive(option) {
      for (const el of list.querySelectorAll('.is-active')) el.classList.remove('is-active');
      if (!option) { list.removeAttribute('aria-activedescendant'); return; }
      option.classList.add('is-active');
      list.setAttribute('aria-activedescendant', option.id);
      // Scrolls the list only; scrollIntoView would also scroll the page behind it.
      if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }

    function place() {
      const rect = trigger.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = global.innerHeight;
      const width = Math.min(Math.max(rect.width, 200), vw - GUTTER * 2);
      // Right-aligned to the button: the sort sits at the right end of its row, and a
      // menu wider than its button should grow into the page, not off its edge.
      const left = Math.min(Math.max(rect.right - width, GUTTER), vw - GUTTER - width);
      pop.style.width = width + 'px';
      pop.style.left = left + 'px';
      const below = vh - rect.bottom - GUTTER;
      const above = rect.top - GUTTER;
      const up = below < 240 && above > below;
      const room = Math.max((up ? above : below) - 6, 120);
      pop.style.maxHeight = room + 'px';
      list.style.maxHeight = Math.max(room - (heading ? 44 : 12), 88) + 'px';
      if (up) { pop.style.top = ''; pop.style.bottom = (vh - rect.top + 6) + 'px'; }
      else { pop.style.bottom = ''; pop.style.top = (rect.bottom + 6) + 'px'; }
    }

    const follow = () => { if (root.isConnected) place(); };
    function open() {
      if (openMenu && openMenu !== api) openMenu.close();
      paintList();
      pop.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      place();
      openMenu = api;
      global.addEventListener('scroll', follow, true);
      global.addEventListener('resize', follow);
      list.focus({ preventScroll: true });
    }
    function close(restoreFocus) {
      if (pop.hidden) return;
      pop.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (openMenu === api) openMenu = null;
      global.removeEventListener('scroll', follow, true);
      global.removeEventListener('resize', follow);
      if (restoreFocus) trigger.focus({ preventScroll: true });
    }
    function choose(option) {
      if (!option) return;
      if (option.dataset.value !== select.value) {
        select.value = option.dataset.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      close(true);
    }
    const api = { root, close };

    trigger.addEventListener('click', () => (pop.hidden ? open() : close()));
    list.addEventListener('click', event => choose(event.target.closest('.select-menu-option')));
    list.addEventListener('mousemove', event => {
      const option = event.target.closest('.select-menu-option');
      if (option && !option.classList.contains('is-active')) setActive(option);
    });
    root.addEventListener('focusout', event => {
      if (event.relatedTarget && !root.contains(event.relatedTarget)) close();
    });

    let typed = '', typedAt = 0;
    // Capture phase, for the same reason as the résumé selector: the description pane
    // closes itself on Escape from a document listener, and only an event stopped
    // before the bubble phase stays away from it.
    root.addEventListener('keydown', event => {
      if (event.target === trigger) {
        if (pop.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); open(); }
        else if (!pop.hidden && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
        return;
      }
      if (pop.hidden || event.target !== list) return;
      const options = [...list.children];
      const active = list.querySelector('.is-active');
      const at = options.indexOf(active);
      const move = index => { event.preventDefault(); setActive(options[Math.max(0, Math.min(options.length - 1, index))]); };
      switch (event.key) {
        case 'Escape': event.preventDefault(); event.stopPropagation(); close(true); return;
        case 'ArrowDown': move(at + 1); return;
        case 'ArrowUp': move(at - 1); return;
        case 'Home': move(0); return;
        case 'End': move(options.length - 1); return;
        case 'Enter': case ' ': event.preventDefault(); choose(active); return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        const now = Date.now();
        typed = (now - typedAt > 700 ? '' : typed) + event.key.toLowerCase();
        typedAt = now;
        const hit = options.find(o => o.textContent.trim().toLowerCase().startsWith(typed));
        if (hit) { event.preventDefault(); setActive(hit); }
      }
    }, true);

    paint();
  }

  // On pointerdown rather than click, as in the résumé selector: a click on something
  // that re-renders arrives detached and would look like it came from outside.
  document.addEventListener('pointerdown', event => {
    if (openMenu && !openMenu.root.contains(event.target)) openMenu.close();
  });

  // Run as soon as this file loads — it sits after the markup — so the value setter
  // is in place before any other script restores a value into the select. The
  // DOMContentLoaded pass catches selects added later; enhance() is idempotent.
  const start = () => document.querySelectorAll('select[data-select-menu]').forEach(enhance);
  start();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  global.SelectMenu = { enhance };
})(window);
