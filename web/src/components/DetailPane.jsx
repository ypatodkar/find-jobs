// The selected role: its header, then its description, as jobs-ui.js renderDetail.
// The resume match card (resume-match.js) and the slim sticky bar come in later stages;
// #detail-match is kept so the layout and styles match now.
import { createElement, useEffect, useState } from "react";
import { ROLE_LABELS, compactPay, relativeDate } from "../lib/jobs.js";
import { descriptionTree, loadDescription } from "../lib/descriptions.js";
import { AcquiredNote } from "./JobRow.jsx";

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

export default function DetailPane({ job, open }) {
  if (!job) {
    return (
      <aside className="job-detail" id="job-detail" aria-label="Job description">
        <p className="job-detail-empty">Select a job to see its description.</p>
      </aside>
    );
  }
  const pay = compactPay(job) || job.salary || "";
  const meta = [job.unlisted ? "No longer listed" : null, job.city, job.remote ? "Remote OK" : null, relativeDate(job.posted)].filter(Boolean).join(" · ");
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
    <aside className={`job-detail${open ? " is-open" : ""}`} id="job-detail" aria-label="Job description">
      <div className="detail-head" id="detail-top">
        <p className="detail-company">{job.company}<AcquiredNote company={job.company} /></p>
        <h2 className="detail-title" id="detail-title" title={job.title} tabIndex={-1}>{job.title}</h2>
        <p className="detail-meta">{meta}{pay ? ` · ${pay}` : ""}</p>
        <div className="job-tags detail-tags">
          {(job.roles || []).map((r) => <span key={r} className={`role-tag${r === "ai" ? " ai" : ""}`}>{ROLE_LABELS[r] || r}</span>)}
          {src}
        </div>
        <div className="detail-actions">{apply}</div>
      </div>
      <section className="detail-match" id="detail-match" aria-label="Resume match"></section>
      <Description job={job} />
    </aside>
  );
}
