// The India list (in.html): engineering roles in India, from the US investors' boards
// and Indian investors' portfolios, with the Company HQ filter.
//
// The same frame as the US list (pages/AllJobs.jsx, which also supplies the empty state
// and the intro's layout), without the startup of the day, which belongs to the US list.
import { useEffect, useState } from "react";
import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { CountryNote } from "../components/Country.jsx";
import JobsWorkspace from "../JobsWorkspace.jsx";
import { Intro, NoJobs, OpenedTop } from "./AllJobs.jsx";
import { CONTAINER } from "../lib/layout.js";
import { loadJobs } from "../lib/jobs.js";
import { useSeen } from "../lib/seen.js";

const FOOT_H = "mb-2 text-sm font-medium text-foreground";
const FOOT_P = "leading-6";
const FOOT_P_NEXT = "mt-2 leading-6";

export default function IndiaJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { loadJobs("api/in/all-jobs.json").then(setJobs, setError); }, []);
  const seen = useSeen();
  const empty = !!error || (jobs && !jobs.length);
  const companies = jobs ? new Set(jobs.map((j) => j.company)).size : 0;

  const intro = (
    <Intro>
      {/* Mounted whenever the page is: it also settles which country this visitor is on. */}
      <CountryNote page="IN" />
    </Intro>
  );

  return (
    <>
      <SiteHeader active="jobs" country="IN" />
      <h1 className="sr-only">Engineering jobs at VC-backed companies in India</h1>
      <OpenedTop jobs={jobs} seen={seen} />
      {empty ? (
        <div className={`${CONTAINER} pt-4`}>
          {intro}
          <NoJobs error={!!error} />
        </div>
      ) : (
        // `jobs` is null while they load; the workspace shows its own loading rows.
        <JobsWorkspace jobs={jobs} showFirms country="IN" intro={intro} />
      )}
      <SiteFooter>
        <section>
          <h3 className={FOOT_H}>About this list</h3>
          {/* The description line from under the old title; Company HQ is the India list's own filter. */}
          <p className={FOOT_P}>Engineering roles in India at VC-backed companies: Indian startups, and the Indian offices of startups based abroad. Use Company HQ to choose which.</p>
          <p className={FOOT_P_NEXT} id="all-note">{jobs && jobs.length
            ? `${jobs.length.toLocaleString()} roles at ${companies.toLocaleString()} companies. They come from the portfolio job boards of US and Indian investors, and from the careers pages of companies in Indian investors' portfolios. Company HQ is where most of a company's openings are.`
            : "Roles come from the portfolio job boards of US and Indian investors, and from the careers pages of companies in Indian investors' portfolios."}</p>
        </section>
        <section>
          <h3 className={FOOT_H}>Fresh opportunities, automatically</h3>
          <p className={FOOT_P}>Job boards and careers pages are checked twice daily, so new openings appear automatically.</p>
        </section>
      </SiteFooter>
    </>
  );
}
