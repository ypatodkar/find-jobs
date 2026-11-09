// The job list and its description: the filters with their URL, undo and saved
// filters, the list and its pages, the Companies tab, the divider, keyboard browsing,
// and the description pane (a sheet on narrow screens).
//
// Shared by the jobs pages (US, India) and each investor's page, which load the jobs
// and supply the header and footer around it. `jobs` is null while they load.
//
// Rendered full width: the filter toolbar is a full-bleed sticky bar, and the intro and
// the results each sit in CONTAINER, so their edges line up with the header's. From
// 1100px the results are three grid columns, the list | the divider | the job pane,
// and the pane docks under the header and toolbar while the list scrolls with the page.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownIcon, ArrowUpIcon, SearchXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CONTAINER } from "@/lib/layout.js";
import { tabsListVariants } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
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
import { firmLabel } from "./data.js";

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

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// shadcn's Skeleton pulses; held still for reduced motion.
const Bone = ({ className }) => <Skeleton className={cn("motion-reduce:animate-none", className)} />;

// Beside the list, the job pane and the divider dock 12px under the sticky header and
// filter toolbar (--toolbar-height is published below), and reach down to 12px above
// the viewport's bottom edge: the same top and height DetailPane gives #job-detail, so
// the pane's own sticky top is where it actually sits. Literal class strings, so
// Tailwind finds them.
const DOCK_TOP = "top-[calc(var(--header-height)+var(--toolbar-height,0px)+0.75rem)]";
const DOCK_HEIGHT = "h-[calc(100dvh-var(--header-height)-var(--toolbar-height,0px)-1.5rem)]";

// An open overlay wants the arrow keys for itself (DESIGN.md, "Keyboard"): a Radix /
// shadcn overlay's content (data-slot "…-content", data-state "open"), or an open
// <details> menu. Not a Collapsible's content, which is open in the page rather than
// over it, and not the disclosures inside the job pane (the resume match's requirement
// rows), which stay open while the list is browsed; the pane's resume picker is a menu,
// though, so it still counts while it is a <details>.
const OPEN_OVERLAY = '[data-state="open"][data-slot$="-content"]:not([data-slot="collapsible-content"]):not([data-slot="accordion-content"]), details[open]:not(#job-detail details), #job-detail details.company-picker[open]';

// The All jobs / Companies switch: two pressed-state buttons drawn as shadcn's TabsList
// and TabsTrigger. Buttons rather than Radix Tabs, because the view lives in the address
// bar (lib/useFilterState.js) and there are no tab panels to point at.
const VIEW_TAB = "seg relative inline-flex h-full flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all outline-none hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none dark:text-muted-foreground dark:hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm dark:aria-pressed:border-input dark:aria-pressed:bg-input/30 dark:aria-pressed:text-foreground";

// While the first jobs load: the shape of the list and the pane, so nothing jumps when
// they land.
function ListSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <Bone className="h-9 w-56 rounded-lg" />
          <Bone className="h-9 w-40" />
        </div>
        <Bone className="h-5 w-56" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-start gap-4 rounded-lg border bg-card px-4 py-3.5">
            <div className="flex flex-1 flex-col gap-2.5">
              <Bone className={cn("h-4", ["w-3/5", "w-4/5", "w-2/3"][i % 3])} />
              <Bone className="h-3.5 w-40" />
              <Bone className="h-3.5 w-28" />
            </div>
            <Bone className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PaneSkeleton() {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border bg-card p-6" aria-hidden="true">
      <Bone className="h-4 w-32" />
      <Bone className="h-6 w-3/4" />
      <Bone className="h-4 w-1/2" />
      <div className="mt-2 flex gap-2"><Bone className="h-9 w-28" /><Bone className="size-9" /></div>
      <Bone className="mt-6 h-24 w-full" />
      <Bone className="mt-4 h-4 w-full" />
      <Bone className="h-4 w-11/12" />
      <Bone className="h-4 w-4/5" />
    </div>
  );
}

