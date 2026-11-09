// One company in the Companies tab, as a card: its logo (or its initials), name, facts,
// role count and where it is hiring. The whole header is one button that opens the
// card to list its roles as rows (JobRow, inGroup).
//
// Opening is owned by JobsWorkspace (`open`, `onToggle`), not by the card: the first
// company opens by itself beside the list, and a role restored from history opens its
// company. So this is a plain disclosure button with aria-expanded rather than a
// Collapsible, whose open content would also count as an open overlay to the ↑ / ↓
// handler.
import { Fragment, useState } from "react";
import { ChevronDownIcon, EyeIcon, MapPinIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { compactPay, relativeDate } from "../lib/jobs.js";
import { monogram, openedLabel } from "../lib/groups.js";
import JobRow, { AcquiredNote, BELOW_TOOLBAR } from "./JobRow.jsx";

const SIZE_LABELS = { "1-10": "1–10", "11-50": "11–50", "51-200": "51–200", "201-1000": "201–1,000", "1000+": "1,000+" };

// Items separated by dots, each wrapping as a whole (a city with its count, a fact).
// The dot stays at the end of the item before it and the only break points are just
// after the dots, so a wrapped line starts flush with the one above.
function DotList({ items }) {
  return items.map(({ key, className, node }, i) => (
    <Fragment key={key}>
      {i ? <>&#8203;</> : null}
      <span className={cn("whitespace-nowrap", className)}>
        {node}{i < items.length - 1 ? <span className="cg-sep mx-1.5" aria-hidden="true">·</span> : null}
      </span>
    </Fragment>
  ));
}

export default function CompanyCard({ group: g, open, onToggle, selectedId, onSelect, opened, seen }) {
  const m = monogram(g.company);
  const [logoFailed, setLogoFailed] = useState(false);
  const n = g.jobs.length;
  // Roles without a city (a saved role no longer listed) add nothing to "Hiring in".
  const cities = [...g.cities.entries()].filter(([c]) => c).sort((a, b) => b[1] - a[1]);
  const facts = [
    g.size ? (SIZE_LABELS[g.size] || g.size) + " staff" : null,
    g.stage,
    g.payMax ? "up to $" + Math.round(g.payMax / 1000) + "k" : null,
    g.newest ? relativeDate(new Date(g.newest).toISOString()) : null,
  ].filter(Boolean);

  return (
    <section className={cn("cgroup overflow-hidden rounded-xl border bg-card text-card-foreground", open && "is-open")}>
      <button
        className={cn(
          "cg-head group/head flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none",
          BELOW_TOOLBAR,
        )}
        type="button" data-company={g.company} aria-expanded={open} onClick={(e) => onToggle(g.company, e.currentTarget)}
      >
        <span className="cg-top flex w-full items-start gap-3">
          {/* Contained, not cropped: logos are wordmarks and squares alike. Grey until
              looked at, so a column of brand colours does not shout over the list. */}
          {g.logo && !logoFailed ? (
            <span className="cg-logo grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border bg-background p-1">
              <img src={g.logo} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setLogoFailed(true)}
                className={cn("size-full object-contain opacity-80 grayscale transition motion-reduce:transition-none group-hover/head:opacity-100 group-hover/head:grayscale-0", open && "opacity-100 grayscale-0")} />
            </span>
          ) : (
            <span className="cg-mono grid size-9 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold tracking-wide text-muted-foreground" aria-hidden="true">{m.initials}</span>
          )}
          <span className="cg-heading flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="cg-name text-[15px] leading-snug font-medium [overflow-wrap:anywhere]">{g.company}<AcquiredNote company={g.company} /></span>
            {facts.length || opened ? (
              <span className="cg-facts text-sm text-muted-foreground">
                <DotList items={[
                  ...facts.map((f) => ({ key: f, className: "cg-fact", node: f })),
                  ...(opened ? [{
                    key: "opened", className: "job-company-opened",
                    node: <><EyeIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-0.15em]" />{openedLabel(opened)}</>,
                  }] : []),
                ]} />
              </span>
            ) : null}
          </span>
          <Badge variant="secondary" className="cg-count tabular mt-0.5">{n} role{n === 1 ? "" : "s"}</Badge>
          <ChevronDownIcon aria-hidden="true"
            className="cg-toggle mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded/head:rotate-180 motion-reduce:transition-none" />
        </span>
        {/* Under the name, so it lines up with it rather than with the logo. A pin, not a
            bold label: the cities are a fact like the ones above, not a heading. */}
        {cities.length ? (
          <span className="cg-cities pl-12 text-sm text-muted-foreground">
            <span className="cg-label sr-only">Hiring in </span>
            <MapPinIcon aria-hidden="true" className="mr-1 inline size-3.5 align-[-0.15em]" />
            <DotList items={cities.map(([c, k]) => ({
              key: c, className: "cg-city",
              node: <>{c}{n > 1 ? <>&nbsp;<span className="cg-n tabular text-foreground/70">{k}</span></> : null}</>,
            }))} />
          </span>
        ) : null}
      </button>
      {open ? (
        // data-pay: whether any role here shows pay, so the rows can drop an empty pay column.
        <div className="cg-body @container flex flex-col gap-0.5 border-t bg-muted/30 py-2 dark:bg-muted/20" data-pay={g.jobs.some((j) => compactPay(j)) ? "yes" : "no"}>
          {g.jobs.map((j) => <JobRow key={j.job_id} job={j} inGroup selected={j.job_id === selectedId} onSelect={onSelect} seen={!!seen[j.job_id]} />)}
        </div>
      ) : null}
    </section>
  );
}
