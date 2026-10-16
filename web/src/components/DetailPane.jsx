// The selected role: its header, then its description, as jobs-ui.js renderDetail.
//
// As on LinkedIn, the full header scrolls away with the description, and once it is out
// of view a slim bar (title, company, Save, Apply) takes its place at the top of the
// pane. The bar sits in a zero-height sticky anchor so it never pushes the text, and it
// is inert while hidden so its controls are not duplicate tab stops.
//
// Under 1100px the pane opens as a sheet over the list (a dialog), with Back to jobs.
// The resume match card (resume-match.js) arrives in a later stage; #detail-match is
// kept so the layout matches.
import { createElement, forwardRef, useEffect, useRef, useState } from "react";
import { ROLE_LABELS, compactPay, relativeDate } from "../lib/jobs.js";
import { descriptionTree, loadDescription } from "../lib/descriptions.js";
import { saved, useSaved } from "../lib/saved.js";
import { AcquiredNote } from "./JobRow.jsx";

const BOOKMARK = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </svg>
);

function Tree({ nodes }) {
  return nodes.map((n, i) => (typeof n === "string" ? n : createElement(n.tag, { key: i, ...n.props }, n.children.length ? <Tree nodes={n.children} /> : undefined)));
}

function Description({ job }) {
  const [state, setState] = useState({ id: null, html: undefined });
  useEffect(() => {
    let live = true;
    setState({ id: job.job_id, html: undefined });
    loadDescription(job.job_id).then((html) => { if (live) setState({ id: job.job_id, html }); });
    return () => { live = false; };
  }, [job.job_id]);

  const loading = state.id !== job.job_id || state.html === undefined;
  let body;
  if (loading) body = <p className="detail-note">Loading description…</p>;
  else if (state.html) body = <Tree nodes={descriptionTree(state.html)} />;
  else if (state.html === null) body = <p className="detail-note">The description could not be loaded. Try again in a moment, or open the posting.</p>;
  else if (job.unlisted) body = <p className="detail-note">This job is no longer on the boards we track, so its description isn't available here. The link above may still lead to the posting.</p>;
  else body = <p className="detail-note">This listing was published without a description. The posting on the company's site has the details.</p>;

  return (
    <section className="detail-body" id="detail-body" aria-label="Full job description" aria-busy={loading || undefined}
      data-ready={loading ? undefined : job.job_id}>
      {body}
    </section>
  );
}

function SaveButton({ job, isSaved }) {
  return (
    <button type="button" className={`detail-save${isSaved ? " is-saved" : ""}`} data-save={job.job_id} aria-pressed={isSaved}
      aria-label={`${isSaved ? "Remove from saved jobs" : "Save job"}: ${job.title}`} title={isSaved ? "Saved" : "Save job"}
      onClick={(e) => { e.preventDefault(); saved.toggle(job); }}>{BOOKMARK}</button>
  );
}

function BackButton({ onClose }) {
  return (
    <button type="button" className="detail-close" aria-label="Back to jobs" onClick={onClose}>
      <span aria-hidden="true">←</span><span className="detail-close-text" aria-hidden="true"> Back to jobs</span>
    </button>
  );
}

const DetailPane = forwardRef(function DetailPane({ job, open, sheet, narrowColumn, onClose }, ref) {
  const own = useRef(null);
  const pane = ref || own;
  const [barShown, setBarShown] = useState(false);
  useSaved(); // repaint the bookmark when the saved list changes
  const isSaved = job ? saved.has(job.job_id) : false;

  // A new role starts at its top, with the full header showing.
  useEffect(() => { if (pane.current) pane.current.scrollTop = 0; setBarShown(false); }, [job && job.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const el = pane.current, head = el && el.querySelector("#detail-top"), bar = el && el.querySelector("#detail-bar");
    if (!head || !bar) return;
    setBarShown(el.scrollTop > head.offsetTop + head.offsetHeight - bar.offsetHeight);
  };

  const cls = `job-detail${open ? " is-open" : ""}${narrowColumn ? " is-narrow-column" : ""}`;
  if (!job) {
    return (
      <aside ref={pane} className={cls} id="job-detail" aria-label="Job description">
        <p className="job-detail-empty">Select a job to see its description.</p>
      </aside>
    );
  }

  const pay = compactPay(job) || job.salary || "";
  const meta = [job.unlisted ? "No longer listed" : null, job.city, job.remote ? "Remote OK" : null, relativeDate(job.posted)].filter(Boolean).join(" · ");
  const place = [job.city, job.remote ? "Remote OK" : null].filter(Boolean).join(" · ");
  const src = job.unlisted
    ? <span className="src-tag" title="Saved earlier; no longer on the job boards">no longer listed</span>
    : job.source === "ats"
      ? <span className="src-tag ats" title={`Fetched live from ${job.ats || "the company"}'s job board`}>{job.ats || "ats"}</span>
      : <span className="src-tag" title="From the VC's portfolio board">vc board</span>;
  // data-track-open: track.js counts this as opening the role.
  const apply = job.url ? (
    <a className="detail-apply" href={job.url} target="_blank" rel="noopener noreferrer" data-track-open=""
      data-job-id={job.job_id} data-company={job.company} data-city={job.city || ""} data-title={job.title}>
      Apply<span className="apply-more"> on company site</span> ↗
    </a>
  ) : null;

  return (
    <aside ref={pane} className={cls} id="job-detail" aria-label="Job description" onScroll={onScroll}
      role={sheet ? "dialog" : undefined} aria-modal={sheet || undefined} aria-labelledby={sheet ? "detail-title" : undefined}>
      <div className="detail-bar-anchor">
        <div className={`detail-bar${barShown ? " is-shown" : ""}`} id="detail-bar" inert={barShown ? undefined : ""}>
          <BackButton onClose={onClose} />
          <div className="detail-bar-text">
            <p className="detail-bar-title">{job.title}</p>
            <p className="detail-bar-sub">{job.company}{place ? ` · ${place}` : ""}</p>
          </div>
          <div className="detail-actions"><SaveButton job={job} isSaved={isSaved} />{apply}</div>
        </div>
      </div>
      <div className="detail-head" id="detail-top">
        <BackButton onClose={onClose} />
        <p className="detail-company">{job.company}<AcquiredNote company={job.company} /></p>
        <h2 className="detail-title" id="detail-title" title={job.title} tabIndex={-1}>{job.title}</h2>
        <p className="detail-meta">{meta}{pay ? ` · ${pay}` : ""}</p>
        <div className="job-tags detail-tags">
          {(job.roles || []).map((r) => <span key={r} className={`role-tag${r === "ai" ? " ai" : ""}`}>{ROLE_LABELS[r] || r}</span>)}
          {src}
        </div>
        <div className="detail-actions">{apply}<SaveButton job={job} isSaved={isSaved} /></div>
      </div>
      {/* Filled by resume matching in stage 4; hidden until then rather than an empty box. */}
      <section className="detail-match" id="detail-match" aria-label="Resume match" hidden></section>
      <div className="description-controls" hidden><h3>Job description</h3></div>
      <Description job={job} />
    </aside>
  );
});

export default DetailPane;
