// The selected role: its header, then its description.
//
// From 1100px the pane is a card docked beside the list, just under the header and the
// filter toolbar (--toolbar-height, which JobsWorkspace publishes), and it scrolls on
// its own while the list scrolls with the page.
//
// As on LinkedIn, the full header scrolls away with the description, and once it is out
// of view a slim bar (title, company, Save, Apply) takes its place at the top of the
// pane. The bar sits in a zero-height sticky anchor so it never pushes the text, and it
// is inert while hidden so its controls are not duplicate tab stops.
//
// Under 1100px the pane opens as a full-height sheet over the list (a dialog), with
// Back to jobs. JobsWorkspace owns the sheet's history entry, focus trap and Escape; it
// passes `sheet` while the sheet is open.
//
// Between the header and the description sits the resume match card (ResumeMatch). Both
// are keyed by the job, so each job starts with a fresh card and a fresh description,
// and the match highlights placed in the text go with it. The description's typography
// lives in styles/description.css: it is HTML we don't write.
//
// lib/ reads this DOM: jdMarks.js and ResumeMatch measure .detail-head and #detail-body
// against the pane (offsetTop, so nothing between them and the <aside> may be
// positioned), and scroll the pane itself, which is why it is a plain overflow box
// rather than a ScrollArea.
import { Suspense, createElement, forwardRef, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, Banknote, Bookmark, Clock, MapPin, MousePointerClick, Sparkles } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROLE_LABELS, compactPay, relativeDate } from "../lib/jobs.js";
import { descriptionTree, loadDescription } from "../lib/descriptions.js";
import { saved, useSaved } from "../lib/saved.js";
import { withSource } from "../lib/outbound.js";
import { AcquiredNote } from "./JobRow.jsx";
// Loaded on its own (about 18 KB gzipped with the matching code), so the first page
// load downloads less before the job list is fetched. JobsWorkspace warms it as soon as
// the jobs land, so the card is normally there by the time a role is opened.
export const preloadResumeMatch = () => import("./ResumeMatch.jsx");
const ResumeMatch = lazy(preloadResumeMatch);
import "../styles/description.css";

// The job boards companies publish to, as they write their own names.
const ATS_NAMES = {
  ashby: "Ashby",
  bamboohr: "BambooHR",
  greenhouse: "Greenhouse",
  keka: "Keka",
  lever: "Lever",
  smartrecruiters: "SmartRecruiters",
  workable: "Workable",
};
const atsName = (ats) => (ats ? ATS_NAMES[ats] || ats.charAt(0).toUpperCase() + ats.slice(1) : null);

function Tree({ nodes }) {
  return nodes.map((n, i) => (typeof n === "string" ? n : createElement(n.tag, { key: i, ...n.props }, n.children.length ? <Tree nodes={n.children} /> : undefined)));
}

// The description's HTML for a job: undefined while it loads, null if it could not.
function useDescription(id) {
  const [state, setState] = useState({ id: null, html: undefined });
  useEffect(() => {
    if (!id) return;
    let live = true;
    setState({ id, html: undefined });
    loadDescription(id).then((html) => { if (live) setState({ id, html }); });
    return () => { live = false; };
  }, [id]);
  return state.id === id ? state.html : undefined;
}

// While a description loads: a few grey lines in its shape. They wait a moment before
// fading in, so a description that arrives at once (its shard already fetched) never
// flashes them.
function DescriptionSkeleton() {
  return (
    <div className="detail-note">
      <span className="sr-only">Loading description…</span>
      <div aria-hidden="true" className="flex flex-col gap-3 animate-in fade-in fill-mode-backwards delay-200 duration-300">
        {["w-2/5", "w-full", "w-full", "w-11/12", "w-3/4", "mt-4 w-1/3", "w-full", "w-10/12"].map((w, i) => (
          <Skeleton key={i} className={cn("h-3.5 motion-reduce:animate-none", w)} />
        ))}
      </div>
    </div>
  );
}

function Description({ job, html }) {
  const tree = useMemo(() => (html ? descriptionTree(html) : null), [html]);
  const loading = html === undefined;
  let body;
  if (loading) body = <DescriptionSkeleton />;
  else if (tree) body = <Tree nodes={tree} />;
  else if (html === null) body = <p className="detail-note">The description could not be loaded. Try again in a moment, or open the posting.</p>;
  else if (job.unlisted) body = <p className="detail-note">This job is no longer on the boards we track, so its description isn't available here. The link above may still lead to the posting.</p>;
  else body = <p className="detail-note">This listing was published without a description. The posting on the company's site has the details.</p>;

  // Its look: styles/description.css (#detail-body). Closer to ResumeMatch's "Job
  // description" heading when that shows above it.
  return (
    <section className="detail-body mt-6 [.description-controls:not([hidden])+&]:mt-3" id="detail-body" aria-label="Full job description" aria-busy={loading || undefined}
      data-ready={loading ? undefined : job.job_id}>
      {body}
    </section>
  );
}

