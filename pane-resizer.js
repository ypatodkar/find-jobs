// Adjustable width for the desktop job list and description panes.
(function () {
  "use strict";

  const split = document.getElementById("results-split");
  const handle = document.getElementById("pane-resizer");
  if (!split || !handle) return;
  // Set on the whole results section rather than the split alone, so the toolbar
  // above the list can end where the list does.
  const shell = split.closest(".results-shell") || split;

  const STORAGE_KEY = "find-jobs-list-width-v2";
  const DEFAULT_WIDTH = 53;
  const MIN_LIST_PX = 360;
  const MIN_DETAIL_PX = 300;
  const desktop = window.matchMedia("(min-width: 1280px)");
  let preferred = DEFAULT_WIDTH;
  let activePointer = null;

  try {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    if (saved > 0 && saved < 100) preferred = saved;
  } catch (_) { /* Browser storage may be disabled. */ }

  function limits() {
    const width = split.getBoundingClientRect().width;
    const handleWidth = handle.getBoundingClientRect().width || 12;
    const min = (MIN_LIST_PX / width) * 100;
    const max = Math.max(min, ((width - handleWidth - MIN_DETAIL_PX) / width) * 100);
    return { min, max };
  }

  function setWidth(requested, save) {
    if (!desktop.matches) return preferred;
    const { min, max } = limits();
    const width = Math.min(max, Math.max(min, requested));
    shell.style.setProperty("--list-width", `${width}%`);
    handle.setAttribute("aria-valuemin", String(Math.round(min)));
    handle.setAttribute("aria-valuemax", String(Math.round(max)));
    handle.setAttribute("aria-valuenow", String(Math.round(width)));
    handle.setAttribute("aria-valuetext", `Job list ${Math.round(width)} percent, job details ${Math.round(100 - width)} percent`);
    if (save) {
      try { localStorage.setItem(STORAGE_KEY, String(width)); } catch (_) { /* Keep the current layout. */ }
    }
    return width;
  }

  function widthAt(clientX) {
    const bounds = split.getBoundingClientRect();
    return ((clientX - bounds.left) / bounds.width) * 100;
  }

  function finishDrag(event) {
    if (activePointer === null || (event && event.pointerId !== activePointer)) return;
    preferred = setWidth(preferred, true);
    if (handle.hasPointerCapture(activePointer)) handle.releasePointerCapture(activePointer);
    activePointer = null;
    document.body.classList.remove("is-resizing-panes");
  }

  handle.addEventListener("pointerdown", (event) => {
    if (!desktop.matches || event.button !== 0) return;
    event.preventDefault();
    activePointer = event.pointerId;
    handle.setPointerCapture(activePointer);
    document.body.classList.add("is-resizing-panes");
    preferred = setWidth(widthAt(event.clientX), false);
  });
  handle.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointer) return;
    preferred = setWidth(widthAt(event.clientX), false);
  });
  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  handle.addEventListener("lostpointercapture", () => {
    if (activePointer !== null) finishDrag();
  });

  handle.addEventListener("keydown", (event) => {
    if (!desktop.matches) return;
    const { min, max } = limits();
    let next;
    if (event.key === "ArrowLeft") next = preferred - 3;
    else if (event.key === "ArrowRight") next = preferred + 3;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    preferred = setWidth(next, true);
  });

  window.addEventListener("resize", () => setWidth(preferred, false));
  setWidth(preferred, false);
})();
