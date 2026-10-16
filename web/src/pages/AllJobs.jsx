// The all-jobs page (index.html), as all.js: every role, with the Investor filter.
import "../../../data.js"; // the investors, as window.VC_FIRMS and TIER_META
import { useEffect, useMemo, useState } from "react";
import Masthead, { PRIVACY_NOTE } from "../components/Masthead.jsx";
import { Featured } from "../components/HeaderExtras.jsx";
import Viewed from "../components/Viewed.jsx";
import JobsWorkspace from "../JobsWorkspace.jsx";
import { loadJobs } from "../lib/jobs.js";
import { useSeen } from "../lib/seen.js";

export default function AllJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { loadJobs().then(setJobs, setError); }, []);
  const seen = useSeen();
  const empty = !!error || (jobs && !jobs.length);
  const multi = useMemo(() => (jobs ? jobs.filter((j) => (j.firms || []).length > 1).length : 0), [jobs]);

  return (
    <div className="wrap">
      <Masthead compact nav={[["firms.html", "Browse by investor →"], ["about.html", "About"]]} account>
        <div className="masthead-main">
          <h1 className="title">Find Jobs</h1>
          <div className="stats" id="all-stats">{error ? <span>No job data</span> : empty ? <span>No data yet</span> : null}</div>
        </div>
        <p className="dek">Engineering roles across all 16 tracked portfolios in a single list. Search across 19 US metros and choose the filters that fit you.</p>
        {/* One small company a day, written up by hand through the /feature command. */}
        <Featured />
      </Masthead>
      {/* Next to the filters it belongs with, rather than up in the header. */}
      <Viewed jobs={jobs} seen={seen} />
      {empty ? null : <JobsWorkspace jobs={jobs} showFirms />}
      <div id="all-message" className="firm-message" hidden={!empty}>
        {error
          ? <><p><strong>We couldn't load the job data.</strong></p><p>Please try again shortly. Listings are updated automatically twice daily.</p></>
          : empty ? <><p><strong>No roles are available yet.</strong></p><p>Job boards are checked automatically twice daily. Please check back after the next update.</p></> : null}
      </div>
      <footer>
        <div>
          <h3>About this list</h3>
          <p id="all-note">{jobs && jobs.length
            ? `Merged across every tracked portfolio and deduplicated on company, title, and city — ${multi.toLocaleString()} of these roles are at companies backed by more than one investor. Where a company publishes to its own applicant tracking system, that live listing is preferred over the investor's board.`
            : "Roles are merged across every tracked portfolio and deduplicated on company, title, and city. Where a company publishes to its own applicant tracking system, that live listing is preferred over the investor's board."}</p>
        </div>
        <div>
          <h3>Fresh opportunities, automatically</h3>
          <p>Portfolio and company job boards are checked twice daily, so new openings appear automatically.</p>
        </div>
        {PRIVACY_NOTE}
      </footer>
    </div>
  );
}
