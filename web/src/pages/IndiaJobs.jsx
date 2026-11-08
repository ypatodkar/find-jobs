// The India list (in.html): engineering roles in India, from the US investors' boards
// and Indian investors' portfolios, with the Company HQ filter.
import { useEffect, useState } from "react";
import Masthead, { PRIVACY_NOTE } from "../components/Masthead.jsx";
import { CountryNote, CountrySwitch } from "../components/Country.jsx";
import Viewed from "../components/Viewed.jsx";
import JobsWorkspace from "../JobsWorkspace.jsx";
import { loadJobs } from "../lib/jobs.js";
import { useSeen } from "../lib/seen.js";

export default function IndiaJobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { loadJobs("api/in/all-jobs.json").then(setJobs, setError); }, []);
  const seen = useSeen();
  const empty = !!error || (jobs && !jobs.length);
  const companies = jobs ? new Set(jobs.map((j) => j.company)).size : 0;

  return (
    <div className="wrap">
      <Masthead compact nav={[["about.html", "About"]]} account>
        <div className="masthead-main">
          <div className="title-row">
            {/* The switch beside it shows "India" to the eye; this says it to a screen reader. */}
            <h1 className="title">Find Jobs<span className="visually-hidden"> India</span></h1>
            <CountrySwitch current="IN" />
          </div>
          <div className="stats" id="all-stats">{error ? <span>No job data</span> : empty ? <span>No data yet</span> : null}</div>
        </div>
        <p className="dek">Engineering roles in India at VC-backed companies: Indian startups, and the Indian offices of startups based abroad. Use Company HQ to choose which.</p>
        <CountryNote page="IN" />
      </Masthead>
      <Viewed jobs={jobs} seen={seen} />
      {empty ? null : <JobsWorkspace jobs={jobs} showFirms country="IN" />}
      <div id="all-message" className="firm-message" hidden={!empty}>
        {error
          ? <><p><strong>We couldn't load the job data.</strong></p><p>Please try again shortly. Listings are updated automatically twice daily.</p></>
          : empty ? <><p><strong>No roles are available yet.</strong></p><p>Job boards are checked automatically twice daily. Please check back after the next update.</p></> : null}
      </div>
      <footer>
        <div>
          <h3>About this list</h3>
          <p id="all-note">{jobs && jobs.length
            ? `${jobs.length.toLocaleString()} roles at ${companies.toLocaleString()} companies. They come from the portfolio job boards of US and Indian investors, and from the careers pages of companies in Indian investors' portfolios. Company HQ is where most of a company's openings are.`
            : "Roles come from the portfolio job boards of US and Indian investors, and from the careers pages of companies in Indian investors' portfolios."}</p>
        </div>
        <div>
          <h3>Fresh opportunities, automatically</h3>
          <p>Job boards and careers pages are checked twice daily, so new openings appear automatically.</p>
        </div>
        {PRIVACY_NOTE}
      </footer>
    </div>
  );
}
