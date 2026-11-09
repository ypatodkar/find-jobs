// The investor directory (firms.html): every tracked firm as a card, grouped
// by how central AI is to its thesis, with each firm's live role count. Only firms
// with roles to show are clickable; the rest would open a page that could only
// apologise.
//
// Above the cards: a search box, the tier as a row of toggles (with how many firms are
// in each), and two narrowing checkboxes. The cards then come in one section per tier,
// in TIER_ORDER, each firm in the order data.js lists it.
import { TIER_META as TIERS, VC_FIRMS as FIRMS } from "../data.js";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Search, SearchX, X } from "lucide-react";
import SiteHeader from "../components/SiteHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CONTAINER } from "../lib/layout.js";
import { withSource } from "../lib/outbound.js";

const TIER_ORDER = ["ai-mega", "generalist", "ai-native", "accelerator"];

const LINK = "rounded-sm underline decoration-muted-foreground/50 underline-offset-4 outline-none hover:text-foreground hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50";
const FOOT_H = "mb-2 text-sm font-medium text-foreground";

// Three dots, filled up to the firm's signal: how central AI is to its thesis.
function Signal({ signal }) {
  const label = `AI investment signal: ${signal} of 3`;
  return (
    <span className="inline-flex shrink-0 gap-1" role="img" aria-label={label} title={label}>
      {[1, 2, 3].map((i) => (
        <i key={i} aria-hidden="true" className={cn("block size-1.5 rounded-full", i <= signal ? "bg-foreground" : "bg-foreground/15")}></i>
      ))}
    </span>
  );
}

// The live role count, or why there is none. Only the count links anywhere.
function JobsBadge({ firm, r }) {
  if (!firm.id || !r) return null;
  if (r.status === "unsupported") return <Badge variant="outline" className="text-muted-foreground" title={r.reason || ""}>no board</Badge>;
  if (r.status === "error") return <Badge variant="destructive" title={r.reason || ""}>update failed</Badge>;
  if (r.count === 0) return <Badge variant="outline" className="text-muted-foreground tabular">0 roles</Badge>;
  return (
    <Badge asChild variant="secondary" className="h-6 px-2.5 tabular">
      <a href={`firm.html?id=${encodeURIComponent(firm.id)}`}>{r.count.toLocaleString()} roles<ArrowRight data-icon="inline-end" aria-hidden="true" /></a>
    </Badge>
  );
}

function FirmCard({ firm, r }) {
  const openable = !!r && r.status === "ok" && r.count > 0;
  const href = openable ? `firm.html?id=${encodeURIComponent(firm.id)}` : null;
  // Whole-card navigation; real links inside the card keep their own behaviour.
  const go = (e) => { if (href && !e.target.closest("a")) location.href = href; };
  const onKey = (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || !href || e.target.closest("a")) return;
    e.preventDefault();
    location.href = href;
  };
  let link;
  if (firm.url && firm.noBoard) {
    link = (
      <span className="text-muted-foreground">
        {firm.urlLabel} · <a className={LINK} href={withSource(firm.url)} target="_blank" rel="noopener noreferrer">no public board, visit site ↗</a>
      </span>
    );
  } else if (firm.url) {
    link = (
      <a className={cn(LINK, "inline-flex min-w-0 items-center gap-0.5 text-foreground")} href={withSource(firm.url)} target="_blank" rel="noopener noreferrer">
        <span className="truncate">{firm.urlLabel}</span><ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </a>
    );
  } else {
    link = <span className="text-muted-foreground italic">no confirmed public link — search “{firm.name}” directly</span>;
  }
  return (
    // A firm with no scrapeable board has no page worth opening, so its card must not
    // look like a link: no hover, no pointer, not in the tab order. The badge and the
    // external site link still work.
    <Card size="sm" data-name={firm.name.toLowerCase()} onClick={go} onKeyDown={onKey}
      className={cn("gap-3 outline-none", openable && "cursor-pointer transition-[background-color,box-shadow] hover:bg-muted/40 hover:ring-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none")}
      {...(openable ? { "data-href": href, tabIndex: 0, role: "link", "aria-label": `${firm.name} — view ${r.count} roles` } : {})}>
      <CardHeader>
        <CardTitle className="min-w-0 wrap-break-word">
          {firm.name}{firm.short ? <> <span className="font-normal text-muted-foreground">{firm.short}</span></> : null}
        </CardTitle>
        {firm.aum ? <CardDescription className="tabular">{firm.aum}</CardDescription> : null}
        <CardAction><Badge variant="secondary">{TIERS[firm.tier].short}</Badge></CardAction>
      </CardHeader>
      <CardContent className="flex-1 gap-2.5">
        <p className="text-muted-foreground">{firm.focus}</p>
        <div className="flex items-center gap-2">
          <Signal signal={firm.signal} />
          {firm.note ? <span className="min-w-0 text-xs text-muted-foreground">{firm.note}</span> : null}
        </div>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-x-3 gap-y-2 border-t">
        <span className="min-w-0">{link}</span>
        <JobsBadge firm={firm} r={firm.id && r} />
      </CardFooter>
    </Card>
  );
}

