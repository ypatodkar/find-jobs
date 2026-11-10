// One investor's page (firm.html?id=…): that portfolio's roles, without the
// Investor filter, or a plain explanation when its board cannot be read.
//
// A title block in CONTAINER (a breadcrumb back to the directory, the firm's tier, name,
// focus and counts), then the job workspace full width, as on the jobs pages. When there
// is nothing to list (no such firm, a failed load, a board that can't be read, no
// matching roles) a single message takes the workspace's place.
import { TIER_META, VC_FIRMS } from "../data.js";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Ban, ChevronRight, CloudOff, Inbox, SearchX, TriangleAlert } from "lucide-react";
import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { Intro, Opened } from "./AllJobs.jsx";
import JobsWorkspace from "../JobsWorkspace.jsx";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { CONTAINER } from "../lib/layout.js";
import { loadFirm } from "../lib/jobs.js";
import { useSeen } from "../lib/seen.js";
import { withSource } from "../lib/outbound.js";

const UNAVAILABLE = "Listings for this investor are temporarily unavailable; its board will be checked again automatically.";
const LINK = "rounded-sm underline decoration-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring";
const FOOT_H = "mb-2 text-sm font-medium text-foreground";

export default function Firm() {
  const firmId = new URLSearchParams(location.search).get("id");
  const firm = VC_FIRMS.find((f) => f.id === firmId);
  const meta = firm && TIER_META[firm.tier];
  const [data, setData] = useState(null); // the loaded file, or { failed: true }
  const seen = useSeen();

  useEffect(() => {
    if (!firm) return;
    document.title = firm.name + " jobs — Find Jobs";
    loadFirm(firmId).then(setData, () => setData({ failed: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // `stats`: the counts under the title. `message`: what replaces the list, as
  // { icon, title, body, action }; null while loading and whenever there are roles.
  let stats = [], note = "Roles are pulled from this firm's portfolio and from each company's own job board, filtered to engineering titles across 19 US metros.", message = null;
  const jobs = data && data.status === "ok" ? data.jobs || [] : null;
  if (!firm) {
    note = "Choose an investor from the directory to see its portfolio roles and company-board listings.";
    message = {
      icon: <SearchX />,
      action: <Button asChild variant="outline" size="sm"><a href="firms.html">Browse all investors<ArrowRight data-icon="inline-end" aria-hidden="true" /></a></Button>,
    };
  } else if (data && data.failed) {
    stats = ["Listings unavailable"];
    note = UNAVAILABLE;
    message = {
      icon: <CloudOff />,
      title: "We couldn't load listings for this investor.",
      body: <>Boards are checked automatically twice daily. Please try again after the next update or <a href="firms.html">browse other investors</a>.</>,
    };
  } else if (data && data.status === "unsupported") {
    stats = ["Board unavailable for automatic checks"];
    note = "This investor does not expose a portfolio board that Find Jobs can check automatically.";
    message = {
      icon: <Ban />,
      title: "This firm's portfolio board can't be checked automatically.",
      body: data.reason || "No public job board.",
      action: firm.url ? (
        <Button asChild variant="outline" size="sm">
          <a href={withSource(firm.url)} target="_blank" rel="noopener noreferrer">{firm.urlLabel || firm.url}<ArrowUpRight data-icon="inline-end" aria-hidden="true" /></a>
        </Button>
      ) : null,
    };
  } else if (data && data.status === "error") {
    stats = ["Last update failed"];
    note = UNAVAILABLE;
    message = { icon: <TriangleAlert />, title: "Listings update failed.", body: data.reason || "Unknown error" };
  } else if (jobs) {
    const live = jobs.filter((j) => j.source === "ats").length;
    stats = [
      `${jobs.length.toLocaleString()} matching roles`,
      live ? `${live.toLocaleString()} live from company boards` : null,
      data.totalOnBoard != null ? `${data.totalOnBoard.toLocaleString()} jobs on board` : null,
    ].filter(Boolean);
    note = `Companies discovered via ${data.host}. ` + (data.atsCompanies
      ? `${data.atsCompanies} of them publish to Ashby, Greenhouse or Lever, so those ${data.fromAts} roles come straight from the company's own board; the remaining ${data.fromBoard} come from the investor's board.`
      : "Roles come from the investor's portfolio board.");
    if (!jobs.length) {
      note = "No matching engineering roles are open across this investor's tracked portfolio right now.";
      message = { icon: <Inbox />, body: "No engineering roles in the tracked metros matched on this board right now." };
    }
  }
  // The list while loading and once there are roles; otherwise only the message.
  const showList = firm && !message;

  return (
    <>
      <SiteHeader active="investors" country={null} />
      <div className={CONTAINER}>
        <header className="pt-6 pb-5 md:pt-8">
          <nav aria-label="Breadcrumb">
            <ol className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <li><a href="firms.html" className="rounded-sm transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring">Investors</a></li>
              <li aria-hidden="true"><ChevronRight className="size-3.5" /></li>
              <li className="min-w-0 truncate text-foreground" aria-current="page">{firm ? firm.name : "Firm not found"}</li>
            </ol>
          </nav>
          <p className="mt-5 text-xs font-medium tracking-wide text-muted-foreground uppercase" id="firm-tier">{firm ? meta.label : "Find Jobs"}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight outline-none" id="firm-name" tabIndex={-1}>{firm ? firm.name : "Firm not found"}</h1>
          <p className="mt-1.5 max-w-3xl text-muted-foreground" id="firm-focus">{firm ? firm.focus : "No investor matches that link. Browse the investor directory to choose one."}</p>
          {/* Each count carries a "·" in the gap to its left; the one that starts a line
              has it clipped by the overflow, so a wrapped line never begins with a dot. */}
          <div className="overflow-hidden">
            <ul className="mt-3 -ml-4 flex flex-wrap text-sm text-muted-foreground tabular empty:hidden" id="firm-stats">
              {stats.map((s) => (
                <li key={s} className="relative pl-4 before:absolute before:left-1.5 before:content-['·']">{s}</li>
              ))}
            </ul>
          </div>
        </header>
      </div>
      {showList ? (
        // Your opened roles at this firm's companies sit just above the results, as on
        // the jobs pages.
        <JobsWorkspace jobs={jobs} contextLabel={firm.short || firm.name}
          intro={<Intro><Opened jobs={jobs} seen={seen} /></Intro>} />
      ) : null}
      {message ? (
        <div className={CONTAINER}>
          <Empty id="firm-message" className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">{message.icon}</EmptyMedia>
              {message.title ? <EmptyTitle>{message.title}</EmptyTitle> : null}
              {message.body ? <EmptyDescription>{message.body}</EmptyDescription> : null}
            </EmptyHeader>
            {message.action ? <EmptyContent>{message.action}</EmptyContent> : null}
          </Empty>
        </div>
      ) : null}
      <SiteFooter>
        <section>
          <h3 className={FOOT_H}>About these roles</h3>
          <p className="leading-6" id="footer-note">{note}</p>
        </section>
        <section>
          <h3 className={FOOT_H}>Kept current for you</h3>
          <p className="leading-6">Portfolio and company job boards are checked automatically twice daily. Browse <a className={LINK} href="firms.html">all tracked investors</a> or return to <a className={LINK} href="index.html">Find Jobs</a>.</p>
        </section>
      </SiteFooter>
    </>
  );
}
