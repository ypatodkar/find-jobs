// One role in the list: its title, company and pay, where it is, and how long ago it was
// posted. In the All jobs tab each row is a small card; inside a company card (the
// Companies tab) rows are plain lines under the company's header, which already names
// the company.
//
// The selected row is the one place the brand colour appears in the list (DESIGN.md).
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
    "job-title max-w-full rounded-sm text-[15px] leading-snug font-medium wrap-anywhere text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
    seen && "is-seen text-muted-foreground",
  );

  return (
    <article
      className={cn(
        "job group/row relative flex cursor-pointer items-start gap-x-4 gap-y-1 transition-colors motion-reduce:transition-none",
        inGroup
          // A line in a company card: indented to the company's name, and the selected
          // one marked by a bar on its left edge.
          ? "border-b px-4 py-3 last:border-b-0 hover:bg-muted/50 sm:pl-16"
          : "rounded-lg border bg-card px-4 py-3 text-card-foreground hover:bg-muted/50",
        seen && "row-seen",
        selected && "is-selected bg-brand/5 hover:bg-brand/5 dark:bg-brand/10 dark:hover:bg-brand/10",
        selected && (inGroup
          ? "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-brand"
          : "border-brand/60 ring-1 ring-brand/25"),
      )}
      data-job-id={job.job_id}
      onClick={onClick}
    >
      <div className="job-main flex min-w-0 flex-1 flex-col gap-1">
        {job.url ? (
          <a className={cn(titleClass, "self-start")} href={withSource(job.url)} target="_blank" rel="noopener noreferrer"
            data-job-id={job.job_id} data-company={job.company} data-city={job.city || ""} data-selects=""
            title={seen ? "You've opened this one" : undefined}>
            {job.title}
          </a>
        ) : <span className={titleClass}>{job.title}</span>}
        {inGroup && !pay ? null : (
          <p className="job-sub flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {inGroup ? null : <span className="job-company min-w-0 text-sm wrap-anywhere text-muted-foreground">{job.company}<AcquiredNote company={job.company} /></span>}
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
        {inGroup ? null : (
          <span className="job-company-opened text-xs text-muted-foreground empty:hidden" data-opened-for={job.company}>{openedLabel(opened)}</span>
        )}
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