/**
 * `showFirms`: offer the Investor filter (the all-jobs page). `contextLabel`: the
 * investor a page is about, which names its saved filters. `country`: whose list this
 * is, "US" or "IN" (in.html), which picks the filters that make sense for it.
 * `intro`: a node shown between the toolbar and the results, in CONTAINER (the country
 * note, the featured company, the companies you have opened).
 */
export default function JobsWorkspace({ jobs, showFirms = false, contextLabel = null, country = "US", intro = null }) {
  const [selectedId, setSelectedId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false); // the description over the list, under 1100px
  const [expanded, setExpanded] = useState(() => new Set());
  const wide = useMedia("(min-width: 1100px)");
  const narrow = !wide;
  const dims = useMemo(() => dimensions({ showFirms, firmLabel, country }), [showFirms, country]);
  const { filters, setFilters, page, setPage, view, setView, canUndo, undo, reset, settle } = useFilterState(dims);

  const splitRef = useRef(null), dividerRef = useRef(null), paneRef = useRef(null), dockRef = useRef(null), listRef = useRef(null);
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

  // Opened roles (lib/seen.js): the Hide filters and the "N opened" notes.
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
  // What docks is the pane's wrapper (dockRef), so that is what is measured.
  const revealWorkspace = () => {
    const pane = dockRef.current;
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
    // At once: the pane is always beside the list, so its place is
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
  // the page behind does not scroll (overflow-hidden on <body>; detail-open is the hook).
  useEffect(() => {
    const on = narrow && open;
    document.body.classList.toggle("detail-open", on);
    document.body.classList.toggle("overflow-hidden", on);
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
    return () => { document.removeEventListener("keydown", onKey); document.body.classList.remove("detail-open", "overflow-hidden"); };
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
  // arrows: focus on the list or nowhere, and no overlay open (OPEN_OVERLAY).
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
      if (document.querySelector(OPEN_OVERLAY)) return;
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

  const scrollToResults = (smooth = true) => document.getElementById("job-results-bar")?.scrollIntoView({ behavior: smooth && !reducedMotion() ? "smooth" : "auto", block: "start" });
  const goTo = (n) => { setPage(n); scrollToResults(); };

  // While the filter toolbar is pinned (sticky, under the sticky site header), the pane
  // and the divider dock under it and rows scroll into view below it: its height is
  // published as --toolbar-height (DOCK_TOP, and the page's scroll-padding-top in
  // app.css, which keeps focused and scrolled-to rows clear of both bars). At any width,
  // since the header is sticky at every width; a toolbar that is not sticky counts as 0.
  // On a phone #job-controls is the filter sheet and the pinned bar is #job-search-bar,
  // which mounts and unmounts at 720px, so it is looked up on every update.
  useEffect(() => {
    const controls = document.getElementById("job-controls");
    if (!controls) return;
    const update = () => {
      const bar = document.getElementById("job-search-bar");
      const sticky = (el) => el && getComputedStyle(el).position === "sticky";
      const pinned = sticky(controls) ? controls : sticky(bar) ? bar : null;
      document.documentElement.style.setProperty("--toolbar-height", pinned ? pinned.offsetHeight + "px" : "0px");
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(controls);
    addEventListener("resize", update); // a breakpoint can unpin the bar without resizing it
    return () => { ro.disconnect(); removeEventListener("resize", update); };
  }, [wide, jobs]);

  // The intro's pieces can each render nothing, or an empty slot (no featured company
  // today, nothing opened yet), which :empty cannot see through. So its top space is
  // given only while it has height; measured before paint, then on every change.
  const introRef = useRef(null);
  const [introShown, setIntroShown] = useState(true);
  useLayoutEffect(() => {
    const el = introRef.current;
    if (!el) return;
    const update = () => setIntroShown(el.offsetHeight > 0);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!intro]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCompany = (company) => setExpanded((s) => { const n = new Set(s); if (n.has(company)) n.delete(company); else n.add(company); return n; });

  const countText = view === "grouped"
    ? (groups.length ? `Showing ${start + 1}–${start + visibleGroups.length} of ${groups.length} companies · ${sorted.length} roles` : "0 companies · 0 roles")
    : (sorted.length ? `Showing ${start + 1}–${start + visibleJobs.length} of ${sorted.length} matching roles` : "0 matching roles");

  const noResults = (
    <Empty className="empty border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><SearchXIcon /></EmptyMedia>
        <EmptyTitle>No roles match those filters.</EmptyTitle>
        <EmptyDescription>Try a broader search, or remove a filter or two.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {/* The button disappears with the empty state, so focus goes back to the search
            box (always mounted, on a phone too) rather than falling to <body>. */}
        <Button type="button" variant="outline" size="sm" onClick={() => { reset(); document.getElementById("job-search")?.focus(); }}>Reset filters</Button>
      </EmptyContent>
    </Empty>
  );

  return (
    <>
      {jobs ? (
        <Filters dims={dims} filters={filters} onChange={setFilters} onReset={reset} canUndo={canUndo} onUndo={undo}
          total={sorted.length} naming={naming} countsFor={(d) => countsFor(jobs, filters, d, dims, filterOpts)} showSalary={country === "US"} />
      ) : (
        // The toolbar's place while the jobs load (its filters count them). It copies both
        // of Filters' layouts, switching at the same 720px and wrapping where the real bar
        // does (bones about as wide as its controls, one per main filter), so the list
        // does not jump when the jobs land.
        <div className="border-b" aria-hidden="true">
          <div className={cn(CONTAINER, "flex items-center gap-2 py-2 min-[721px]:hidden")}>
            <Bone className="h-10 min-w-0 flex-1" />
            <Bone className="h-10 w-24 shrink-0" />
          </div>
          <div className={cn(CONTAINER, "hidden flex-wrap items-center gap-2 py-3 min-[721px]:flex")}>
            <Bone className="h-8 min-w-48 flex-1 lg:w-56 lg:flex-none" />
            {/* One block below lg, separate items from lg up, as #primary-grid. */}
            <div className="flex flex-wrap items-center gap-2 lg:contents">
              {dims.filter((d) => d.group === "primary").map((d) => (
                <Bone key={d.key} className={cn("h-8", { role: "w-[72px]", city: "w-[100px]", hq: "w-[154px]", seniority: "w-[117px]", career: "w-[128px]" }[d.key] || "w-28")} />
              ))}
            </div>
            <Bone className="h-8 w-[118px]" />{/* More filters */}
            <div className="ml-auto flex items-center gap-2">
              <Bone className="h-8 w-[126px]" />{/* Saved filters */}
              <Bone className="h-8 w-[75px]" />{/* View */}
            </div>
          </div>
        </div>
      )}
      {/* Its space above only while something in it shows (introShown). */}
      {intro ? (
        <div className={cn(CONTAINER, introShown ? "pt-4" : "pt-0")}>
          <div ref={introRef} className="flex min-w-0 flex-col gap-3">{intro}</div>
        </div>
      ) : null}
      <div className={cn(CONTAINER, "pt-4 pb-8")}>
        {/* No padding on the grid itself: useColumns measures its clientWidth. */}
        <div ref={splitRef} id="results-split" style={columnStyle}
          className={cn("results-split grid items-start", wide
            ? "is-split grid-cols-[minmax(350px,var(--job-list-width,60fr))_1rem_minmax(440px,var(--job-detail-width,40fr))] gap-x-2"
            : "grid-cols-1")}>
          <div className="results-main min-w-0">
            <div className={"results-bar mb-3 flex flex-col gap-2"} id="job-results-bar" hidden={!jobs}>
              {/* Tabs and Sort share a line; useColumns keeps the list wide enough for
                  both, and wrapping is only the fallback. */}
              <div className="list-head flex flex-wrap items-center gap-x-4 gap-y-2" id="list-head">
                <div className={cn(tabsListVariants(), "view-tabs h-9 w-full sm:w-fit")} id="job-view-tabs" role="group" aria-label="List view">
                  <button type="button" className={VIEW_TAB} id="view-flat" aria-pressed={view === "flat"} onClick={() => view !== "flat" && setView("flat")}>
                    All jobs<span className="seg-n tabular font-normal text-muted-foreground" id="count-flat">{sorted.length.toLocaleString()}</span>
                  </button>
                  <button type="button" className={VIEW_TAB} id="view-grouped" aria-pressed={view === "grouped"} onClick={() => view !== "grouped" && setView("grouped")}>
                    Companies<span className="seg-n tabular font-normal text-muted-foreground" id="count-grouped">{companyCount.toLocaleString()}</span>
                  </button>
                </div>
                <div className="sort-wrap list-sort flex items-center gap-2 sm:ml-auto" id="list-sort">
                  <span aria-hidden="true" className="text-sm text-muted-foreground">Sort</span>
                  <SelectMenu id="sort-select" label="Sort roles" options={SORTS} value={filters.sort} onChange={(v) => setFilters({ ...filters, sort: v })} />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p className="results-meta tabular text-sm text-muted-foreground" id="job-count" data-total={total.toLocaleString()}>{countText}</p>
                {/* Said only where the arrows work: beside the pane, with a keyboard. */}
                <p className="results-hint flex items-center gap-1.5 text-xs text-muted-foreground" aria-hidden="true" hidden={!wide}>
                  <KbdGroup><Kbd><ArrowUpIcon /></Kbd><Kbd><ArrowDownIcon /></Kbd></KbdGroup>
                  to move between jobs
                </p>
              </div>
            </div>
            {!jobs ? (
              <>
                <p className="sr-only" role="status">Loading roles…</p>
                <ListSkeleton />
              </>
            ) : (
              <div ref={listRef} id="job-list" className={cn("job-list flex flex-col", view === "grouped" ? "gap-3" : "gap-2")}>
                {view === "flat"
                  ? (visibleJobs.length
                    ? visibleJobs.map((j) => <JobRow key={j.job_id} job={j} selected={j.job_id === selectedId} onSelect={selectJob} opened={openedByCompany.get(j.company) || 0} seen={!!seenMap[j.job_id]} />)
                    : noResults)
                  : (visibleGroups.length
                    ? visibleGroups.map((g) => (
                      <CompanyCard key={g.company} group={g} open={expanded.has(g.company)} onToggle={toggleCompany}
                        selectedId={selectedId} onSelect={selectJob} opened={openedByCompany.get(g.company) || 0} seen={seenMap} />
                    ))
                    : noResults)}
              </div>
            )}
            <Pagination page={current} pageCount={jobs ? pageCount : 1} onPage={goTo} />
          </div>
          {/* The divider: a hairline with a grip that shows on hover, focus and drag, as
              shadcn's ResizableHandle withHandle. Its behaviour is useColumns'. */}
          <div {...dividerProps}
            className={cn(dividerProps.className, "group/divider sticky flex w-4 cursor-col-resize touch-none justify-center self-start outline-none", DOCK_TOP, DOCK_HEIGHT)}>
            <span aria-hidden="true"
              className="h-full w-px bg-border transition-colors group-hover/divider:bg-ring group-focus-visible/divider:bg-ring in-[.is-resizing-columns]:bg-ring motion-reduce:transition-none" />
            <span aria-hidden="true"
              className="absolute top-1/2 left-1/2 h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ring opacity-0 transition-opacity group-hover/divider:opacity-100 group-focus-visible/divider:opacity-100 group-focus-visible/divider:ring-3 group-focus-visible/divider:ring-ring/50 in-[.is-resizing-columns]:opacity-100 motion-reduce:transition-none" />
          </div>
          {/* The pane's dock: sticky beside the list, so the pane (DetailPane, the scroll
              container) stays in view and scrolls on its own. Under 1100px it is a plain
              box and the pane opens as a sheet over the list. */}
          <div ref={dockRef}
            className={cn("job-dock min-w-0", wide && [
              "sticky self-start", DOCK_TOP, DOCK_HEIGHT,
              "[&>#job-detail]:max-h-full [&>#job-detail]:overflow-y-auto [&>#job-detail]:overscroll-contain",
              !jobs && "[&>#job-detail]:hidden",
            ])}>
            {wide && !jobs ? <PaneSkeleton /> : null}
            <DetailPane ref={paneRef} job={selected} open={open} sheet={narrow && open} narrowColumn={narrowColumn} onClose={() => closeDetail()} />
          </div>
        </div>
      </div>
      <ResumeSignInDialog />
    </>
  );
}