export default function Firms() {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [onlyBoard, setOnlyBoard] = useState(false);
  const [onlyJobs, setOnlyJobs] = useState(false);
  const [results, setResults] = useState({});
  const search = useRef(null);

  useEffect(() => {
    fetch("api/results.json").then((r) => r.json()).then((d) => setResults(d.firms || {})).catch(() => {});
  }, []);

  const counts = { all: FIRMS.length };
  TIER_ORDER.forEach((t) => { counts[t] = FIRMS.filter((f) => f.tier === t).length; });
  const chips = [{ key: "all", label: "All" }, ...TIER_ORDER.map((t) => ({ key: t, label: TIERS[t].short }))];

  const q = query.trim().toLowerCase();
  const shown = FIRMS.filter((f) => {
    if (tier !== "all" && f.tier !== tier) return false;
    if (onlyBoard && (!f.url || f.noBoard)) return false;
    if (onlyJobs) {
      const r = f.id && results[f.id];
      if (!r || r.status !== "ok" || r.count === 0) return false;
    }
    if (q && !f.name.toLowerCase().includes(q) && !(f.short || "").toLowerCase().includes(q)) return false;
    return true;
  });
  const groups = TIER_ORDER.map((t) => ({ tier: t, firms: shown.filter((f) => f.tier === t) })).filter((g) => g.firms.length);
  // The button that calls this disappears with the empty state, so focus goes back to
  // the search box rather than falling to <body>.
  const clear = () => { setQuery(""); setTier("all"); setOnlyBoard(false); setOnlyJobs(false); search.current?.focus(); };

  return (
    <>
      <SiteHeader active="investors" country={null} />
      <div className={CONTAINER}>
        <header className="pt-8 pb-6 md:pt-10">
          <h1 className="text-2xl font-semibold tracking-tight">Investors</h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            A searchable directory of US venture firms worth tracking for software roles, grouped by how central AI is to each firm's current thesis. Portfolio job boards are checked twice daily for engineering roles across 19 US metros.
          </p>
        </header>

        <div className="flex flex-col gap-3 border-b pb-4 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-4">
          <InputGroup className="lg:w-64">
            <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
            {/* The browser's own clear button is swapped for one that matches; Escape still
                clears the box, as in any search field. It is handled here rather than left to
                the browser: Firefox doesn't do it, and while the Clear button's tooltip is
                still up, Radix takes that Escape to close the tooltip (preventDefault), so
                the browser would leave the text in place. */}
            <InputGroupInput ref={search} id="search" type="search" placeholder="Search firm name…" aria-label="Search firms" autoComplete="off"
              className="[&::-webkit-search-cancel-button]:appearance-none"
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape" && query) setQuery(""); }} />
            {query ? (
              <InputGroupAddon align="inline-end">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton size="icon-xs" aria-label="Clear search" onClick={() => { setQuery(""); search.current?.focus(); }}><X /></InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent>Clear search</TooltipContent>
                </Tooltip>
              </InputGroupAddon>
            ) : null}
          </InputGroup>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by tier" id="tier-filters">
            {/* A row of choices, not on/off switches: pressing the current one keeps it. */}
            {chips.map((c) => (
              <Toggle key={c.key} variant="outline" size="sm" data-tier={c.key} pressed={c.key === tier}
                onPressedChange={() => setTier(c.key)}
                className="data-[state=on]:border-foreground/25 data-[state=on]:bg-secondary data-[state=on]:text-foreground">
                {c.label}<span className="text-muted-foreground tabular">{counts[c.key]}</span>
              </Toggle>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 lg:ml-auto">
            <div className="flex items-center gap-2">
              <Checkbox id="only-board" checked={onlyBoard} onCheckedChange={(v) => setOnlyBoard(v === true)} />
              <Label htmlFor="only-board" className="font-normal">Has a public job board</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="only-jobs" checked={onlyJobs} onCheckedChange={(v) => setOnlyJobs(v === true)} />
              <Label htmlFor="only-jobs" className="font-normal">Has matching roles</Label>
            </div>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground tabular" id="result-count" aria-live="polite">Showing {shown.length} of {FIRMS.length} firms</p>
        <div id="grid" className="flex flex-col gap-10 pt-4">
          {groups.map((g) => (
            <section key={g.tier} aria-labelledby={`tier-${g.tier}`}>
              <h2 id={`tier-${g.tier}`} className="mb-3 flex items-baseline gap-2 text-lg font-semibold tracking-tight">
                {TIERS[g.tier].label}<span className="text-sm font-normal text-muted-foreground tabular">{g.firms.length}</span>
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {g.firms.map((f) => <FirmCard key={f.id || f.name} firm={f} r={f.id ? results[f.id] : null} />)}
              </div>
            </section>
          ))}
        </div>
        <Empty id="empty-state" className="mt-2 border" hidden={shown.length !== 0}>
          <EmptyHeader>
            <EmptyMedia variant="icon"><SearchX /></EmptyMedia>
            <EmptyTitle>No firms match those filters.</EmptyTitle>
            <EmptyDescription>Try clearing the search or filters above.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={clear}>Clear search and filters</Button>
          </EmptyContent>
        </Empty>
      </div>

      <SiteFooter>
        <section>
          <h3 className={FOOT_H}>Reading this list</h3>
          <ul className="list-disc space-y-1.5 pl-5 leading-6 marker:text-muted-foreground">
            <li>Firms marked <span className="rounded-sm bg-muted px-1 py-0.5 text-xs text-foreground">no public board</span> still hire into portfolio companies — check the firm's own careers page or LinkedIn instead of a dedicated board.</li>
            <li>Most dedicated boards (Getro-powered) let you filter by role — search each one for “backend” / “software engineer” directly rather than browsing.</li>
            <li>The three signal dots show how central AI is to a firm's public investment thesis: more filled dots means a stronger AI focus, not more open jobs.</li>
            <li>AI-signal ratings reflect public reporting as of July 2026 and will shift — treat this as a starting map, not a static ranking.</li>
          </ul>
        </section>
        <section>
          <h3 className={FOOT_H}>Built for a focused search</h3>
          <p className="leading-6">Find Jobs brings investor portfolios and company career boards into one searchable directory. Listings are updated automatically twice daily.</p>
        </section>
      </SiteFooter>
    </>
  );
}
