// Which country's list this is: the switcher in the site header, a button with the
// country's flag and name that opens a menu of the countries, each with the cities it
// covers; and the note above the list that says why the visitor is on this list
// (lib/country.js has the rules).
import { useEffect, useState } from "react";
import { CheckIcon, ChevronsUpDownIcon, GlobeIcon, XIcon } from "lucide-react";
import { cn } from "cn";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COUNTRIES, chooseCountry, chosenCountry, countryNote, forgetSent, settleCountry } from "../lib/country.js";

/**
 * A small flag, drawn here so it looks the same on every system (emoji flags don't
 * render on Windows). Simplified to what reads at 14 px: seven stripes and a starred
 * canton for the US, three bands and the chakra for India. Drawn in the site's shades,
 * not the flags' colours: each colour takes the shade nearest its lightness (red and
 * saffron the grey, navy and green the ink, white the paper), so the shapes say which
 * country and dark mode inverts them like everything else.
 */
export function Flag({ code, className }) {
  const cls = cn("h-3.5 w-5 shrink-0 overflow-hidden rounded-[3px] ring-1 ring-border", className);
  if (code === "IN") {
    return (
      <svg viewBox="0 0 21 15" className={cls} aria-hidden="true" focusable="false">
        <rect width="21" height="5" className="fill-muted-foreground" />
        <rect y="5" width="21" height="5" className="fill-background" />
        <rect y="10" width="21" height="5" className="fill-foreground" />
        <circle cx="10.5" cy="7.5" r="1.85" fill="none" strokeWidth="0.5" className="stroke-foreground" />
        <circle cx="10.5" cy="7.5" r="0.45" className="fill-foreground" />
      </svg>
    );
  }
  // US: grey and paper stripes, the ink canton over the top four.
  const stripe = 15 / 7;
  const stars = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) stars.push([1.3 + col * 2.1 + (row % 2) * 0.9, 1.45 + row * 2.75]);
  }
  return (
    <svg viewBox="0 0 21 15" className={cls} aria-hidden="true" focusable="false">
      <rect width="21" height="15" className="fill-background" />
      {[0, 2, 4, 6].map((i) => <rect key={i} y={i * stripe} width="21" height={stripe} className="fill-muted-foreground" />)}
      <rect width="9.4" height={stripe * 4} className="fill-foreground" />
      {stars.map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="0.42" className="fill-background" />)}
    </svg>
  );
}

/**
 * The header's country control: the list's flag and name, opening a menu of the
 * countries. The menu holds links, not buttons: each country is its own page, and a
 * link can open in a new tab. Choosing one saves it as the visitor's choice
 * (chooseCountry); choosing the one already shown just closes the menu.
 *
 * `country`: the list this page shows ("US", "IN"), or null on pages that are not a
 * country's list, where the button shows the remembered choice (the US without one).
 */
export function CountrySwitcher({ country = null, className }) {
  const current = country || chosenCountry() || "US";
  const here = COUNTRIES.find((c) => c.code === current) || COUNTRIES[0];
  const [open, setOpen] = useState(false);
  // Only a list page is "here": elsewhere, choosing the remembered country still goes
  // to its list.
  const onPage = (code) => !!country && code === country;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={cn("gap-2 px-2 font-medium", className)} data-country={here.code}>
          <Flag code={here.code} />
          <span className="hidden md:inline">{here.name}</span>
          <span className="md:hidden">{here.short}</span>
          <span className="sr-only">, change country</span>
          <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={16} className="w-auto min-w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>Show jobs in</DropdownMenuLabel>
        {COUNTRIES.map((c) => {
          const isCurrent = c.code === current;
          return (
            <DropdownMenuItem key={c.code} asChild className="items-start gap-3 py-2">
              <a
                href={c.href}
                aria-current={onPage(c.code) ? "page" : undefined}
                data-country={c.code}
                onClick={(e) => {
                  chooseCountry(c.code);
                  // Already here: remember it, and just close.
                  if (onPage(c.code)) { e.preventDefault(); setOpen(false); }
                }}
              >
                <Flag code={c.code} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.detail}</span>
                </span>
                {/* A check marks which list this is. */}
                {isCurrent ? <CheckIcon className="mt-0.5" aria-hidden="true" /> : <span className="size-4 shrink-0" aria-hidden="true" />}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The dismiss button of the note: an icon, so it says what it does in a tooltip. */
function Dismiss({ label, onClick }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={label} onClick={onClick}>
          <XIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Dismiss</TooltipContent>
    </Tooltip>
  );
}

/**
 * The note above a list that says why the visitor is on it, if anything needs saying
 * (lib/country.js countryNote): on the India list when the start-up script sent them
 * there by time zone, and on the US list for a visitor on India's clock who hasn't
 * chosen. Opening the India list may also save India as the choice (settleCountry).
 */
export function CountryNote({ page }) {
  const [note, setNote] = useState(() => countryNote(page));
  useEffect(() => { settleCountry(page); }, [page]);
  if (!note) return null;

  const sent = note === "sent";
  const link = "font-medium text-foreground underline underline-offset-4 hover:text-foreground";
  return (
    <Alert role="status" className="country-note has-data-[slot=alert-action]:pr-12">
      <GlobeIcon />
      {sent ? (
        <>
          <AlertTitle>You're seeing jobs in India because your time zone is set to India.</AlertTitle>
          <AlertDescription>
            <a className={link} href="./" onClick={() => chooseCountry("US")}>Switch to US jobs</a>
          </AlertDescription>
          <AlertAction className="top-2 right-2">
            <Dismiss label="Dismiss" onClick={() => { forgetSent(); setNote(null); }} />
          </AlertAction>
        </>
      ) : (
        <>
          <AlertTitle>Find Jobs now lists engineering roles in India too.</AlertTitle>
          <AlertDescription>
            <a className={link} href="in.html" onClick={() => chooseCountry("IN")}>See jobs in India →</a>
          </AlertDescription>
          <AlertAction className="top-2 right-2">
            <Dismiss label="Dismiss and stay on US jobs" onClick={() => { chooseCountry("US"); setNote(null); }} />
          </AlertAction>
        </>
      )}
    </Alert>
  );
}
