// The all-jobs page (index.html): every US role, with the Investor filter.
//
// The frame is the site header, then the job workspace full width (it lays out its own
// toolbar and results inside CONTAINER), then the footer. There is no title row: the
// header names the page, and the <h1> is for screen readers and search engines only.
// The description line that used to sit under the title opens the footer's "About this
// list" instead.
// "Companies you've opened" is at the right end of the filter toolbar (Filters). Between
// the toolbar and the results (JobsWorkspace's `intro`) sit the country note and the
// startup of the day.
import { useEffect, useMemo, useState } from "react";
import { CloudOff, Inbox } from "lucide-react";
import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { CountryNote } from "../components/Country.jsx";
import { Featured } from "../components/HeaderExtras.jsx";
import JobsWorkspace from "../JobsWorkspace.jsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CONTAINER } from "../lib/layout.js";
import { loadJobs } from "../lib/jobs.js";

// The page's footer blocks: a heading and a paragraph each (SiteFooter adds the rest).
const FOOT_H = "mb-2 text-sm font-medium text-foreground";
const FOOT_P = "leading-6";
// A second paragraph in the same block.
const FOOT_P_NEXT = "mt-2 leading-6";

/**
 * What a jobs page shows instead of the list when there is nothing to list: the data
 * failed to load (`error`), or it loaded empty. Shared with the India list.
 */
export function NoJobs({ error }) {
  return (
    <Empty id="all-message" className="my-8 border md:my-12">
      <EmptyHeader>
        <EmptyMedia variant="icon">{error ? <CloudOff /> : <Inbox />}</EmptyMedia>
        {error ? (
          <>
            <EmptyTitle>We couldn't load the job data.</EmptyTitle>
            <EmptyDescription>Please try again shortly. Listings are updated automatically twice daily.</EmptyDescription>
          </>
        ) : (
          <>
            <EmptyTitle>No roles are available yet.</EmptyTitle>
            <EmptyDescription>Job boards are checked automatically twice daily. Please check back after the next update.</EmptyDescription>
          </>
        )}
      </EmptyHeader>
    </Empty>
  );
}

/**
 * The jobs page's intro, stacked: whatever pieces have something to say. Each piece
 * either renders nothing or an empty slot (`#featured-slot`, `#viewed-slot`) when it
 * has nothing; empty slots take no room, so they leave no gap either.
 */
export function Intro({ children }) {
  return <div className="flex min-w-0 flex-col gap-3 empty:hidden [&>:empty]:hidden">{children}</div>;
}

export default function AllJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { loadJobs().then(setJobs, setError); }, []);
  const empty = !!error || (jobs && !jobs.length);
  const multi = useMemo(() => (jobs ? jobs.filter((j) => (j.firms || []).length > 1).length : 0), [jobs]);

  const intro = (
    <Intro>
      {/* Mounted whenever the page is: it also settles which country this visitor is on. */}
      <CountryNote page="US" />
      {/* One small company a day, written up by hand through the /feature command. */}
      <Featured />
    </Intro>
  );

  return (
    <>
      <SiteHeader active="jobs" country="US" />
      <h1 id="content" tabIndex={-1} className="sr-only">Engineering jobs at VC-backed companies in the United States</h1>
      {empty ? (
        <div className={`${CONTAINER} pt-4`}>
          {intro}
          <NoJobs error={!!error} />
        </div>
      ) : (
        // `jobs` is null while they load; the workspace shows its own loading rows.
        <JobsWorkspace jobs={jobs} showFirms intro={intro} />
      )}
      <SiteFooter>
        <section>
          <h3 className={FOOT_H}>About this list</h3>
          <p className={FOOT_P}>Engineering roles across all 16 tracked portfolios in a single list. Search across 19 US metros and choose the filters that fit you.</p>
          <p className={FOOT_P_NEXT} id="all-note">{jobs && jobs.length
            ? `Merged across every tracked portfolio and deduplicated on company, title, and city — ${multi.toLocaleString()} of these roles are at companies backed by more than one investor. Where a company publishes to its own applicant tracking system, that live listing is preferred over the investor's board.`
            : "Roles are merged across every tracked portfolio and deduplicated on company, title, and city. Where a company publishes to its own applicant tracking system, that live listing is preferred over the investor's board."}</p>
        </section>
        <section>
          <h3 className={FOOT_H}>Fresh opportunities, automatically</h3>
          <p className={FOOT_P}>Portfolio and company job boards are checked twice daily, so new openings appear automatically.</p>
        </section>
      </SiteFooter>
    </>
  );
}
