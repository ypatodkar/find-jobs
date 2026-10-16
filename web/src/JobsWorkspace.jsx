// The job list and its description, as jobs-ui.js createJobsView: the filters with
// their URL, undo and saved filters, the list and its pages, the Companies tab, the
// divider, keyboard browsing, and the description pane (a sheet on narrow screens), all
// with the markup of the current pages so styles.css applies as it is.
//
// Shared by the all-jobs page and each investor's page, which load the jobs and
// supply the header and footer around it. `jobs` is null while they load.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Filters from "./components/Filters.jsx";
import JobRow from "./components/JobRow.jsx";
import CompanyCard from "./components/CompanyCard.jsx";
import Pagination from "./components/Pagination.jsx";
import DetailPane from "./components/DetailPane.jsx";
import SelectMenu from "./components/SelectMenu.jsx";
import { ResumeSignInDialog } from "./components/Account.jsx";
import "./lib/track.js";
import { JOBS_PER_PAGE, sortJobs } from "./lib/jobs.js";
import { DATE_RANGES, SALARY_FLOORS, countsFor, dimensions, filterJobs } from "./lib/filters.js";
import { COMPANIES_PER_PAGE, buildGroups } from "./lib/groups.js";
import { decode } from "./lib/presets.js";
import { useFilterState } from "./lib/useFilterState.js";
import { useColumns } from "./lib/useColumns.js";
import { useSeen } from "./lib/seen.js";

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "salary", label: "Highest salary" },
  { value: "count", label: "Most roles" },
  { value: "company", label: "Company A–Z" },
  { value: "title", label: "Title A–Z" },
];
const DETAIL_KEY = "findJobsDetail"; // the history entry a narrow-screen sheet adds

function useMedia(query) {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(query).matches,
  );
}

const firmLabel = (id) => {
  const f = (window.VC_FIRMS || []).find((x) => x.id === id);
  return f ? f.short || f.name : id;
};

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * `showFirms`: offer the Investor filter (the all-jobs page). `contextLabel`: the
 * investor a page is about, which names its saved filters.
 */
