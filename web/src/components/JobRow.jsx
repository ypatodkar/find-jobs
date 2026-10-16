// One role in the list, with the markup and classes of jobs-ui.js jobHtml so
// styles.css applies unchanged.
import { acquirerOf, compactPay, relativeDate } from "../lib/jobs.js";
import { openedLabel } from "../lib/groups.js";

export function AcquiredNote({ company }) {
  const by = acquirerOf(company);
  return by ? <> <span className="acquired-note">(acquired by {by})</span></> : null;
}

/**
 * `inGroup`: inside a company card, where the card already names the company.
 * `seen`: this role has been opened before, which stamps the row "clicked" (seen.css).
 */
export default function JobRow({ job, selected, onSelect, inGroup = false, opened = 0, seen = false }) {
  const pay = compactPay(job);
  const place = [job.unlisted ? "No longer listed" : null, job.city, job.remote ? "Remote OK" : null].filter(Boolean).join(" · ");
  const when = job.posted ? relativeDate(job.posted) : "";

  // A plain click selects the row instead of leaving the page; data-selects tells
  // track.js that click is not an "opened". Modified clicks keep their browser meaning.
  const onClick = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onSelect(job.job_id);
  };

  return (
    <article className={`job${seen ? " row-seen" : ""}${selected ? " is-selected" : ""}`} data-job-id={job.job_id} onClick={onClick}>
      <div className="job-main">
        {job.url ? (
          <a className={`job-title${seen ? " is-seen" : ""}`} href={job.url} target="_blank" rel="noopener noreferrer"
            data-job-id={job.job_id} data-company={job.company} data-city={job.city || ""} data-selects=""
            title={seen ? "You've opened this one" : undefined}>
            {job.title}
          </a>
        ) : <span className="job-title">{job.title}</span>}
        {inGroup && !pay ? null : (
          <p className="job-sub">
            {inGroup ? null : <span className="job-company">{job.company}<AcquiredNote company={job.company} /></span>}
            {pay ? <span className="job-salary" title={job.salary || undefined}>{pay}</span> : null}
          </p>
        )}
        {place ? <p className="job-meta job-place">{place}</p> : null}
      </div>
      <div className="job-side">
        {when ? <p className="job-meta job-when">{when}</p> : null}
        {inGroup ? null : <span className="job-company-opened" data-opened-for={job.company}>{openedLabel(opened)}</span>}
      </div>
    </article>
  );
}
