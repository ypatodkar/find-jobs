// One company in the Companies tab: its logo (or a monogram), facts, role count and
// where it is hiring; opened, its roles as rows.
import { Fragment, useState } from "react";
import { relativeDate } from "../lib/jobs.js";
import { monogram, openedLabel } from "../lib/groups.js";
import JobRow, { AcquiredNote } from "./JobRow.jsx";

const SIZE_LABELS = { "1-10": "1–10", "11-50": "11–50", "51-200": "51–200", "201-1000": "201–1,000", "1000+": "1,000+" };

export default function CompanyCard({ group: g, open, onToggle, selectedId, onSelect, opened, seen }) {
  const m = monogram(g.company);
  const [logoFailed, setLogoFailed] = useState(false);
  const n = g.jobs.length;
  const cities = [...g.cities.entries()].sort((a, b) => b[1] - a[1]);
  const facts = [
    g.size ? (SIZE_LABELS[g.size] || g.size) + " staff" : null,
    g.stage,
    g.payMax ? "up to $" + Math.round(g.payMax / 1000) + "k" : null,
    g.newest ? relativeDate(new Date(g.newest).toISOString()) : null,
  ].filter(Boolean);

  return (
    <section className={`cgroup${open ? " is-open" : ""}`}>
      <button className="cg-head" type="button" data-company={g.company} aria-expanded={open} onClick={(e) => onToggle(g.company, e.currentTarget)}>
        <span className="cg-top">
          {g.logo && !logoFailed ? (
            <span className="cg-logo"><img src={g.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setLogoFailed(true)} /></span>
          ) : <span className={`cg-mono t${m.tint}`} aria-hidden="true">{m.initials}</span>}
          <span className="cg-heading">
            <span className="cg-name">{g.company}<AcquiredNote company={g.company} />{opened ? <> <span className="job-company-opened">{openedLabel(opened)}</span></> : null}</span>
            {facts.length ? <span className="cg-facts">{facts.map((f) => <span key={f} className="cg-fact">{f}</span>)}</span> : null}
          </span>
          <span className="cg-count">{n} role{n === 1 ? "" : "s"}</span>
          <span className="cg-toggle" aria-hidden="true"></span>
        </span>
        <span className="cg-cities"><span className="cg-label">Hiring in</span>
          {cities.map(([c, k], i) => (
            <Fragment key={c || i}>{i ? <>&#8203;<span className="cg-sep">·</span></> : null}<span className="cg-city">{c}{n > 1 ? <>&nbsp;<span className="cg-n">{k}</span></> : null}</span></Fragment>
          ))}
        </span>
      </button>
      {open ? (
        <div className="cg-body">
          {g.jobs.map((j) => <JobRow key={j.job_id} job={j} inGroup selected={j.job_id === selectedId} onSelect={onSelect} seen={!!seen[j.job_id]} />)}
        </div>
      ) : null}
    </section>
  );
}
