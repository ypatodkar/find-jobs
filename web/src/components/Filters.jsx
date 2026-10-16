// The filter bar (#job-controls), with the markup of index.html so styles.css applies:
// search, the four main filters, the Advanced filters panel, the Hide checkboxes, and
// Undo and Reset. Saved filters and the phone drawer arrive in the next stage; their
// slots are kept.
import { useEffect, useRef, useState } from "react";
import FilterPicker from "./FilterPicker.jsx";
import SelectMenu from "./SelectMenu.jsx";
import { DATE_RANGES, SALARY_FLOORS, activeCount, advancedCount } from "../lib/filters.js";

const ADVANCED_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" /></svg>
);

function AdvancedPanel({ count, onReset, children }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [maxHeight, setMaxHeight] = useState(null);
  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) ref.current.querySelector(":scope > summary").focus();
  };
  useEffect(() => {
    if (!open) return;
    const panel = ref.current.querySelector("#advanced-panel");
    setMaxHeight(Math.max(200, innerHeight - panel.getBoundingClientRect().top - 16));
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);

  return (
    <details ref={ref} className={`advanced-picker${count ? " has-selection" : ""}`} id="advanced-filters" open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      // A picker inside handles its own Escape first; this closes the panel itself.
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.preventDefault(); close(true); } }}>
      <summary aria-controls="advanced-panel" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        {ADVANCED_ICON}<span id="advanced-filter-label">{count ? `Advanced filters (${count})` : "Advanced filters"}</span>
      </summary>
      <div className="advanced-panel" id="advanced-panel" role="group" aria-label="Advanced filters"
        style={maxHeight ? { "--advanced-max-height": `${maxHeight}px` } : undefined}>
        <div className="advanced-panel-head"><strong>Advanced filters</strong>
          <button type="button" className="linkish" id="advanced-filter-done" onClick={() => close(true)}>Done</button>
        </div>
        <div className="filter-grid" id="advanced-grid">{children}</div>
        <div className="advanced-panel-foot"><button type="button" className="linkish" id="advanced-filter-reset" onClick={onReset}>Reset all</button></div>
      </div>
    </details>
  );
}

export default function Filters({ dims, filters, countsFor, onChange, onReset, canUndo, onUndo }) {
  const set = (patch) => onChange({ ...filters, ...patch });
  const setDim = (key, values) => onChange({ ...filters, selected: { ...filters.selected, [key]: values } });
  const picker = (d) => (
    <FilterPicker key={d.key} dim={d} selected={filters.selected[d.key] || []} counts={() => countsFor(d)} onChange={(v) => setDim(d.key, v)} />
  );
  const n = activeCount(filters, dims);

  return (
    <div className="controls" id="job-controls" aria-label="Job filters">
      <div className="filter-primary" id="filter-primary">
        <div className="search-wrap">
          <svg className="search-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" />
            <line x1="10.2" y1="10.2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input id="job-search" type="search" placeholder="Search title or company…" aria-label="Search roles" autoComplete="off"
            value={filters.query} onChange={(e) => set({ query: e.target.value })} />
        </div>
      </div>

      <div className="filter-shortcuts">
        <div className="primary-filter-grid" id="primary-grid" role="group" aria-label="Main filters">
          {dims.filter((d) => d.group === "primary").map(picker)}
        </div>
        <AdvancedPanel count={advancedCount(filters, dims)} onReset={onReset}>
          {dims.filter((d) => d.group === "advanced").map(picker)}
          <div className="sort-wrap">
            <SelectMenu id="date-select" label="Filter by date posted" placeholder="Posted" placeholderValue="all"
              options={DATE_RANGES.map((r) => ({ value: r.k, label: r.label }))} value={filters.range} onChange={(v) => set({ range: v })} />
          </div>
          <div className="sort-wrap">
            <SelectMenu id="salary-select" label="Filter by minimum salary" placeholder="Salary" placeholderValue="all"
              options={SALARY_FLOORS.map((s) => ({ value: s.k, label: s.label }))} value={filters.salary} onChange={(v) => set({ salary: v })} />
          </div>
        </AdvancedPanel>
      </div>

      <div className="filter-tail">
        <label className="toggle applied-toggle" title="Roles you have already opened from this site">
          <input type="checkbox" id="hide-opened" checked={filters.hideOpened} onChange={(e) => set({ hideOpened: e.target.checked })} />
          <span>Hide roles I’ve opened</span>
        </label>
        <span className="tail-sep" aria-hidden="true"></span>
        <label className="toggle applied-toggle" title="Leaves only companies you have never opened a role at">
          <input type="checkbox" id="hide-opened-companies" checked={filters.hideOpenedCompanies} onChange={(e) => set({ hideOpenedCompanies: e.target.checked })} />
          <span>Hide companies I’ve opened</span>
        </label>
        <div className="tail-presets" id="preset-slot"></div>
        <button type="button" className="undo-btn" id="undo-filters" hidden={!canUndo} disabled={!canUndo} onClick={onUndo}>↩ Undo</button>
        <button type="button" className="reset-btn" id="reset-filters" hidden={n === 0} onClick={onReset}>{`Reset ${n} filter${n === 1 ? "" : "s"}`}</button>
      </div>
    </div>
  );
}
