// "Companies you've opened": your own opened roles, grouped by company,
// most recent first. Joined against the job list already loaded, so it needs no
// network call and works signed out. Nothing here is sent anywhere.
//
// It sits in the jobs pages' intro (between the filter toolbar and the results): a small
// outline button with the count, which folds out a list of companies, each with up to
// four of the roles you opened there and when you last opened one.
import { Fragment, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { withSource } from "../lib/outbound.js";

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
// Underlined only on hover: with four titles separated by dots on one line, four
// permanent underlines read as one striped block rather than as separate links.
const Role = ({ r }) => (r.url ? (
  <a className="rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    href={withSource(r.url)} target="_blank" rel="noopener noreferrer">{r.title}</a>
) : r.title);

// For <time dateTime>. History comes from localStorage and account sync, so a stamp may
// not be a usable time; toISOString would throw on it and take the page down.
function iso(ts) {
  const d = new Date(Number(ts));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Nothing opened yet: no button, rather than one that opens an empty box. The empty
  // slot keeps its id but takes no room (empty:hidden).
  if (!list.length) return <div id="viewed-slot" className="empty:hidden"></div>;
  const roles = list.reduce((n, c) => n + c.roles.length, 0);
  const onOpenChange = (next) => {
    setOpen(next);
    // Opening it can push the list below the fold; bring it into view.
    if (next) requestAnimationFrame(() => panel.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }));
  };
  return (
    <div id="viewed-slot">
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="group/viewed">
            Companies you've opened
            <Badge variant="secondary" className="tabular h-5 min-w-5 px-1.5">{list.length}</Badge>
            <ChevronDown data-icon="inline-end" aria-hidden="true"
              className="text-muted-foreground transition-transform duration-150 group-data-[state=open]/viewed:rotate-180 motion-reduce:transition-none" />
          </Button>
        </CollapsibleTrigger>
        {/* data-slot is renamed from "collapsible-content": JobsWorkspace treats any open
            "*-content" slot as an overlay and pauses ↑/↓ list browsing while one is open,
            and this panel is part of the page, not an overlay over it. */}
        <CollapsibleContent ref={panel} data-slot="viewed-panel"
          className="mt-2 max-h-80 max-w-3xl overflow-y-auto rounded-xl bg-card text-sm text-card-foreground shadow-xs ring-1 ring-foreground/10">
          <p className="px-4 pt-3 pb-2 text-muted-foreground tabular">
            {roles} role{roles === 1 ? "" : "s"} across {list.length} compan{list.length === 1 ? "y" : "ies"}
          </p>
          {/* One grid for all the rows (each row a subgrid of it), so the columns line
              up from row to row. On a phone each row stacks: company and time, then roles. */}
          <ul className="divide-y border-t sm:grid sm:grid-cols-[minmax(8rem,1fr)_2fr_auto] sm:gap-x-4">
            {list.map((c) => (
              <li key={c.company}
                className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1 px-4 py-2.5 sm:col-span-3 sm:grid-cols-subgrid">
                <span className="col-start-1 row-start-1 min-w-0 font-medium wrap-anywhere">{c.company}</span>
                <span className="col-span-2 row-start-2 min-w-0 text-muted-foreground wrap-anywhere sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  {c.roles.slice(0, 4).map((r, i) => (
                    <Fragment key={i}>{i ? <span aria-hidden="true"> · </span> : null}<Role r={r} /></Fragment>
                  ))}
                  {c.roles.length > 4 ? <><span aria-hidden="true"> · </span>+{c.roles.length - 4} more</> : null}
                </span>
                <time className="col-start-2 row-start-1 text-right text-xs whitespace-nowrap text-muted-foreground sm:col-start-3"
                  dateTime={iso(c.last)}>{when(c.last)}</time>
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
