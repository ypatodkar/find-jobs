// One role in the list: its title, company and pay, where it is, and how long ago it was
// posted. In the All jobs tab each row is a small card. Inside a company card (the
// Companies tab) a role is one line, title on the left and its facts on the right, under
// the company's header, which already names the company (GroupRow).
//
// The selected row: the wash with an ink outline, the one selected style (DESIGN.md).
// A role this browser has opened before (lib/seen.js) keeps a muted title and an
// "Opened" badge, so a second pass through the list skips what has been read.
import { EyeIcon, MapPinIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { acquirerOf, compactPay, relativeDate } from "../lib/jobs.js";
import { openedLabel } from "../lib/groups.js";
import { withSource } from "../lib/outbound.js";

/** "(acquired by …)" after a company's name, for companies that have been sold. */
export function AcquiredNote({ company }) {
  const by = acquirerOf(company);
  return by ? <> <span className="acquired-note font-normal whitespace-nowrap text-muted-foreground italic">(acquired by {by})</span></> : null;
}

/**
 * `inGroup`: inside a company card, where the card already names the company.
 * `opened`: how many roles at this company this browser has opened (the note under
 * the company). `seen`: this role itself has been opened before.
 */
export default function JobRow({ job, selected, onSelect, inGroup = false, opened = 0, seen = false }) {
  const pay = compactPay(job);
  const when = job.posted ? relativeDate(job.posted) : "";
  const hasPlace = !!(job.unlisted || job.city || job.remote);

  // A plain click selects the row instead of leaving the page; data-selects tells
  // lib/track.js that click is not an "opened". Modified clicks keep their browser meaning.
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onSelect(job.job_id);
  };

  // wrap-anywhere: a title with one very long word ("SoC/Microcontroller/DSP/…") wraps
  // inside the row instead of widening the page on a phone.
  const titleClass = cn(
    "job-title max-w-full rounded-sm text-[15px] leading-snug font-medium wrap-anywhere text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring",
    seen && "is-seen text-muted-foreground",
  );

  const title = job.url ? (
    <a className={cn(titleClass, "self-start")} href={withSource(job.url)} target="_blank" rel="noopener noreferrer"
      data-job-id={job.job_id} data-company={job.company} data-city={job.city || ""} data-selects=""
      title={seen ? "You've opened this one" : undefined}>
      {job.title}
    </a>
  ) : <span className={titleClass}>{job.title}</span>;

  if (inGroup) return <GroupRow job={job} title={title} pay={pay} when={when} selected={selected} seen={seen} onClick={onClick} />;

  return (
    <article
      className={cn(
        "job group/row relative flex cursor-pointer items-start gap-x-4 gap-y-1 rounded-lg border bg-card px-4 py-3 text-card-foreground transition-colors hover:bg-muted motion-reduce:transition-none",
        seen && "row-seen",
        selected && "is-selected border-foreground bg-muted hover:bg-muted",
      )}
      data-job-id={job.job_id}
      onClick={onClick}
    >
      <div className="job-main flex min-w-0 flex-1 flex-col gap-1">
        {title}
        {(
          <p className="job-sub flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="job-company min-w-0 text-sm wrap-anywhere text-muted-foreground">{job.company}<AcquiredNote company={job.company} /></span>
            {pay ? (
              <Badge variant="secondary" className="job-salary tabular max-w-full cursor-help" title={job.salary || undefined}>
                <span className="truncate">{pay}</span>
              </Badge>
            ) : null}
          </p>
        )}
        {hasPlace ? (
          <p className="job-meta job-place flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {job.unlisted ? <span className="italic">No longer listed</span> : null}
            {job.city ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 wrap-anywhere">{job.city}</span>
              </span>
            ) : null}
            {job.remote ? <Badge variant="outline" className="font-normal text-muted-foreground">Remote OK</Badge> : null}
          </p>
        ) : null}
        {/* Empty for a company never opened: :empty keeps those rows as they were. */}
        <span className="job-company-opened text-xs text-muted-foreground empty:hidden" data-opened-for={job.company}>{openedLabel(opened)}</span>
      </div>
      <div className="job-side flex shrink-0 flex-col items-end gap-1.5 pt-0.5 text-right">
        {when ? <p className="job-meta job-when text-xs whitespace-nowrap text-muted-foreground">{when}</p> : null}
        {seen ? (
          <Badge variant="outline" className="job-opened font-normal text-muted-foreground">
            <EyeIcon aria-hidden="true" />Opened
          </Badge>
        ) : null}
      </div>
    </article>
  );
}

/**
 * A role inside a company card, as a row of a small table: the title, then pay, place
 * (with "Remote" when the role allows it) and when it was posted, each in its own column
 * so the facts line up from role to role. A company that publishes no pay for any of its
 * roles gets no pay column (CompanyCard sets data-pay on the card's body), so its titles
 * keep the room. The columns appear only when the list itself is at least 42rem wide (a
 * container query on the card's body); narrower, the facts wrap under the title. The title lines up with the company's name above.
 * The selected role is a rounded highlight inset from the card's edges, the wash with
 * an ink outline like the selected card in All jobs. Same hooks as the card row:
 * article.job[data-job-id], .is-selected, .row-seen, a.job-title.
 */
function GroupRow({ job, title, pay, when, selected, seen, onClick }) {
  // A column's cell stays in the grid when empty, so the next column keeps its place;
  // in the wrapped layout an empty cell takes no room.
  const cell = "min-w-0 @max-2xl:empty:hidden";
  // "Remote" joins the city instead of taking a column of its own; a role whose city is
  // already "Remote" says it once.
  const place = [job.city, job.remote && !/^remote\b/i.test(job.city || "") ? "Remote" : null].filter(Boolean).join(" · ");
  return (
    <article
      className={cn(
        "job group/row relative mx-2 flex cursor-pointer flex-col gap-1 rounded-md px-3 py-2.5 transition-colors hover:bg-muted motion-reduce:transition-none sm:pl-[3.25rem]",
        "@2xl:grid @2xl:grid-cols-[minmax(0,1fr)_6.75rem_10.75rem_5rem] @2xl:items-center @2xl:gap-x-3 @2xl:in-data-[pay=no]:grid-cols-[minmax(0,1fr)_10.75rem_5rem]",
        seen && "row-seen",
        selected && "is-selected bg-muted ring-1 ring-foreground ring-inset hover:bg-muted",
      )}
      data-job-id={job.job_id}
      onClick={onClick}
    >
      <div className="job-main flex min-w-0 items-center gap-2">
        {title}
        {seen ? <EyeIcon aria-label="Opened" className="job-opened size-3.5 shrink-0 text-muted-foreground" /> : null}
      </div>
      <div className="job-meta flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground @2xl:contents">
        <span className={cn(cell, "job-salary tabular font-medium whitespace-nowrap text-foreground in-data-[pay=no]:hidden @2xl:text-right")} title={job.salary || undefined}>{pay || null}</span>
        <span className={cn(cell, "job-place inline-flex items-center gap-1")} title={place || undefined}>
          {job.unlisted ? <span className="italic">No longer listed</span> : place ? (
            <>
              <MapPinIcon aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{place}</span>
            </>
          ) : null}
        </span>
        <span className={cn(cell, "job-when text-xs whitespace-nowrap @2xl:text-right")}>{when || null}</span>
      </div>
    </article>
  );
}
