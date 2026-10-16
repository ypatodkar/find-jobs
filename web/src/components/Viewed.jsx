// "Companies you've opened", as viewed.js: your own opened roles, grouped by company,
// most recent first. Joined against the job list already loaded, so it needs no
// network call and works signed out. Nothing here is sent anywhere.
import { Fragment, useMemo, useRef, useState } from "react";

function when(ts) {
  if (!ts) return "";
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return d + " days ago";
  const m = Math.floor(d / 30);
  return m === 1 ? "1 month ago" : m + " months ago";
}

// Deliberately not a.job-title[data-job-id], which counts as opening a role: these
// have all been opened already, and a visit to your own history is not a new click.
// A role with no url stays plain text rather than a link to nowhere.
const Role = ({ r }) => (r.url ? <a className="viewed-link" href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : r.title);

export default function Viewed({ jobs, seen }) {
  const [open, setOpen] = useState(false);
  const panel = useRef(null);

  const list = useMemo(() => {
    const by = new Map();
    for (const j of jobs || []) {
      const ts = j.job_id && seen[j.job_id];
      if (!ts) continue;
      const c = j.company || "Unknown";
      if (!by.has(c)) by.set(c, { company: c, roles: [], last: 0 });
      const g = by.get(c);
      g.roles.push({ title: j.title, city: j.city, url: j.url, ts });
      if (ts > g.last) g.last = ts;
    }
    return [...by.values()].sort((a, b) => b.last - a.last || b.roles.length - a.roles.length);
  }, [jobs, seen]);

  // Nothing opened yet: no button, rather than one that opens an empty box.
  if (!list.length) return <div id="viewed-slot"></div>;
  const roles = list.reduce((n, c) => n + c.roles.length, 0);
  const toggle = () => {
    setOpen(!open);
    if (!open) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  return (
    <div id="viewed-slot">
      <button type="button" className="viewed-btn" aria-expanded={open} onClick={toggle}>
        Companies you've opened<span className="viewed-n">{list.length}</span>
        <svg className="viewed-chev" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="viewed-panel" ref={panel}>
          <p className="viewed-sum">{roles} role{roles === 1 ? "" : "s"} across {list.length} compan{list.length === 1 ? "y" : "ies"}</p>
          {list.map((c) => (
            <div className="viewed-row" key={c.company}>
              <span className="viewed-co">{c.company}</span>
              <span className="viewed-roles">
                {c.roles.slice(0, 4).map((r, i) => <Fragment key={i}>{i ? " · " : null}<Role r={r} /></Fragment>)}
                {c.roles.length > 4 ? ` · +${c.roles.length - 4} more` : null}
              </span>
              <span className="viewed-when">{when(c.last)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
