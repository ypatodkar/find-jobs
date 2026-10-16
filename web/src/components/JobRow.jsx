// One role in the list, with the markup and classes of jobs-ui.js jobHtml so
// styles.css applies unchanged.
import { acquirerOf, compactPay, relativeDate } from "../lib/jobs.js";

export function AcquiredNote({ company }) {
  const by = acquirerOf(company);
  return by ? <> <span className="acquired-note">(acquired by {by})</span></> : null;
}

export default function JobRow({ job, selected, onSelect }) {
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
    <article className={`job${selected ? " is-selected" : ""}`} data-job-id={job.job_id} onClick={onClick}>
      <div className="job-main">
        {job.url ? (
          <a className="job-title" href={job.url} target="_blank" rel="noopener noreferrer"
            data-job-id={job.job_id} data-company={job.company} data-city={job.city || ""} data-selects="">
            {job.title}
          </a>
        ) : <span className="job-title">{job.title}</span>}
        <p className="job-sub">
          <span className="job-company">{job.company}<AcquiredNote company={job.company} /></span>
          {pay ? <span className="job-salary" title={job.salary || undefined}>{pay}</span> : null}
        </p>
        {place ? <p className="job-meta job-place">{place}</p> : null}
      </div>
      <div className="job-side">
        {when ? <p className="job-meta job-when">{when}</p> : null}
        <span className="job-company-opened" data-opened-for={job.company}></span>
      </div>
    </article>
  );
}
