// The all-jobs page. Stages 1–2a of the move to React: the list, its order and pages,
// the selected role's description, and the filters with their URL and undo, all with
// the markup of the current page so styles.css applies as it is. Saved filters, the
// phone drawer, the Companies tab, the divider, keyboard browsing, resume matching and
// the header's account controls follow in later stages.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Masthead from "./components/Masthead.jsx";
import Filters from "./components/Filters.jsx";
import JobRow from "./components/JobRow.jsx";
import Pagination from "./components/Pagination.jsx";
import DetailPane from "./components/DetailPane.jsx";
import SelectMenu from "./components/SelectMenu.jsx";
import { JOBS_PER_PAGE, loadJobs, sortJobs } from "./lib/jobs.js";
import { countsFor, dimensions, filterJobs } from "./lib/filters.js";
import { useFilterState } from "./lib/useFilterState.js";
import { useSeen } from "./lib/seen.js";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "salary", label: "Highest salary" },
  { value: "count", label: "Most roles" },
  { value: "company", label: "Company A–Z" },
  { value: "title", label: "Title A–Z" },
];

// From 1100px the list and the description sit side by side (.is-split).
const WIDE = "(min-width: 1100px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(WIDE).matches,
  );
}

const firmLabel = (id) => {
  const f = (window.VC_FIRMS || []).find((x) => x.id === id);
  return f ? f.short || f.name : id;
};

export default function App() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const wide = useWide();
  const dims = useMemo(() => dimensions({ showFirms: true, firmLabel }), []);
  const { filters, setFilters, page, setPage, canUndo, undo, reset } = useFilterState(dims);

  useEffect(() => { loadJobs().then(setJobs, setError); }, []);

  // Opened roles (track.js's store), for the two Hide filters.
  const seenMap = useSeen();
  const seen = useMemo(() => new Set(Object.keys(seenMap)), [seenMap]);
  const openedCompanies = useMemo(() => {
    const s = new Set();
    for (const j of jobs || []) if (j.job_id && seen.has(j.job_id)) s.add(j.company);
    return s;
  }, [jobs, seen]);
  const filterOpts = { seen, openedCompanies };

  const results = useMemo(() => (jobs ? filterJobs(jobs, filters, dims, filterOpts) : []), [jobs, filters, dims, seen, openedCompanies]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortJobs(results, filters.sort), [results, filters.sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / JOBS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * JOBS_PER_PAGE;
  const visible = sorted.slice(start, start + JOBS_PER_PAGE);
  const companies = useMemo(() => new Set(sorted.map((j) => j.company)).size, [sorted]);

  // Beside the list the pane is never left empty: on arrival, after the filters change
  // (once typing pauses), or on a new page, the first role on screen is selected. Not
  // under 1100px, where selecting opens a sheet over the list.
  const firstId = visible[0] && visible[0].job_id;
  useEffect(() => {
    if (!wide || !firstId) return;
    const t = setTimeout(() => setSelectedId(firstId), 250);
    return () => clearTimeout(t);
  }, [wide, firstId]);

  const selected = selectedId ? (jobs || []).find((j) => j.job_id === selectedId) : null;

  const goTo = (n) => {
    setPage(n);
    document.getElementById("job-results-bar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (error) {
    return (
      <div className="wrap">
        <Masthead />
        <div className="firm-message"><p><strong>We couldn't load the job list.</strong></p><p>{String(error.message || error)}</p></div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <Masthead />
      {jobs ? (
        <Filters dims={dims} filters={filters} onChange={setFilters} onReset={reset} canUndo={canUndo} onUndo={undo}
          countsFor={(d) => countsFor(jobs, filters, d, dims, filterOpts)} />
      ) : null}
      <div className={`results-split${wide ? " is-split" : ""}`} id="results-split"
        style={{ "--job-list-width": "60fr", "--job-detail-width": "40fr" }}>
        <div className="results-main">
          <div className="results-bar" id="job-results-bar" hidden={!jobs}>
            <div className="list-head" id="list-head">
              <div className="view-tabs" id="job-view-tabs" role="group" aria-label="List view">
                <button type="button" className="seg" id="view-flat" aria-pressed="true">All jobs<span className="seg-n" id="count-flat">{sorted.length.toLocaleString()}</span></button>
                <button type="button" className="seg" id="view-grouped" aria-pressed="false" disabled title="Arrives in a later stage of the React move">Companies<span className="seg-n" id="count-grouped">{companies.toLocaleString()}</span></button>
              </div>
              <div className="sort-wrap list-sort" id="list-sort"><span aria-hidden="true">Sort</span>
                <SelectMenu id="sort-select" label="Sort roles" options={SORTS} value={filters.sort} onChange={(v) => setFilters({ ...filters, sort: v })} />
              </div>
            </div>
            <p className="results-meta" id="job-count">
              {sorted.length ? `Showing ${start + 1}–${start + visible.length} of ${sorted.length} matching roles` : "0 matching roles"}
            </p>
          </div>
          {!jobs ? <p className="results-meta">Loading roles…</p> : (
            <div id="job-list" className="job-list">
              {visible.length
                ? visible.map((j) => <JobRow key={j.job_id} job={j} selected={j.job_id === selectedId} onSelect={setSelectedId} />)
                : <p className="empty">No roles match those filters.</p>}
            </div>
          )}
          <Pagination page={current} pageCount={jobs ? pageCount : 1} onPage={goTo} />
        </div>
        <div className="column-resizer" aria-hidden="true" hidden={!wide}></div>
        <DetailPane job={selected} open={!!selected} />
      </div>
    </div>
  );
}
