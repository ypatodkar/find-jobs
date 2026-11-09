// The small things around the page: the theme toggle and the feedback form (in the
// header), the like heart (in the footer), the live click counter (on About) and the
// startup of the day (above the US list).
//
// All of them are quiet about failure: no endpoint, an unreachable API or a missing
// featured.json means the piece is simply absent, never a broken or empty one. The one
// exception is feedback that fails to send, which says so.
import { useEffect, useRef, useState } from "react";
import { ArrowRightIcon, ArrowUpRightIcon, CircleAlertIcon, HeartIcon, MessageSquareIcon, MoonIcon, SparklesIcon, SunIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ENDPOINT } from "../lib/api.js";
import { toggleTheme, useTheme } from "../lib/theme.js";
import { visitorId, visitorName } from "../lib/visitor.js";
import { withSource } from "../lib/outbound.js";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: this visit only */ } },
};

/**
 * An icon-only button says what it does twice: to screen readers, and in a tooltip.
 *
 * Radix opens a tooltip whenever its trigger gains focus, and that includes a menu or
 * popover handing focus back to the button that opened it (Escape, a choice, the
 * feedback form closing itself): the label would then float over the page, and on a
 * phone stay there. That return comes from nowhere (the focused element inside the
 * overlay is already gone, so relatedTarget is null), while tabbing onto the button
 * comes from the previous control, so only a focus with an origin opens the tooltip.
 */
export function Tip({ label, children }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild onFocus={(e) => { if (!e.relatedTarget) e.preventDefault(); }}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

// ---- theme ----
export function ThemeToggle() {
  const isDark = useTheme() === "dark";
  const label = `Switch to ${isDark ? "light" : "dark"} mode`;
  // The sun in light mode, the moon in dark: the icon shows the mode you're in, the
  // label says what pressing does.
  return (
    <Tip label={label}>
      <Button id="theme-toggle" type="button" variant="ghost" size="icon-sm" aria-label={label} aria-pressed={isDark} onClick={toggleTheme}>
        {isDark ? <MoonIcon /> : <SunIcon />}
      </Button>
    </Tip>
  );
}

// ---- the heart: given once, never taken back ----
const LIKED = "vc-directory-liked";
// One small pop when the heart is given: up, a little under, settle. Played with the
// Web Animations API, so it needs no stylesheet, and never for readers who asked for
// less motion.
const POP = [{ transform: "scale(1)" }, { transform: "scale(1.35)", offset: 0.4 }, { transform: "scale(0.94)", offset: 0.7 }, { transform: "scale(1)" }];
const lessMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Heart() {
  const [on, setOn] = useState(() => store.get(LIKED) === "1");
  const icon = useRef(null);
  const like = () => {
    if (on) return;
    store.set(LIKED, "1");
    // Fire-and-forget, like a click: the heart is already filled locally.
    const body = JSON.stringify({ user_id: visitorId(), user_name: visitorName() });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT + "/like", body);
      else fetch(ENDPOINT + "/like", { method: "POST", body, keepalive: true });
    } catch { /* the count can miss one */ }
    setOn(true);
    try { if (!lessMotion()) icon.current?.animate(POP, { duration: 420, easing: "ease" }); } catch { /* no animation, still liked */ }
  };
  return (
    <span id="heart-slot" className="inline-flex">
      <Tip label={on ? "Thanks for the love" : "Like this site"}>
        <Button type="button" variant="ghost" size="icon-sm" data-liked={on || undefined}
          className={cn("text-muted-foreground", on && "cursor-default text-foreground hover:bg-transparent dark:hover:bg-transparent")}
          aria-pressed={on} aria-label={on ? "You liked this site" : "Like this site"} onClick={like}>
          <HeartIcon ref={icon} className={cn(on && "fill-current")} />
        </Button>
      </Tip>
    </span>
  );
}

// ---- total job clicks ----
const MIN_TO_SHOW = 10; // below this it reads as "nobody is here"
export function Counter() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let live = true;
    fetch(ENDPOINT + "/stats", { credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) // offline, blocked, or down: the counter stays absent
      .then((s) => { if (live && s && typeof s.clicks === "number" && s.clicks >= MIN_TO_SHOW) setStats(s); });
    return () => { live = false; };
  }, []);
  if (!stats) return null;
  // Quiet by design: ambient reassurance that the site is in use, not a headline.
  return (
    <div id="counter-slot" className="inline-flex">
      <Tip label={`${Number(stats.jobs).toLocaleString()} different roles opened by ${Number(stats.users).toLocaleString()} people`}>
        <span tabIndex={0} className="inline-flex cursor-help items-center gap-2 rounded-md text-sm whitespace-nowrap text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground motion-safe:animate-pulse" aria-hidden="true"></span>
          <span className="tabular font-medium text-foreground">{stats.clicks.toLocaleString()}</span>
          <span>job clicks</span>
        </span>
      </Tip>
    </div>
  );
}

// ---- feedback ----
const SENT = "vc-directory-feedback-sent";
const MAX = 4000;
// Values must match TOPICS on the API; anything else is filed as "other".
const TOPICS = [
  { k: "jobs", label: "More jobs" },
  { k: "filters", label: "Filters & search" },
  { k: "design", label: "Design" },
  { k: "bug", label: "Something's broken" },
  { k: "other", label: "Something else" },
];
const THANKS = "Thank you — that's on its way to me.";

