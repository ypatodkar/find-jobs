// The all-jobs page. Stage 1 of the move to React: the list, its order and pages, and
// the selected role's description, with the markup of the current page so styles.css
// applies as it is. Filters, the Companies tab, the resizable divider, keyboard
// browsing, resume matching and the header's account controls follow in later stages.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Masthead from "./components/Masthead.jsx";
import JobRow from "./components/JobRow.jsx";
import Pagination from "./components/Pagination.jsx";
import DetailPane from "./components/DetailPane.jsx";
import { JOBS_PER_PAGE, loadJobs, sortJobs } from "./lib/jobs.js";

const SORTS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["salary", "Highest salary"],
  ["count", "Most roles"],
  ["company", "Company A–Z"],
  ["title", "Title A–Z"],
];

// From 1100px the list and the description sit side by side (.is-split).
const WIDE = "(min-width: 1100px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(WIDE).matches,
  );
}

export default function App() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const wide = useWide();

  useEffect(() => { loadJobs().then(setJobs, setError); }, []);

  const sorted = useMemo(() => (jobs ? sortJobs(jobs, sort) : []), [jobs, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / JOBS_PER_PAGE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * JOBS_PER_PAGE;
  const visible = sorted.slice(start, start + JOBS_PER_PAGE);
  const companies = useMemo(() => new Set(sorted.map((j) => j.company)).size, [sorted]);

  // Beside the list the pane is never left empty: on arrival, a new order or a new
  // page, the first role on screen is selected. Not under 1100px, where selecting
  // opens a sheet over the list.
  const firstId = visible[0] && visible[0].job_id;
  useEffect(() => { if (wide && firstId) setSelectedId(firstId); }, [wide, firstId]);

  const selected = selectedId ? sorted.find((j) => j.job_id === selectedId) : null;

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
                <select id="sort-select" aria-label="Sort roles" value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>
                  {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
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
