// A multi-select filter dropdown, with the ids styles.css and the tests use (pick-,
// sum-, q-, sa-, clr-, list-<key>).
//
// The order of the list is fixed when the menu opens or its search changes, never on a
// tick: re-sorting under the cursor mid-selection is disorienting. Counts are always
// current, and a selected value stays listed even at zero so it can be unticked.
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_OPTIONS = 60; // the long tail (hundreds of industry tags) is reached by searching

export default function FilterPicker({ dim, selected, counts, onChange }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState([]);
  const chosen = useMemo(() => new Set(selected), [selected]);
  const n = selected.length;

  // Ordinal filters (size, seniority, career) keep their own scale; the rest lead with
  // what is selected, then by number of roles.
  const sortEntries = () => {
    const m = new Map(counts());
    chosen.forEach((v) => { if (!m.has(v)) m.set(v, 0); });
    const rank = dim.order ? (v) => { const i = dim.order.indexOf(v); return i < 0 ? Infinity : i; } : null;
    return [...m.keys()].sort((a, b) => {
      if (rank) return rank(a) - rank(b);
      const sel = (v) => (chosen.has(v) ? 0 : 1);
      return sel(a) - sel(b) || m.get(b) - m.get(a) || dim.labelFor(a).localeCompare(dim.labelFor(b));
    });
  };

  // Re-ordered on opening and on a new search, not on a tick.
  useEffect(() => { if (open) setOrder(sortEntries()); }, [open, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  const current = open ? new Map(counts()) : new Map();
  const q = query.trim().toLowerCase();
  const matching = q ? order.filter((v) => dim.labelFor(v).toLowerCase().includes(q)) : order;
  const capped = !q && order.length > MAX_OPTIONS;
  const visible = capped ? matching.slice(0, MAX_OPTIONS) : matching;
  // "Select all" takes the matches when searching, else every option, not just the
  // capped head. Hidden on the exclude filter, where it would empty the list.
  const target = (q ? visible : order).filter((v) => !chosen.has(v));

  const summary = n === 0 ? dim.label : n === 1 ? dim.labelFor(selected[0]) : `(${n}) ${dim.pluralLabel}`;
  const toggle = (v, on) => onChange(on ? [...selected, v] : selected.filter((x) => x !== v));

  return (
    <div className="picker-wrap">
      <details ref={ref} className={`company-picker${n ? " has-selection" : ""}`} id={`pick-${dim.key}`} open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); ref.current.querySelector("summary").focus(); } }}>
        <summary id={`sum-${dim.key}`} aria-label={`${dim.label} filter: ${n === 0 ? (dim.exclude ? "None excluded" : "Any") : summary}`}
          onClick={(e) => { e.preventDefault(); setOpen(!open); }}>{summary}</summary>
        <div className="company-panel">
          <div className="company-panel-top">
            <input type="search" id={`q-${dim.key}`} placeholder="Find…" aria-label={`Search ${dim.label}`} autoComplete="off"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="panel-actions">
            <button type="button" className="linkish" id={`sa-${dim.key}`} hidden={dim.exclude || target.length === 0}
              onClick={() => onChange([...selected, ...target])}>{q ? `Select all ${target.length} matching` : `Select all ${target.length}`}</button>
            <button type="button" className="linkish" id={`clr-${dim.key}`} hidden={n === 0} onClick={() => onChange([])}>Clear</button>
          </div>
          <div className="company-list" id={`list-${dim.key}`} role="group" aria-label={`Select ${dim.label}`}>
            {open && (visible.length ? visible.map((v) => {
              const count = current.get(v) || 0;
              return (
                <label key={v} className={`company-row${count === 0 ? " is-zero" : ""}`}>
                  <input type="checkbox" value={v} checked={chosen.has(v)} onChange={(e) => toggle(v, e.target.checked)} />
                  <span className="company-name">{dim.labelFor(v)}</span>
                  <span className="company-n">{count}</span>
                </label>
              );
            }) : <p className="company-none">{query ? `No match for “${query}”.` : "Nothing left under the current filters."}</p>)}
            {open && capped ? <p className="company-none">Top {MAX_OPTIONS} of {order.length} — search to find the rest.</p> : null}
          </div>
        </div>
      </details>
    </div>
  );
}
