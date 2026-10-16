// One investor's page (firm.html?id=…), as firm.js: that portfolio's roles, without the
// Investor filter, or a plain explanation when its board cannot be read.
import "../../../data.js"; // the investors, as window.VC_FIRMS and TIER_META
import { useEffect, useState } from "react";
import Masthead, { PRIVACY_NOTE } from "../components/Masthead.jsx";
import Viewed from "../components/Viewed.jsx";
import JobsWorkspace from "../JobsWorkspace.jsx";
import { loadFirm } from "../lib/jobs.js";
import { useSeen } from "../lib/seen.js";

const UNAVAILABLE = "Listings for this investor are temporarily unavailable; its board will be checked again automatically.";

export default function Firm() {
  const firmId = new URLSearchParams(location.search).get("id");
  const firm = (window.VC_FIRMS || []).find((f) => f.id === firmId);
  const meta = firm && window.TIER_META[firm.tier];
  const [data, setData] = useState(null); // the loaded file, or { failed: true }
  const seen = useSeen();

  useEffect(() => {
    if (!firm) return;
    document.title = firm.name + " jobs — Find Jobs";
    loadFirm(firmId).then(setData, () => setData({ failed: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let stats = null, note = "Roles are pulled from this firm's portfolio and from each company's own job board, filtered to engineering titles across 19 US metros.", message = null;
  const jobs = data && data.status === "ok" ? data.jobs || [] : null;
  if (!firm) {
    note = "Choose an investor from the directory to see its portfolio roles and company-board listings.";
    message = <p><a className="joblink" href="firms.html">Browse all investors →</a></p>;
  } else if (data && data.failed) {
    stats = [<span key="s">Listings unavailable</span>];
    note = UNAVAILABLE;
    message = <><p><strong>We couldn't load listings for this investor.</strong></p><p>Boards are checked automatically twice daily. Please try again after the next update or <a href="firms.html">browse other investors</a>.</p></>;
  } else if (data && data.status === "unsupported") {
    stats = [<span key="s">Board unavailable for automatic checks</span>];
    note = "This investor does not expose a portfolio board that Find Jobs can check automatically.";
    message = (
      <>
        <p><strong>This firm's portfolio board can't be checked automatically.</strong></p>
        <p>{data.reason || "No public job board."}</p>
        {firm.url ? <p><a className="joblink" href={firm.url} target="_blank" rel="noopener noreferrer">{firm.urlLabel || firm.url}</a></p> : null}
      </>
    );
  } else if (data && data.status === "error") {
    stats = [<span key="s">Last update failed</span>];
    note = UNAVAILABLE;
    message = <><p><strong>Listings update failed.</strong></p><p>{data.reason || "Unknown error"}</p></>;
  } else if (jobs) {
    const live = jobs.filter((j) => j.source === "ats").length;
    stats = [
      `${jobs.length} matching roles`,
      live ? `${live} live from company boards` : null,
      data.totalOnBoard != null ? `${data.totalOnBoard.toLocaleString()} jobs on board` : null,
    ].filter(Boolean).map((s) => <span key={s}>{s}</span>);
    note = `Companies discovered via ${data.host}. ` + (data.atsCompanies
      ? `${data.atsCompanies} of them publish to Ashby, Greenhouse or Lever, so those ${data.fromAts} roles come straight from the company's own board; the remaining ${data.fromBoard} come from the investor's board.`
      : "Roles come from the investor's portfolio board.");
    if (!jobs.length) {
      note = "No matching engineering roles are open across this investor's tracked portfolio right now.";
      message = <p>No engineering roles in the tracked metros matched on this board right now.</p>;
    }
  }
  // The list while loading and once there are roles; otherwise only the message.
  const showList = firm && !message;

  return (
    <div className="wrap">
      <Masthead nav={[["index.html", "← Find Jobs"], ["firms.html", "All investors"]]} account>
        <p className="eyebrow" id="firm-tier">{firm ? meta.label : "Find Jobs"}</p>
        <h1 className="title" id="firm-name">{firm ? firm.name : "Firm not found"}</h1>
        <p className="dek" id="firm-focus">{firm ? firm.focus : "No investor matches that link. Browse the investor directory to choose one."}</p>
        <Viewed jobs={jobs} seen={seen} />
        <div className="stats" id="firm-stats">{stats}</div>
      </Masthead>
      {showList ? <JobsWorkspace jobs={jobs} contextLabel={firm.short || firm.name} /> : null}
      <div id="firm-message" className="firm-message" hidden={!message}>{message}</div>
      <footer>
        <div>
          <h3>About these roles</h3>
          <p id="footer-note">{note}</p>
        </div>
        <div>
          <h3>Kept current for you</h3>
          <p>Portfolio and company job boards are checked automatically twice daily. Browse <a href="firms.html">all tracked investors</a> or return to <a href="index.html">Find Jobs</a>.</p>
        </div>
        {PRIVACY_NOTE}
      </footer>
    </div>
  );
}
