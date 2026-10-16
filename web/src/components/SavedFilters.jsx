// The saved-filters bar: "Save this filter", and once anything
// is saved, a dropdown of them to apply, rename or remove. Naming takes a suggested
// name, focused and selected, so Enter accepts it and typing replaces it.
import { useEffect, useRef, useState } from "react";
import { MAX_NAME, describe, presets, same, usePresets } from "../lib/presets.js";
import "../styles/presets.css";

const PENCIL = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const BOOKMARK = (
  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

function NameForm({ initial, onSave, onCancel }) {
  const input = useRef(null);
  const [value, setValue] = useState(initial);
  useEffect(() => { input.current.focus(); input.current.select(); }, []);
  const commit = () => { const v = value.trim(); if (!v) { input.current.focus(); return; } onSave(v); };
  return (
    <span className="preset-naming" onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCancel(); }
    }}>
      <input ref={input} type="text" id="preset-name" className="preset-name" maxLength={MAX_NAME} placeholder="Name this filter"
        aria-label="Name this filter" value={value} onChange={(e) => setValue(e.target.value)} />
      <button type="button" className="preset-confirm" id="preset-confirm" onClick={commit}>Save</button>
      <button type="button" className="preset-cancel" id="preset-cancel" title="Cancel" aria-label="Cancel" onClick={onCancel}>×</button>
    </span>
  );
}

export default function SavedFilters({ filters, onApply, naming }) {
  const items = usePresets();
  const ref = useRef(null);
  const [editing, setEditing] = useState(null); // null, { id: null } (new), { id } (rename)
  const [open, setOpen] = useState(false);
  const active = items.find((p) => same(p.filters, filters)) || null;

  useEffect(() => {
    if (!open || editing) return;
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open, editing]);

  if (editing && editing.id === null) {
    return (
      <div className="preset-bar" id="preset-bar">
        <NameForm initial={describe(filters, naming)} onCancel={() => setEditing(null)}
          onSave={(name) => { presets.save(name, filters); setEditing(null); }} />
      </div>
    );
  }

  return (
    <div className="preset-bar" id="preset-bar">
      {items.length ? (
        <>
          <span className="preset-label">Saved filters:</span>
          <details ref={ref} className={`preset-picker${active ? " has-selection" : ""}`} id="preset-picker" open={open}
            onToggle={(e) => setOpen(e.currentTarget.open)}>
            <summary onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
              <span className="preset-current">{active ? active.name : "Choose one"}</span>
              <span className="preset-n">{items.length}</span>
            </summary>
            <div className="preset-menu">
              {items.map((p) => (editing && editing.id === p.id ? (
                <div key={p.id} className="preset-row is-editing">
                  <NameForm initial={p.name} onCancel={() => setEditing(null)} onSave={(name) => { presets.rename(p.id, name); setEditing(null); }} />
                </div>
              ) : (
                <div key={p.id} className={`preset-row${active && active.id === p.id ? " is-active" : ""}`}>
                  <button type="button" className="preset-apply" title="Apply these filters" onClick={() => { setOpen(false); onApply(p.filters); }}>{p.name}</button>
                  <button type="button" className="preset-edit" title="Rename" aria-label={`Rename ${p.name}`} onClick={() => setEditing({ id: p.id })}>{PENCIL}</button>
                  <button type="button" className="preset-del" title="Remove" aria-label={`Remove ${p.name}`}
                    onClick={() => { presets.remove(p.id); if (editing && editing.id === p.id) setEditing(null); setOpen(items.length > 2); }}>×</button>
                </div>
              )))}
            </div>
          </details>
        </>
      ) : null}
      <button type="button" className="preset-save" id="preset-save" title="Save the current filters" onClick={() => setEditing({ id: null })}>
        {BOOKMARK}<span>Save this filter</span>
      </button>
    </div>
  );
}
