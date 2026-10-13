(function () {
  'use strict';
  const menu = document.getElementById('settings-menu');
  const trigger = document.getElementById('settings-trigger');
  const panel = document.getElementById('settings-popover');
  if (!menu || !trigger || !panel) return;

  function setOpen(open, returnFocus) {
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector('button, a, input')?.focus({ preventScroll: true });
    else if (returnFocus) trigger.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => setOpen(panel.hidden, false));
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !menu.contains(event.target)) setOpen(false, false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.preventDefault();
      setOpen(false, true);
    }
  });
})();