// The bookmark, in the header and in the slim bar: outlined until saved, then filled.
// Both copies read the same saved list, so they stay in step.
function SaveButton({ job, isSaved, size = "icon" }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="outline" size={size} className={cn("detail-save", isSaved && "is-saved")}
          data-save={job.job_id} aria-pressed={isSaved} aria-label={`${isSaved ? "Remove from saved jobs" : "Save job"}: ${job.title}`}
          onClick={(e) => { e.preventDefault(); saved.toggle(job); }}>
          <Bookmark aria-hidden="true" className={cn(isSaved && "fill-current")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{isSaved ? "Saved" : "Save job"}</TooltipContent>
    </Tooltip>
  );
}

// data-track-open: lib/track.js counts a click here as opening the role, with the
// company, city and title beside it. The slim bar's copy says just "Apply".
function ApplyLink({ job, compact = false }) {
  if (!job.url) return null;
  return (
    <Button asChild size={compact ? "sm" : "default"} className="detail-apply">
      <a href={withSource(job.url)} target="_blank" rel="noopener noreferrer" data-track-open=""
        data-job-id={job.job_id} data-company={job.company} data-city={job.city || ""} data-title={job.title}>
        <span>Apply{compact ? null : <span className="apply-more"> on company site</span>}</span>
        <ArrowUpRight data-icon="inline-end" aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </Button>
  );
}

// Only in the sheet: the header's says "Back to jobs", the slim bar's is the arrow alone.
// The header's is the way out on a phone, so it keeps a 40px target.
function BackButton({ onClose, compact = false }) {
  const button = (
    <Button type="button" variant="ghost" size={compact ? "icon-sm" : "lg"} aria-label="Back to jobs" onClick={onClose}
      className={cn("detail-close text-muted-foreground", compact ? "-ml-1.5" : "-ml-2.5 mb-1")}>
      <ArrowLeft aria-hidden="true" />{compact ? null : <span className="detail-close-text" aria-hidden="true">Back to jobs</span>}
    </Button>
  );
  if (!compact) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>Back to jobs</TooltipContent>
    </Tooltip>
  );
}

// Where the role came from: the company's own job board, an investor's board, or a
// saved role that has since left both.
function SourceBadge({ job }) {
  const board = atsName(job.ats);
  const [label, title] = job.unlisted
    ? ["No longer listed", "Saved earlier; no longer on the job boards"]
    : job.source === "ats"
      ? [board || "Company board", `Fetched live from ${board || "the company"}'s job board`]
      : ["VC board", "From the VC's portfolio board"];
  return (
    <Badge variant="outline" title={title} className={cn("src-tag text-muted-foreground", job.source === "ats" && !job.unlisted && "ats")}>
      {label}
    </Badge>
  );
}