export function Feedback() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(null); // optional; never pre-ticked
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false); // sent: the thank-you shows, then the panel closes
  const [error, setError] = useState("");
  const [sent, setSent] = useState(() => store.get(SENT) === "1");
  const text = useRef(null);
  const contact = useRef(null);

  const close = () => { setOpen(false); setDone(false); setError(""); };

  // A sent message thanks, then closes itself.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(close, 1900);
    return () => clearTimeout(t);
  }, [done]);

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    const message = (text.current.value || "").trim();
    if (message.length < 2) { text.current.focus(); return; }
    const email = (contact.current.value || "").trim();
    setBusy(true);
    setError("");
    // Not sendBeacon: the reader is waiting, and the answer decides between "thanks"
    // and "that didn't send".
    fetch(ENDPOINT + "/feedback", {
      method: "POST",
      body: JSON.stringify({
        topic: topic || "other",
        message: message.slice(0, MAX),
        contact: email || null,
        user_id: visitorId(),
        user_name: visitorName(),
        page: location.pathname.split("/").pop() || "index.html",
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        store.set(SENT, "1");
        setSent(true);
        setDone(true);
        toast.success("Feedback sent", { description: THANKS });
      })
      // The form stays as it was, so the message can go again as it is.
      .catch(() => setError("That didn't send. Please try again in a moment."))
      .finally(() => setBusy(false));
  };

  // Nudges until someone has written in once.
  const nudge = !sent && !open;
  return (
    <div id="feedback-slot" className="inline-flex">
      <Popover open={open} onOpenChange={(o) => { if (o) setOpen(true); else close(); }}>
        <Tip label="Feedback">
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" className="relative" aria-label="Feedback" data-nudging={nudge || undefined}>
              <MessageSquareIcon />
              {nudge ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background" aria-hidden="true"></span> : null}
            </Button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="end" collisionPadding={16} className="w-[min(22rem,calc(100vw-2rem))] gap-3" aria-labelledby="fb-title"
          onOpenAutoFocus={(e) => { e.preventDefault(); text.current?.focus(); }}>
          {done ? (
            <p className="py-1 text-sm" role="status">{THANKS}</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm leading-snug font-medium" id="fb-title">Tell me what would make this better</p>
                <Tip label="Close">
                  <Button type="button" variant="ghost" size="icon-xs" className="-mt-0.5 -mr-1 text-muted-foreground" aria-label="Close feedback" onClick={close}>
                    <XIcon />
                  </Button>
                </Tip>
              </div>
              <form className="flex flex-col gap-3" noValidate onSubmit={submit}>
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-muted-foreground">What's it about? (optional)</span>
                  <ToggleGroup type="single" variant="outline" size="sm" spacing={1.5} className="flex-wrap"
                    aria-label="What is this about? Optional." value={topic || ""} onValueChange={(v) => setTopic(v || null)}>
                    {TOPICS.map((t) => (
                      <ToggleGroupItem key={t.k} value={t.k} data-topic={t.k}
                        className="h-7 rounded-full px-2.5 text-xs font-normal data-[state=on]:border-foreground/30 data-[state=on]:bg-muted data-[state=on]:font-medium">
                        {t.label}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <Textarea ref={text} rows={3} maxLength={MAX} className="max-h-48 min-h-20 resize-y"
                  placeholder="Anything at all — a missing company, a filter that confused you…" aria-label="Your feedback" />
                <Input ref={contact} type="email" autoComplete="email" placeholder="Email, only if you want a reply" aria-label="Your email, optional" />
                {error ? (
                  <Alert variant="destructive" className="px-3 py-2">
                    <CircleAlertIcon aria-hidden="true" />
                    <AlertDescription className="text-pretty">{error}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs leading-snug text-muted-foreground">Goes straight to me. Nothing else is attached.</span>
                  <Button type="submit" size="sm" disabled={busy}>
                    {busy ? <><Spinner aria-hidden="true" role={undefined} />Sending…</> : "Send"}
                  </Button>
                </div>
              </form>
            </>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ---- the startup of the day ----
const DAY = 86400000;
// A feature older than staleAfterDays hides itself: a month-old "featured today" is
// worse than none.
function stale(data) {
  const limit = Number(data.staleAfterDays || 0);
  if (!limit || !data.current || !data.current.featuredOn) return false;
  const when = new Date(data.current.featuredOn + "T00:00:00").getTime();
  return !!when && Date.now() - when > limit * DAY;
}

// One hand-written company above the list, through the /feature command. It has to
// read as editorial rather than as an ad: a slim, quiet card, no colour of its own.
export function Featured() {
  const [f, setF] = useState(null);
  useEffect(() => {
    let live = true;
    fetch("featured.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((data) => {
        if (!live || !data || !data.current || !data.current.company || !data.current.blurb || stale(data)) return;
        setF(data.current);
      });
    return () => { live = false; };
  }, []);

  if (!f) return <div id="featured-slot" className="empty:hidden"></div>;
  const facts = [f.staffCount ? `${f.staffCount} people` : null, f.stage || null, f.city || null].filter(Boolean).join(" · ");
  return (
    <div id="featured-slot">
      <aside aria-labelledby="featured-heading">
        <Card size="sm" className="gap-2 px-4 shadow-none">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" id="featured-heading">
            <SparklesIcon className="size-3.5" aria-hidden="true" />Startup of the day
          </p>
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-semibold">{f.company}</span>
            {facts ? <span className="text-sm text-muted-foreground">{facts}</span> : null}
          </p>
          {/* A reading measure: two sentences of prose at full width read badly. */}
          <p className="max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{f.blurb}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {f.roles ? (
              <a className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline" href={`index.html?company=${encodeURIComponent(f.company)}`}>
                {String(f.roles)} open role{f.roles === 1 ? "" : "s"}<ArrowRightIcon className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
            {f.domain ? (
              <a className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                href={withSource(/^https?:/.test(f.domain) ? f.domain : "https://" + f.domain)} target="_blank" rel="noopener noreferrer">
                {String(f.domain).replace(/^https?:\/\//, "")}<ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </p>
        </Card>
      </aside>
    </div>
  );
}
