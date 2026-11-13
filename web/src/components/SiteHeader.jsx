// The site header: one sticky row on every page.
//
// <SiteHeader active="jobs" | "investors" | "about" | null  country="US" | "IN" | null  account={true}  counter={true} />
//   active:  which nav item is the current page (marked aria-current="page").
//   country: the country whose list this page shows (the jobs pages), or null on pages
//            that are not a country's list; the switcher then shows the remembered
//            choice (lib/country.js) and choosing goes to that country's list.
//   account: the account button (Google sign-in, or the signed-in menu). On by default.
//            Showing it is what makes a page ask the server who the visitor is
//            (lib/auth.js), so a page that must not ask passes account={false}.
//   counter: the live total of job clicks. On by default; About shows it in its lead
//            instead, so passes counter={false}.
//
// Left: the logo (to the visitor's country list), the country switcher, and Jobs /
// Investors / About. Right: the job-click counter (from sm up; a phone's row has no
// room for it), Feedback, the theme toggle and the account. Under md the
// three links fold into a menu at the right end and the switcher shortens to "US";
// below 380 px the logo drops its wordmark, so the row never scrolls the page sideways.
import { CompassIcon, MenuIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { CONTAINER } from "@/lib/layout.js";
import { COUNTRIES, chosenCountry } from "@/lib/country.js";
import { AccountSlot } from "./Account.jsx";
import { CountrySwitcher } from "./Country.jsx";
import { Counter, Feedback, ThemeToggle, Tip } from "./HeaderExtras.jsx";

/** The list a visitor means by "Jobs": this page's country, else the one they chose. */
function listHref(country) {
  const code = country || chosenCountry() || "US";
  return (COUNTRIES.find((c) => c.code === code) || COUNTRIES[0]).href;
}

export default function SiteHeader({ active = null, country = null, account = true, counter = true }) {
  const jobs = listHref(country);
  const nav = [
    { key: "jobs", href: jobs, label: "Jobs" },
    { key: "investors", href: "firms.html", label: "Investors" },
    { key: "about", href: "about.html", label: "About" },
  ];
  const current = (key) => (key === active ? "page" : undefined);

  return (
    <header data-slot="site-header"
      className="sticky top-0 z-40 h-(--header-height) shrink-0 border-b bg-background">
      <div className={cn(CONTAINER, "flex h-full items-center gap-1")} data-active={active || undefined} data-country={country || undefined}>
        {/* Below 380 px (a 360 px Android phone, a 375 px iPhone mini) the row cannot
            hold the wordmark beside India, Feedback, theme, account and Menu without
            pushing the page sideways, so the compass stands alone there; the words
            stay as the link's name. */}
        <a href={jobs} className="-ml-1 mr-1 flex shrink-0 items-center gap-2 rounded-md px-1 py-1 text-sm font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring">
          <CompassIcon className="size-5" aria-hidden="true" />
          <span className="max-[379px]:sr-only">Find Jobs</span>
        </a>
        <Separator orientation="vertical" className="mx-0.5 data-vertical:h-5 data-vertical:self-center md:mx-1" />
        <CountrySwitcher country={country} />

        <nav aria-label="Site" className="ml-2 hidden items-center gap-0.5 md:flex">
          {nav.map((n) => (
            <Button key={n.key} asChild variant="ghost" size="sm"
              className="text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground">
              <a href={n.href} aria-current={current(n.key)}>{n.label}</a>
            </Button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1">
          {counter ? <Counter className="mr-2 hidden sm:inline-flex" /> : null}
          <Feedback />
          <ThemeToggle />
          {account ? <AccountSlot /> : null}
          <DropdownMenu>
            <Tip label="Menu">
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" aria-label="Menu">
                  <MenuIcon />
                </Button>
              </DropdownMenuTrigger>
            </Tip>
            <DropdownMenuContent align="end" collisionPadding={16} className="w-44">
              {nav.map((n) => (
                <DropdownMenuItem key={n.key} asChild className="aria-[current=page]:bg-muted aria-[current=page]:font-medium">
                  <a href={n.href} aria-current={current(n.key)}>{n.label}</a>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
