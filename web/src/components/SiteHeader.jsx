// STUB (foundation commit): the agreed API only. The full header replaces this file.
//
// <SiteHeader active="jobs" | "investors" | "about" | null  country="US" | "IN" | null />
//   active:  which nav item is the current page.
//   country: the country whose list this page shows (the jobs pages), or null on pages
//            that are not a country's list; the switcher then shows the remembered
//            choice (lib/country.js) and choosing goes to that country's list.
import { CONTAINER } from "@/lib/layout.js";

export default function SiteHeader({ active = null, country = null }) {
  return (
    <header data-slot="site-header" className="sticky top-0 z-40 h-(--header-height) border-b bg-background">
      <div className={`${CONTAINER} flex h-full items-center gap-4`} data-active={active || undefined} data-country={country || undefined}>
        <a href="./" className="text-sm font-semibold">Find Jobs</a>
      </div>
    </header>
  );
}
