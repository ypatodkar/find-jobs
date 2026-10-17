// A single-choice menu drawn like the filter dropdowns (Sort, Posted, Salary). With a placeholder, the summary shows it while the default
// is chosen, and the menu is marked as having a selection otherwise.
import { useEffect, useRef, useState } from "react";

const GUTTER = 8;

export default function SelectMenu({ id, label, options, value, onChange, placeholder, placeholderValue, disabled }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const current = options.find((o) => o.value === value) || options[0];
  const isDefault = placeholder && value === placeholderValue;
  const text = placeholder && (!current || isDefault) ? placeholder : current ? current.label : "";

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", close);
    const panel = ref.current.querySelector(".select-panel");
    setAlignRight(panel.getBoundingClientRect().right > innerWidth - GUTTER);
    (ref.current.querySelector(".select-option.is-selected") || ref.current.querySelector(".select-option"))?.focus();
    return () => document.removeEventListener("click", close);
  }, [open]);

  const choose = (v) => {
    setOpen(false);
    ref.current.querySelector("summary").focus();
    if (v !== value) onChange(v);
  };

  const onKeyDown = (e) => {
    if (!open) {
      if (e.target.tagName === "SUMMARY" && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); if (!disabled) setOpen(true); }
      return;
    }
    const list = [...ref.current.querySelectorAll(".select-option:not(:disabled)")];
    const at = list.indexOf(document.activeElement);
    let next = null;
    if (e.key === "ArrowDown") next = list[Math.min(list.length - 1, at + 1)];
    else if (e.key === "ArrowUp") next = list[Math.max(0, at - 1)];
    else if (e.key === "Home") next = list[0];
    else if (e.key === "End") next = list[list.length - 1];
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); ref.current.querySelector("summary").focus(); return; }
    else if (e.key === "Tab") { setOpen(false); return; }
    if (next) { e.preventDefault(); next.focus(); }
  };

  return (
    <details ref={ref} id={id ? `menu-${id}` : undefined}
      className={`company-picker select-picker${disabled ? " is-disabled" : ""}${placeholder && current && !isDefault ? " has-selection" : ""}${alignRight ? " align-right" : ""}`}
      open={open} onToggle={(e) => setOpen(e.currentTarget.open)} onKeyDown={onKeyDown}>
      <summary aria-haspopup="listbox" aria-label={label ? `${label}: ${text}` : text} aria-disabled={disabled || undefined}
        onClick={(e) => { e.preventDefault(); if (!disabled) setOpen(!open); }}>{text}</summary>
      <div className="company-panel select-panel" role="listbox" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" role="option" aria-selected={o.value === value}
            className={`select-option${o.value === value ? " is-selected" : ""}`} onClick={() => choose(o.value)}>{o.label}</button>
        ))}
      </div>
    </details>
  );
}
