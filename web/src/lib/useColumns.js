// The divider between the list and the description, from 1100px: drag it, or focus it
// and use ←/→ (Shift for bigger steps), Home/End for the limits, Enter or double-click
// to reset. The width is remembered ("find-jobs-column-ratio", as jobs-ui.js keeps it).
//
// The list never gets narrower than its header (tabs and Sort side by side) or 350px,
// and the description never narrower than 440px. Below 560px the description is marked
// is-narrow-column, which tightens its layout.
import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "find-jobs-column-ratio";
export const DEFAULT_RATIO = 0.6; // the list's share

function savedRatio() {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_RATIO;
  } catch {
    return DEFAULT_RATIO;
  }
}

// The list header at its natural width: tabs and Sort at their content size plus the gap.
function listHeadWidth() {
  const head = document.getElementById("list-head");
  if (!head || !head.offsetParent) return 0;
  const natural = (node) => {
    if (!node) return 0;
    const { flex, width } = node.style;
    node.style.flex = "none"; node.style.width = "max-content";
    const w = node.getBoundingClientRect().width;
    node.style.flex = flex; node.style.width = width;
    return w;
  };
  const gap = parseFloat(getComputedStyle(head).columnGap) || 0;
  const sort = document.getElementById("list-sort");
  return natural(document.getElementById("job-view-tabs")) + (sort ? gap + natural(sort) : 0);
}

export function useColumns(splitRef, dividerRef, wide) {
  const [ratio, setRatio] = useState(savedRatio);
  const [bounds, setBounds] = useState(null);
  const drag = useRef(null);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  const measure = useCallback(() => {
    const split = splitRef.current, divider = dividerRef.current;
    if (!wide || !split || !divider) return null;
    const gap = parseFloat(getComputedStyle(split).columnGap) || 0;
    const available = split.clientWidth - gap * 2 - divider.offsetWidth;
    const minList = Math.max(350, Math.ceil(listHeadWidth()));
    return available > minList + 440 ? { available, gap, min: minList / available, max: 1 - 440 / available } : null;
  }, [splitRef, dividerRef, wide]);

  const clamp = (r, b) => (b ? Math.min(b.max, Math.max(b.min, r)) : r);
  const set = useCallback((requested, save) => {
    const b = measure();
    setBounds(b);
    const r = clamp(requested, b);
    setRatio(r);
    if (save) { try { localStorage.setItem(KEY, String(r)); } catch { /* fine */ } }
  }, [measure]);

  // Re-fit when the window or the list header changes size.
  useEffect(() => {
    if (!wide || !splitRef.current) return;
    set(ratioRef.current, false);
    const ro = new ResizeObserver(() => set(ratioRef.current, false));
    ro.observe(splitRef.current);
    return () => ro.disconnect();
  }, [wide, set, splitRef]);

  const finish = (commit) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.documentElement.classList.remove("is-resizing-columns");
    if (commit) set(ratioRef.current, true); else set(d.initial, true);
    if (dividerRef.current && dividerRef.current.hasPointerCapture(d.id)) dividerRef.current.releasePointerCapture(d.id);
  };

  const dividerProps = {
    ref: dividerRef,
    className: "column-resizer",
    tabIndex: 0,
    role: "separator",
    "aria-label": "Resize job columns",
    "aria-orientation": "vertical",
    "aria-controls": "job-list job-detail",
    "aria-description": "Use Left and Right arrows to resize. Home and End set the limits. Enter or double-click resets the widths.",
    title: "Drag to resize · Arrow keys to adjust · Double-click to reset",
    hidden: !wide,
    "aria-valuemin": bounds ? Math.round(bounds.min * 100) : undefined,
    "aria-valuemax": bounds ? Math.round(bounds.max * 100) : undefined,
    "aria-valuenow": Math.round(ratio * 100),
    "aria-valuetext": `Job list ${Math.round(ratio * 100)}%, job details ${100 - Math.round(ratio * 100)}%`,
    onPointerDown(e) {
      if (e.button !== 0 || !measure()) return;
      e.preventDefault();
      e.currentTarget.focus({ preventScroll: true });
      const rect = e.currentTarget.getBoundingClientRect();
      drag.current = { id: e.pointerId, initial: ratioRef.current, offset: e.clientX - rect.left - rect.width / 2 };
      e.currentTarget.setPointerCapture(e.pointerId);
      document.documentElement.classList.add("is-resizing-columns");
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const b = measure();
      if (!b) { finish(false); return; }
      const left = e.clientX - splitRef.current.getBoundingClientRect().left - d.offset - b.gap - dividerRef.current.offsetWidth / 2;
      set(left / b.available, false);
    },
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    onLostPointerCapture: () => finish(true),
    onDoubleClick: () => set(DEFAULT_RATIO, true),
    onKeyDown(e) {
      if (e.key === "Escape" && drag.current) { e.preventDefault(); finish(false); return; }
      const b = measure();
      if (!b || !["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const current = splitRef.current.querySelector(".results-main").offsetWidth / b.available;
      const step = e.shiftKey ? 0.1 : 0.02;
      const requested = e.key === "Home" ? b.min : e.key === "End" ? b.max : e.key === "Enter" ? DEFAULT_RATIO : current + (e.key === "ArrowLeft" ? -step : step);
      set(requested, true);
    },
  };

  // Each fraction kept above 1, so a column at its minimum leaves no unallocated space.
  const style = { "--job-list-width": `${ratio * 100}fr`, "--job-detail-width": `${(1 - ratio) * 100}fr` };
  const narrowColumn = !!(wide && bounds && bounds.available * (1 - ratio) < 560);
  return { style, dividerProps, narrowColumn };
}
