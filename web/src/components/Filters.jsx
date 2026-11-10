// The filter toolbar (#job-controls): the search, the main filters as faceted buttons,
// More filters (the rest, in a panel), Saved filters, Reset and Undo, and at the right
// "Companies you've opened" (Viewed, from `history`). The Hide toggles are under the
// list head (HideOpened), not here. A full-width bar,
// sticky under the site header on desktop; JobsWorkspace reads its height into
// --toolbar-height so the job pane docks below it.
//
// Under 720px the bar is the search box and a Filters button (#job-search-bar, also
// pinned under the header), and #job-controls
// becomes a bottom sheet (role="dialog") holding every filter, stacked and opening in
// place, with a footer that says how many roles they leave.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDownIcon, SearchIcon, SlidersHorizontalIcon, Undo2Icon, XIcon } from "lucide-react";
import FilterPicker from "./FilterPicker.jsx";
import SelectMenu from "./SelectMenu.jsx";
import SavedFilters from "./SavedFilters.jsx";
import Viewed from "./Viewed.jsx";
import { DATE_RANGES, SALARY_FLOORS, activeCount, advancedCount } from "../lib/filters.js";
import { CONTAINER } from "@/lib/layout.js";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** An icon-only control's tooltip (its aria-label says the same). */
function Tip({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * More filters: every filter beyond the main row, plus Posted and Salary. On desktop a
 * panel under its button, which Radix closes on Escape or a click outside (a list open
 * inside it closes first) and which never moves the results; in the phone sheet a
 * section that opens in place. Done closes it and returns focus to its button.
 */
function AdvancedFilters({ count, onReset, inline, children }) {
  const toggle = useRef(null);
  const [open, setOpen] = useState(false);
  const label = <span id="advanced-filter-label">{count ? `More filters (${count})` : "More filters"}</span>;

  if (inline) {
    const close = () => { setOpen(false); toggle.current?.focus(); };
    // A list open inside handles its own Escape first; this closes the section itself.
    const onKeyDown = (e) => {
      if (e.key !== "Escape" || !open || e.defaultPrevented) return;
      e.preventDefault(); e.stopPropagation(); close();
    };
    return (
      <Collapsible open={open} onOpenChange={setOpen} id="advanced-filters" onKeyDown={onKeyDown}>
        <CollapsibleTrigger asChild>
          <Button ref={toggle} type="button" variant="outline" aria-controls={open ? "advanced-panel" : undefined} className="h-11 w-full justify-start">
            <SlidersHorizontalIcon />{label}
            <ChevronDownIcon className="ml-auto text-muted-foreground transition-transform group-aria-expanded/button:rotate-180 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent id="advanced-panel" role="group" aria-label="More filters" className="mt-2 flex flex-col gap-2 rounded-lg border p-2">
          <div id="advanced-grid" className="flex flex-col gap-2">{children}</div>
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" id="advanced-filter-reset" className="h-11" onClick={onReset}>Reset all</Button>
            <Button type="button" variant="ghost" id="advanced-filter-done" className="h-11" onClick={close}>Done</Button>
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div id="advanced-filters" data-state={open ? "open" : "closed"}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* A disclosure of a group of controls, so not announced as a dialog. */}
          <Button ref={toggle} type="button" variant="outline" size="sm" aria-haspopup={undefined}
            aria-controls={open ? "advanced-panel" : undefined}>
            <SlidersHorizontalIcon />{label}
          </Button>
        </PopoverTrigger>
        <PopoverContent id="advanced-panel" role="group" aria-labelledby="advanced-filter-title" align="start" collisionPadding={8}
          className="max-h-(--radix-popover-content-available-height) w-[min(46rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0">
          <div className="flex items-center justify-between gap-2 border-b py-1.5 pr-1.5 pl-4">
            <h2 id="advanced-filter-title" className="text-sm font-medium">More filters</h2>
            <Button type="button" variant="ghost" size="sm" id="advanced-filter-done" onClick={() => setOpen(false)}>Done</Button>
          </div>
          <div id="advanced-grid" className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto p-4 lg:grid-cols-3">{children}</div>
          <div className="flex justify-end border-t p-1.5">
            <Button type="button" variant="ghost" size="sm" id="advanced-filter-reset" onClick={onReset}>Reset all</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---- the phone sheet ----
const MOBILE = "(max-width: 720px)";
function useMobile() {
  return useSyncExternalStore(
    (cb) => { const m = matchMedia(MOBILE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); },
    () => matchMedia(MOBILE).matches,
  );
}
const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
// offsetParent is null for anything hidden, including the inside of a closed section.
// tabindex -1 leaves out the checkboxes a filter's rows carry for scripts.
const tabbable = (root) => [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null && el.getAttribute("tabindex") !== "-1");

/**
 * The sheet's open state, scroll lock and keyboard handling. position:fixed on <body>
 * is the one scroll lock iOS Safari honours mid-gesture, so the offset is saved and
 * restored. Crossing the breakpoint never strands a locked page. A layer open above the
 * sheet (a Select's list, a tooltip) takes Escape and Tab first: Radix marks those
 * keys handled, and the sheet leaves them alone.
 */
function useDrawer(mobile, controls, toggle, closeBtn) {
  const [open, setOpen] = useState(false);
  const saved = useRef(0);
  const isOpen = mobile && open;

  useEffect(() => {
    if (!isOpen) return;
    saved.current = scrollY;
    Object.assign(document.body.style, { position: "fixed", top: `-${saved.current}px`, left: "0", right: "0", width: "100%" });
    document.body.classList.add("filter-drawer-open");
    // Not the search box: a text input would summon the keyboard over the filters.
    requestAnimationFrame(() => (closeBtn.current || tabbable(controls.current)[0])?.focus());
    const onKey = (e) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); toggle.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const items = tabbable(controls.current);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!controls.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      Object.assign(document.body.style, { position: "", top: "", left: "", right: "", width: "" });
      document.body.classList.remove("filter-drawer-open");
      scrollTo({ top: saved.current, behavior: "instant" });
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!mobile) setOpen(false); }, [mobile]);
  return [isOpen, setOpen];
}

// `showSalary`: the salary floors are in dollars, so the India list leaves them out.
export default function Filters({ dims, filters, countsFor, onChange, onReset, canUndo, onUndo, total, naming, showSalary = true, history = null }) {
  const mobile = useMobile();
  const controls = useRef(null), toggle = useRef(null), closeBtn = useRef(null), applyBtn = useRef(null), searchInput = useRef(null);
  const [drawerOpen, setDrawerOpen] = useDrawer(mobile, controls, toggle, closeBtn);
  const closeDrawer = () => { setDrawerOpen(false); toggle.current?.focus(); };
  // Reset and Undo hide once there is nothing left to reset or undo. In the sheet (a
  // modal dialog) focus then moves to the button beside them instead of leaving it.
  const staysInSheet = (fn, next) => () => {
    fn();
    requestAnimationFrame(() => { if (controls.current && !controls.current.contains(document.activeElement)) next.current?.focus(); });
  };
  const set = (patch) => onChange({ ...filters, ...patch });
  const setDim = (key, values) => onChange({ ...filters, selected: { ...filters.selected, [key]: values } });
  const picker = (d, className) => (
    <FilterPicker key={d.key} dim={d} inline={mobile} className={className} selected={filters.selected[d.key] || []}
      counts={() => countsFor(d)} onChange={(v) => setDim(d.key, v)} />
  );
  const n = activeCount(filters, dims);
  const big = mobile ? "lg" : "sm"; // 44px touch targets in the sheet

  // The right end of the desktop row ("Companies you've opened") stays on the row: if
  // it wraps below the search, the button gives up words, full -> short -> icon, and
  // last of all the search narrows ("tight").
  // All before the paint; back to full whenever the room may have grown.
  const FITS = ["full", "short", "icon", "tight"];
  const [fit, setFit] = useState(0);
  const rowEnd = useRef(null);
  useLayoutEffect(() => { setFit(0); }, [filters, mobile, history?.seen]);
  useLayoutEffect(() => {
    const end = rowEnd.current, first = document.getElementById("filter-primary");
    if (!end || !first || mobile) return;
    if (end.offsetTop > first.offsetTop + 4 && fit < FITS.length - 1) setFit(fit + 1);
  });
  useEffect(() => {
    const grow = () => setFit(0);
    addEventListener("resize", grow);
    return () => removeEventListener("resize", grow);
  }, []);

  const search = (
    // Fills the first line on mid widths, where the row wraps anyway; a set width on wide
    // ones, where the pickers (#primary-grid is display:contents there) wrap one by one
    // beside it rather than as a block below it.
    <div id="filter-primary" className={mobile ? "min-w-0 flex-1" : cn("min-w-48 flex-1 lg:flex-none", FITS[fit] === "tight" ? "lg:w-48" : "lg:w-56")}>
      <InputGroup className={mobile ? "h-10" : "h-8"}>
        {/* type=search keeps Escape-to-clear; the browser's clear glyph gives way to ours.
            On a phone the box shares its line with Filters, so a shorter placeholder,
            which still fits at 320px. */}
        <InputGroupInput ref={searchInput} id="job-search" type="search" placeholder={mobile || FITS[fit] === "tight" ? "Title or company…" : "Search title or company…"} aria-label="Search roles" autoComplete="off"
          className={cn("[&::-webkit-search-cancel-button]:appearance-none", mobile ? "h-10" : "h-8")}
          value={filters.query} onChange={(e) => set({ query: e.target.value })} />
        <InputGroupAddon><SearchIcon /></InputGroupAddon>
        {filters.query ? (
          <InputGroupAddon align="inline-end">
            <Tip label="Clear search">
              <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => { set({ query: "" }); searchInput.current?.focus(); }}>
                <XIcon />
              </InputGroupButton>
            </Tip>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
  const primary = (
    <div id="primary-grid" role="group" aria-label="Main filters" className={mobile ? "flex flex-col gap-2" : "flex flex-wrap items-center gap-2 lg:contents"}>
      {dims.filter((d) => d.group === "primary").map((d) => picker(d))}
    </div>
  );
  const advanced = (
    <AdvancedFilters count={advancedCount(filters, dims)} onReset={onReset} inline={mobile}>
      {dims.filter((d) => d.group === "advanced").map((d) => picker(d, "w-full"))}
      <SelectMenu id="date-select" label="Filter by date posted" placeholder="Posted" placeholderValue="all" size={big} className="w-full"
        options={DATE_RANGES.map((r) => ({ value: r.k, label: r.label }))} value={filters.range} onChange={(v) => set({ range: v })} />
      {showSalary ? (
        <SelectMenu id="salary-select" label="Filter by minimum salary" placeholder="Salary" placeholderValue="all" size={big} className="w-full"
          options={SALARY_FLOORS.map((s) => ({ value: s.k, label: s.label }))} value={filters.salary} onChange={(v) => set({ salary: v })} />
      ) : null}
    </AdvancedFilters>
  );
  // Words in the sheet; an icon with a tooltip in the toolbar, where the row is full.
  const undo = mobile ? (
    <Button type="button" variant="ghost" id="undo-filters" className="h-11" hidden={!canUndo} disabled={!canUndo} onClick={staysInSheet(onUndo, closeBtn)}>
      <Undo2Icon />Undo
    </Button>
  ) : (
    <Tip label="Undo the last filter change">
      <Button type="button" variant="ghost" size="icon-sm" id="undo-filters" aria-label="Undo" hidden={!canUndo} disabled={!canUndo} onClick={onUndo}>
        <Undo2Icon />
      </Button>
    </Tip>
  );
  const resetLabel = `Reset ${n} filter${n === 1 ? "" : "s"}`;

  return (
    <>
      {mobile ? (
        // Pinned under the header like the desktop toolbar, so the search and Filters stay
        // in reach deep in a long list (the old site pinned its Filters button too).
        // JobsWorkspace reads its height into --toolbar-height.
        <div id="job-search-bar" role="search" aria-label="Job search"
          className="sticky top-(--header-height) z-30 border-b bg-background">
          <div className={cn(CONTAINER, "flex items-center gap-2 py-2")}>
            {search}
            {history ? <Viewed jobs={history.jobs} seen={history.seen} compact /> : null}
            <Button ref={toggle} type="button" variant="outline" id="mobile-filter-toggle" className="h-10 shrink-0" aria-controls="job-controls"
              aria-expanded={drawerOpen} aria-label={`${drawerOpen ? "Hide" : "Show"} filters${n ? `, ${n} active` : ""}`}
              onClick={() => mobile && setDrawerOpen(!drawerOpen)}>
              {/* The count as a badge, like View's, so the search beside it keeps its width. */}
              <SlidersHorizontalIcon />Filters
              {n ? <Badge variant="secondary" className="rounded-sm px-1 font-normal tabular">{n}</Badge> : null}
            </Button>
          </div>
        </div>
      ) : null}
      {mobile ? (
        // shadcn Sheet's own overlay.
        <div id="mobile-filter-backdrop" hidden={!drawerOpen} onClick={closeDrawer}
          className="fixed inset-0 z-50 bg-black/10 duration-100 animate-in fade-in-0 supports-backdrop-filter:backdrop-blur-xs motion-reduce:animate-none" />
      ) : null}

      {/* One element at every width, so JobsWorkspace keeps measuring the same node: a
          search landmark on desktop, the sheet's dialog on a phone. */}
      <div ref={controls} id="job-controls" aria-label="Job filters"
        {...(mobile ? {
          role: "dialog", "aria-modal": true, "aria-labelledby": "filter-drawer-title", hidden: !drawerOpen,
          "data-slot": "sheet-content", "data-state": drawerOpen ? "open" : "closed",
        } : { role: "search" })}
        className={mobile
          ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] scroll-pt-16 scroll-pb-24 flex-col overflow-y-auto overscroll-contain rounded-t-xl border-t bg-background shadow-lg duration-200 animate-in slide-in-from-bottom motion-reduce:animate-none"
          : "sticky top-(--header-height) z-30 border-b bg-background"}>
        {mobile ? (
          <>
            <div className="sticky top-0 z-10 rounded-t-xl bg-background">
              <div aria-hidden="true" className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border" />
              <div className="flex items-center justify-between gap-2 border-b py-1 pr-2 pl-4">
                <h2 id="filter-drawer-title" className="text-base font-semibold">Filters</h2>
                <div className="flex items-center gap-1">
                  {undo}
                  <Button ref={closeBtn} type="button" variant="ghost" id="filter-drawer-close" className="h-11 px-3" onClick={closeDrawer}>Done</Button>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-6 px-4 py-4">
              {primary}
              {advanced}
              <div id="preset-slot"><SavedFilters filters={filters} onApply={onChange} naming={naming} inline /></div>
            </div>
            {/* The list is behind the sheet, so its footer says what the filters left. */}
            <div className="sticky bottom-0 z-10 mt-auto flex gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem_+_env(safe-area-inset-bottom,0px))]">
              <Button type="button" variant="outline" id="reset-filters" className="h-11" hidden={n === 0} onClick={staysInSheet(onReset, applyBtn)}>{resetLabel}</Button>
              <Button ref={applyBtn} type="button" variant={total === 0 ? "secondary" : "default"} id="filter-drawer-apply" className="h-11 min-w-0 flex-1" onClick={closeDrawer}>
                {total === 0 ? "No matches — adjust filters" : `Show ${total.toLocaleString()} ${total === 1 ? "role" : "roles"}`}
              </Button>
            </div>
          </>
        ) : (
          <div className={cn(CONTAINER, "flex flex-wrap items-center gap-2 py-3")}>
            {search}
            {primary}
            {advanced}
            <div id="preset-slot" className="contents"><SavedFilters filters={filters} onApply={onChange} naming={naming} /></div>
            <Button type="button" variant="ghost" size="sm" id="reset-filters" hidden={n === 0} onClick={onReset}>
              {resetLabel}<XIcon data-icon="inline-end" />
            </Button>
            {undo}
            <div ref={rowEnd} className="ml-auto flex items-center gap-2">
              {history ? <Viewed jobs={history.jobs} seen={history.seen} fit={FITS[fit] === "tight" ? "icon" : FITS[fit]} /> : null}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