export default function JobsWorkspace({ jobs, showFirms = false, contextLabel = null }) {
  const [selectedId, setSelectedId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false); // the description over the list, under 1100px
  const [expanded, setExpanded] = useState(() => new Set());
  const wide = useMedia("(min-width: 1100px)");
  const narrow = !wide;
  const dims = useMemo(() => dimensions({ showFirms, firmLabel }), [showFirms]);
  const { filters, setFilters, page, setPage, view, setView, canUndo, undo, reset, settle } = useFilterState(dims);

  const splitRef = useRef(null), dividerRef = useRef(null), paneRef = useRef(null), listRef = useRef(null);
  const { style: columnStyle, dividerProps, narrowColumn } = useColumns(splitRef, dividerRef, wide);

  // A shared saved-filter link (?f=) applies once, over whatever the URL said.
  useEffect(() => {
    const shared = decode(new URLSearchParams(location.search).get("f") || "");
    if (shared) setFilters(shared);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const naming = useMemo(() => ({
    labelFor: (key, v) => (dims.find((d) => d.key === key) || { labelFor: (x) => x }).labelFor(v),
    salaryLabel: (k) => (SALARY_FLOORS.find((s) => s.k === k) || {}).label || k,
    rangeLabel: (k) => (DATE_RANGES.find((r) => r.k === k) || {}).label || k,
    contextLabel,
  }), [dims, contextLabel]);

  // Opened roles (track.js's store): the Hide filters and the "N opened" notes.
  const seenMap = useSeen();
  const seen = useMemo(() => new Set(Object.keys(seenMap)), [seenMap]);
  const openedByCompany = useMemo(() => {
    const m = new Map();
    for (const j of jobs || []) if (j.job_id && seen.has(j.job_id)) m.set(j.company, (m.get(j.company) || 0) + 1);
    return m;
  }, [jobs, seen]);
  const openedCompanies = useMemo(() => new Set(openedByCompany.keys()), [openedByCompany]);
  const filterOpts = { seen, openedCompanies };

  const results = useMemo(() => (jobs ? filterJobs(jobs, filters, dims, filterOpts) : []), [jobs, filters, dims, seen, openedCompanies]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => sortJobs(results, filters.sort), [results, filters.sort]);
  const groups = useMemo(() => (view === "grouped" ? buildGroups(sorted, filters.sort) : []), [view, sorted, filters.sort]);
  const companyCount = useMemo(() => new Set(sorted.map((j) => j.company)).size, [sorted]);

  const perPage = view === "grouped" ? COMPANIES_PER_PAGE : JOBS_PER_PAGE;
  const total = view === "grouped" ? groups.length : sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * perPage;
  const visibleJobs = view === "flat" ? sorted.slice(start, start + perPage) : [];
  const visibleGroups = view === "grouped" ? groups.slice(start, start + perPage) : [];

  useEffect(() => { if (jobs) settle(pageCount); }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = selectedId ? (jobs || []).find((j) => j.job_id === selectedId) : null;
  const open = wide ? !!selected : sheetOpen && !!selected;

  // ---- selecting and closing ----
  // Beside the list, a click brings the workspace into view below the filters once;
  // after that, browsing never moves the page. Under 1100px the description opens as a
  // sheet with its own history entry, so Back closes it.
  const revealWorkspace = () => {
    const pane = paneRef.current;
    if (!pane || narrow) return;
    const top = pane.getBoundingClientRect().top;
    const dock = parseFloat(getComputedStyle(pane).top) || 0;
    if (top > dock + 1) scrollTo({ top: scrollY + top - dock, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  const selectJob = useCallback((id, { reveal = true, fromHistory = false } = {}) => {
    if (narrow && !fromHistory) {
      const state = { ...history.state, [DETAIL_KEY]: id };
      // Switching roles inside an open sheet still needs only one Back to the list.
      if (sheetOpen && history.state && history.state[DETAIL_KEY]) history.replaceState(state, "");
      else history.pushState(state, "");
    }
    setSelectedId(id);
    if (narrow) setSheetOpen(true);
    // At once, as jobs-ui.js does: the pane is always beside the list, so its place is
    // known before the new role draws.
    else if (reveal) revealWorkspace();
  }, [narrow, sheetOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing returns focus to the role's row, however the sheet was closed (Back, the
  // button, Escape): as soon as the sheet is drawn closed, before anything else runs.
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const wasOpen = useRef(false);
  useLayoutEffect(() => {
    if (wasOpen.current && !sheetOpen && narrow) {
      document.querySelector(`#job-list .job[data-job-id="${CSS.escape(selectedRef.current || "")}"] .job-title`)?.focus({ preventScroll: true });
    }
    wasOpen.current = sheetOpen;
  }, [sheetOpen, narrow]);

  const closeDetail = useCallback(({ fromHistory = false } = {}) => {
    if (!narrow) return;
    if (!fromHistory && history.state && history.state[DETAIL_KEY]) { history.back(); return; }
    setSheetOpen(false);
  }, [narrow]); // eslint-disable-line react-hooks/exhaustive-deps

  // Back, Forward and reload through a sheet's history entry. Restoring a role also
  // opens its company in the Companies tab.
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const viewRef = useRef(view);
  viewRef.current = view;
  const restoredOnLoad = useRef(false);
  const restoreDetail = (id) => {
    const job = (jobsRef.current || []).find((j) => j.job_id === id);
    if (!job) { setSheetOpen(false); return false; }
    if (viewRef.current === "grouped") setExpanded((s) => (s.has(job.company) ? s : new Set(s).add(job.company)));
    setSelectedId(id);
    setSheetOpen(true);
    return true;
  };
  useEffect(() => {
    const onPop = (e) => {
      if (!jobsRef.current) return; // the data hasn't landed; the load below reads the state
      const id = e.state && e.state[DETAIL_KEY];
      if (id) restoreDetail(id);
      else setSheetOpen(false);
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!jobs || restoredOnLoad.current) return;
    const id = history.state && history.state[DETAIL_KEY];
    // Remember which first row was on screen, so arriving doesn't replace the restored
    // role with it; a new filter, page or tab selects as usual.
    restoredOnLoad.current = id && restoreDetail(id) ? { first: firstId } : true;
  }, [jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  // The sheet is a dialog: focus goes into it, Escape closes it, Tab stays inside, and
  // the page behind does not scroll.
  useEffect(() => {
    const on = narrow && open;
    document.body.classList.toggle("detail-open", on);
    if (!on) return;
    requestAnimationFrame(() => document.getElementById("detail-title")?.focus({ preventScroll: true }));
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") { closeDetail(); return; }
      if (e.key !== "Tab") return;
      const pane = paneRef.current;
      const focusable = [...pane.querySelectorAll("a[href], button, input, select, summary, [tabindex='0']")]
        .filter((n) => !n.disabled && n.getAttribute("tabindex") !== "-1" && n.getClientRects().length && !n.closest("[inert]"));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !pane.contains(document.activeElement))) { e.preventDefault(); last && last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !pane.contains(document.activeElement))) { e.preventDefault(); first && first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("detail-open"); };
  }, [narrow, open, closeDetail]);

  // ---- the first role, selected ----
  // Beside the list the pane is never empty: on arrival, after the filters change (once
  // typing pauses), on a new page or tab, the first role on screen is selected — in the
  // Companies tab, the first company opens and its first role is taken. Not under
  // 1100px, where it would open a sheet over the list. Paging with the arrow keys picks
  // its own row instead (`pickAfterPage`).
  const pickAfterPage = useRef(null);
  const lastFilters = useRef(null); // the filters the last automatic selection saw
  const firstGroup = visibleGroups[0] && visibleGroups[0].company;
  const firstId = view === "grouped" ? (visibleGroups[0] && visibleGroups[0].jobs[0].job_id) : visibleJobs[0] && visibleJobs[0].job_id;
  useEffect(() => {
    if (!jobs) return;
    if (pickAfterPage.current) {
      const which = pickAfterPage.current;
      pickAfterPage.current = null;
      requestAnimationFrame(() => {
        const rows = listRef.current ? [...listRef.current.querySelectorAll(".job[data-job-id]")] : [];
        const row = which === "last" ? rows[rows.length - 1] : rows[0];
        if (row) selectRow(row);
      });
      return;
    }
    if (!wide || !firstId) return;
    // A role restored from history on arrival stays selected.
    if (restoredOnLoad.current && restoredOnLoad.current.first !== undefined) {
      if (restoredOnLoad.current.first === firstId) return;
      restoredOnLoad.current = true; // the list has changed since: select as usual from now on
    }
    // After a filter change, a quarter second, so typing in the search box selects once
    // it pauses, not per key; on arrival, a new page or a tab, at once.
    const typing = lastFilters.current !== null && lastFilters.current !== filters;
    lastFilters.current = filters;
    const t = setTimeout(() => {
      if (view === "grouped" && firstGroup) setExpanded((s) => (s.has(firstGroup) ? s : new Set(s).add(firstGroup)));
      setSelectedId(firstId);
    }, typing ? 250 : 0);
    return () => clearTimeout(t);
  }, [jobs, wide, firstId, view, current, filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- ↑ / ↓ through the list ----
  // Moves the selection without leaving the keyboard, past the last row onto the next
  // page and before the first onto the previous one. Only while nothing else wants the
  // arrows: focus on the list or nowhere, and no menu open.
  const selectRow = (row) => {
    selectJob(row.dataset.jobId, { reveal: false });
    row.scrollIntoView({ block: "nearest" });
    if (!narrow) row.querySelector(".job-title")?.focus({ preventScroll: true });
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (narrow && open) return; // the sheet covers the list
      const a = document.activeElement;
      const idle = !a || a === document.body || a === document.documentElement;
      if (!idle && !(listRef.current && listRef.current.contains(a))) return;
      if (document.querySelector("details.company-picker[open], details.preset-picker[open], details.account-menu[open], details.advanced-picker[open]")) return;
      const rows = listRef.current ? [...listRef.current.querySelectorAll(".job[data-job-id]")] : [];
      if (!rows.length) return;
      e.preventDefault();
      const down = e.key === "ArrowDown";
      const at = rows.findIndex((r) => r.classList.contains("is-selected"));
      const next = at === -1 ? (down ? 0 : rows.length - 1) : at + (down ? 1 : -1);
      if (next >= rows.length) { if (current < pageCount) { pickAfterPage.current = "first"; setPage(current + 1); scrollToResults(false); } return; }
      if (next < 0) { if (current > 1) { pickAfterPage.current = "last"; setPage(current - 1); scrollToResults(false); } return; }
      selectRow(rows[next]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // re-bound each render, so it always sees the current rows and page

  const scrollToResults = (smooth = true) => document.getElementById("job-results-bar")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
  const goTo = (n) => { setPage(n); scrollToResults(); };

  // When the filter bar is pinned, the pane docks under it: its height is published as
  // --toolbar-height for styles.css.
  useEffect(() => {
    const controls = document.getElementById("job-controls");
    if (!controls) return;
    const update = () => {
      const pinned = wide && getComputedStyle(controls).position === "sticky";
      document.documentElement.style.setProperty("--toolbar-height", pinned ? controls.offsetHeight + "px" : "0px");
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(controls);
    return () => ro.disconnect();
  }, [wide, jobs]);

  const toggleCompany = (company) => setExpanded((s) => { const n = new Set(s); if (n.has(company)) n.delete(company); else n.add(company); return n; });

  const countText = view === "grouped"
    ? (groups.length ? `Showing ${start + 1}–${start + visibleGroups.length} of ${groups.length} companies · ${sorted.length} roles` : "0 companies · 0 roles")
    : (sorted.length ? `Showing ${start + 1}–${start + visibleJobs.length} of ${sorted.length} matching roles` : "0 matching roles");

  return (
    <>
      {jobs ? (
        <Filters dims={dims} filters={filters} onChange={setFilters} onReset={reset} canUndo={canUndo} onUndo={undo}
          total={sorted.length} naming={naming} countsFor={(d) => countsFor(jobs, filters, d, dims, filterOpts)} />
      ) : null}
      <div ref={splitRef} className={`results-split${wide ? " is-split" : ""}`} id="results-split" style={columnStyle}>
        <div className="results-main">
          <div className="results-bar" id="job-results-bar" hidden={!jobs}>
            <div className="list-head" id="list-head">
              <div className="view-tabs" id="job-view-tabs" role="group" aria-label="List view">
                <button type="button" className="seg" id="view-flat" aria-pressed={view === "flat"} onClick={() => view !== "flat" && setView("flat")}>
                  All jobs<span className="seg-n" id="count-flat">{sorted.length.toLocaleString()}</span>
                </button>
                <button type="button" className="seg" id="view-grouped" aria-pressed={view === "grouped"} onClick={() => view !== "grouped" && setView("grouped")}>
                  Companies<span className="seg-n" id="count-grouped">{companyCount.toLocaleString()}</span>
                </button>
              </div>
              <div className="sort-wrap list-sort" id="list-sort"><span aria-hidden="true">Sort</span>
                <SelectMenu id="sort-select" label="Sort roles" options={SORTS} value={filters.sort} onChange={(v) => setFilters({ ...filters, sort: v })} />
              </div>
            </div>
            <p className="results-meta" id="job-count" data-total={total.toLocaleString()}>{countText}</p>
            <p className="results-hint" aria-hidden="true"><kbd>↑</kbd><kbd>↓</kbd> to move between jobs</p>
          </div>
          {!jobs ? <p className="results-meta">Loading roles…</p> : (
            <div ref={listRef} id="job-list" className="job-list">
              {view === "flat"
                ? (visibleJobs.length
                  ? visibleJobs.map((j) => <JobRow key={j.job_id} job={j} selected={j.job_id === selectedId} onSelect={selectJob} opened={openedByCompany.get(j.company) || 0} seen={!!seenMap[j.job_id]} />)
                  : <p className="empty">No roles match those filters.</p>)
                : (visibleGroups.length
                  ? visibleGroups.map((g) => (
                    <CompanyCard key={g.company} group={g} open={expanded.has(g.company)} onToggle={toggleCompany}
                      selectedId={selectedId} onSelect={selectJob} opened={openedByCompany.get(g.company) || 0} seen={seenMap} />
                  ))
                  : <p className="empty">No roles match those filters.</p>)}
            </div>
          )}
          <Pagination page={current} pageCount={jobs ? pageCount : 1} onPage={goTo} />
        </div>
        <div {...dividerProps}></div>
        <DetailPane ref={paneRef} job={selected} open={open} sheet={narrow && open} narrowColumn={narrowColumn} onClose={() => closeDetail()} />
      </div>
      <ResumeSignInDialog />
    </>
  );
}
