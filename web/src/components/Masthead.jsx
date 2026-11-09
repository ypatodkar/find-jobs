// OBSOLETE after the redesign: pages render SiteHeader (the sticky header row) and
// SiteFooter (whose privacy note PRIVACY_NOTE was) directly.
//
// Kept working until no page imports it: it draws the new SiteHeader, working out the
// current page and country from the address, then the page's title and description
// (children) under it. `account` still decides whether the header shows the account
// button, as it did, so the pages that never asked the server who the visitor is still
// don't. `nav`, `extras` and `compact` are no longer used: the header's links are the
// same on every page, the heart and LinkedIn are in the footer (PRIVACY_NOTE below
// brings them along) and the click counter on About.
import { cn } from "cn";
import { CONTAINER } from "@/lib/layout.js";
import SiteHeader from "./SiteHeader.jsx";
import { FooterShared } from "./SiteFooter.jsx";

function here() {
  const page = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
  if (page === "index" || page === "in") return { active: "jobs", country: page === "in" ? "IN" : "US" };
  if (page === "firms" || page === "firm") return { active: "investors", country: null };
  if (page === "about") return { active: "about", country: null };
  return { active: null, country: null };
}

// OBSOLETE after the redesign
export default function Masthead({ account = false, children }) {
  const { active, country } = here();
  return (
    <>
      <SiteHeader active={active} country={country} account={account} />
      {children ? <div className={cn(CONTAINER, "masthead flex flex-col gap-3 py-6")}>{children}</div> : null}
    </>
  );
}

// OBSOLETE after the redesign: SiteFooter shows the note itself. Until then, the pages
// that put this in their own footer get the whole shared row (note, heart, LinkedIn),
// since the header no longer carries the heart and LinkedIn. In the frame's gutter,
// which the row's outdented icon buttons rely on.
export const PRIVACY_NOTE = <div className={cn(CONTAINER, "py-6")}><FooterShared /></div>;