const DetailPane = forwardRef(function DetailPane({ job, open, sheet, narrowColumn, onClose }, ref) {
  const own = useRef(null);
  const pane = ref || own;
  const [barShown, setBarShown] = useState(false);
  useSaved(); // repaint the bookmark when the saved list changes
  const isSaved = job ? saved.has(job.job_id) : false;
  const html = useDescription(job && job.job_id);

  // A new role starts at its top, with the full header showing.
  useEffect(() => { if (pane.current) pane.current.scrollTop = 0; setBarShown(false); }, [job && job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = pane.current, head = el && el.querySelector("#detail-top"), bar = el && el.querySelector("#detail-bar");
    if (!head || !bar) return;
    const shown = el.scrollTop > head.offsetTop + head.offsetHeight - bar.offsetHeight;
    // Hiding the bar makes it inert, which would drop focus held inside it to <body>.
    // Hand focus to the same control in the header, which is back in view.
    const active = document.activeElement;
    if (!shown && bar.contains(active)) {
      const same = ["detail-close", "detail-save", "detail-apply"].find((c) => active.closest("." + c));
      ((same && head.querySelector("." + same)) || head.querySelector("#detail-title"))?.focus({ preventScroll: true });
    }
    setBarShown(shown);
  };

  // No top padding on the pane itself: a sticky child sticks at its scroller's padding
  // edge, and the slim bar belongs at the very top. The header carries that space.
  // --pane-x is the side inset, shared by the pane and the slim bar that bleeds to its
  // edges. Scroll padding keeps whatever focus scrolls to clear of the slim bar.
  const cls = cn(
    "job-detail", open && "is-open", narrowColumn && "is-narrow-column",
    "min-w-0 overflow-y-auto overscroll-contain px-(--pane-x) pb-12 text-card-foreground [--pane-x:1rem] scroll-pt-16 [overflow-anchor:none] [scrollbar-gutter:stable]",
    // Beside the list: a card docked 12px under the toolbar, reaching 12px short of the
    // window's foot, that scrolls on its own.
    "min-[1100px]:sticky min-[1100px]:top-[calc(var(--header-height)_+_var(--toolbar-height,0px)_+_0.75rem)]",
    "min-[1100px]:h-[calc(100dvh_-_var(--header-height)_-_var(--toolbar-height,0px)_-_1.5rem)]",
    "min-[1100px]:rounded-xl min-[1100px]:border min-[1100px]:bg-card min-[1100px]:shadow-xs min-[1100px]:[--pane-x:1.5rem]",
    // Under 1100px the pane shows only as the open sheet. From a tablet's width up, the
    // sheet keeps a centred reading column (42rem) instead of hugging its left edge.
    !open && "max-[1100px]:hidden",
    sheet && "fixed inset-0 z-50 bg-background sm:[--pane-x:max(1.5rem,calc((100vw_-_42rem)/2))] motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-300 motion-safe:ease-out",
    // Nothing to sit beside until the list itself is showing.
    "[.results-split:has(#job-list[hidden])_&]:hidden",
  );

  if (!job) {
    return (
      <aside ref={pane} className={cls} id="job-detail" aria-label="Job description">
        <Empty className="job-detail-empty h-full min-h-64 p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon"><MousePointerClick aria-hidden="true" /></EmptyMedia>
            <EmptyDescription>Select a job to see its description.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </aside>
    );
  }

  const pay = compactPay(job) || job.salary || "";
  const place = [job.city, job.remote ? "Remote OK" : null].filter(Boolean).join(" · ");
  const posted = relativeDate(job.posted);
  const meta = [
    place ? { key: "place", Icon: MapPin, text: place } : null,
    posted ? { key: "posted", Icon: Clock, text: `Posted ${posted}` } : null,
    pay ? { key: "pay", Icon: Banknote, text: pay, title: job.salary && job.salary !== pay ? job.salary : undefined } : null,
  ].filter(Boolean);

  return (
    <aside ref={pane} className={cls} id="job-detail" aria-label="Job description" onScroll={onScroll}
      role={sheet ? "dialog" : undefined} aria-modal={sheet || undefined} aria-labelledby={sheet ? "detail-title" : undefined}>
      <div className="detail-bar-anchor sticky top-0 z-20 -mx-(--pane-x) h-0">
        <div id="detail-bar" inert={!barShown}
          className={cn(
            "detail-bar absolute inset-x-0 top-0 flex items-center gap-3 border-b px-(--pane-x) py-2 backdrop-blur-sm",
            sheet ? "bg-background" : "bg-card",
            barShown ? "is-shown opacity-100" : "pointer-events-none -translate-y-1.5 opacity-0",
            "motion-safe:transition-[opacity,translate] motion-safe:duration-150 motion-safe:ease-out",
          )}>
          {sheet ? <BackButton onClose={onClose} compact /> : null}
          <div className="detail-bar-text min-w-0 flex-1">
            <p className="detail-bar-title truncate text-sm font-semibold leading-5">{job.title}</p>
            <p className="detail-bar-sub truncate text-xs leading-4 text-muted-foreground">{job.company}{place ? ` · ${place}` : ""}</p>
          </div>
          <div className="detail-actions flex shrink-0 items-center gap-2">
            <SaveButton job={job} isSaved={isSaved} size="icon-sm" />
            <ApplyLink job={job} compact />
          </div>
        </div>
      </div>

      <div className="detail-head mb-6 pt-3 min-[1100px]:pt-6" id="detail-top">
        {sheet ? <BackButton onClose={onClose} /> : null}
        <p className="detail-company text-sm text-muted-foreground [&_.acquired-note]:italic">{job.company}<AcquiredNote company={job.company} /></p>
        <h2 className="detail-title mt-1 text-xl leading-tight font-semibold tracking-tight text-pretty text-foreground outline-none" id="detail-title" tabIndex={-1}>{job.title}</h2>
        {meta.length ? (
          <p className="detail-meta mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {meta.map(({ key, Icon, text, title }) => (
              <span key={key} className="inline-flex items-center gap-1.5" title={title}>
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />{text}
              </span>
            ))}
          </p>
        ) : null}
        <div className="job-tags detail-tags mt-3 flex flex-wrap items-center gap-1.5">
          {(job.roles || []).map((r) => (
            <Badge key={r} variant="secondary" className={cn("role-tag", r === "ai" && "ai")}>
              {r === "ai" ? <Sparkles data-icon="inline-start" aria-hidden="true" /> : null}{ROLE_LABELS[r] || r}
            </Badge>
          ))}
          <SourceBadge job={job} />
        </div>
        <div className="detail-actions mt-4 flex flex-wrap items-center gap-2">
          <ApplyLink job={job} />
          <SaveButton job={job} isSaved={isSaved} />
        </div>
      </div>
      <Suspense fallback={null}>
        <ResumeMatch key={`match-${job.job_id}`} job={job} paneRef={pane} description={{ ready: html !== undefined, hasText: !!html }} />
      </Suspense>
      <Description key={`desc-${job.job_id}`} job={job} html={html} />
    </aside>
  );
});

export default DetailPane;
