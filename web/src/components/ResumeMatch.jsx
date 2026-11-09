// Resume match, in the description pane: the chosen resume, an option to add another,
// and "Analyze resume", which scores it against the open job. A job opened again shows the score it already has, read back from the
// database, without calling the model.
//
// Signed out, adding a resume asks for sign-in first. Mounted once per job (DetailPane
// keys it by job id), so every per-job state starts fresh; what outlives a job (the
// resume list, the scores, today's allowance) is in lib/match.js.
//
// One shadcn Card (DESIGN.md): "Resume match" with the resume dropdown and Analyze, then,
// once analyzed, the score, the three counts, two things to review, and the full
// requirement breakdown in a modal. Green and amber (the success and warning tokens)
// mark a requirement demonstrated or partly so; nothing else here is coloured.
//
// Below the card sits the description's header, with the Match highlights switch. The
// marks that switch places in the description (lib/jdMarks.js) are styled in
// styles/match.css, since they are DOM this component does not render.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check, ChevronDown, CircleAlert, CircleCheck, CircleHelp, Contrast, Info, ListChecks, Plus, RefreshCw,
  Sparkles, TextSearch, ThumbsDown, ThumbsUp, Trash2, Upload, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toggleVariants } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { requestResumeSignIn, useAuth } from "../lib/auth.js";
import {
  Import, STATUS_LABEL, activeId, addResume, ago, cache, call, deleteResume, fetchStored, findings,
  insightSummary, json, key, loadList, ranked, setActive, untilReset,
} from "../lib/match.js";
import { annotate, clearMarks, coveredHeight, jumpTo, locate, marksEnabled, preservePosition, setMarksEnabled } from "../lib/jdMarks.js";
import "../styles/match.css";

// shadcn's Spinner is a status region named "Loading". Here it sits beside words that
// already say what is happening (inside a button, or a status line), so it is drawn
// only, and those words are what a screen reader hears.
const Busy = ({ className }) => <Spinner role={undefined} aria-label={undefined} aria-hidden="true" className={className} />;

const INSIGHT_LIMIT = 2;
const ROW_STATUS = { shown: "Demonstrated", partial: "Partial", unclear: "Not found" };
const GROUPS = [["required", "Required"], ["preferred", "Preferred"], ["duty", "Responsibilities"], ["other", "Other requirements"]];
const inGroup = (kind, f) => (kind === "other" ? !["required", "preferred", "duty"].includes(f.kind) : f.kind === kind);

// Each status's icon and colours, the same everywhere in the card. Amber is too light
// for small text on white, so amber text is mixed a quarter of the way to the
// foreground: darker in light mode, lighter in dark, readable in both.
const STATUS_ICON = { shown: CircleCheck, partial: Contrast, unclear: CircleHelp };
const TONE = {
  shown: {
    text: "text-success",
    badge: "border-success/25 bg-success/10 text-success",
  },
  partial: {
    text: "text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]",
    badge: "border-warning/30 bg-warning/10 text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]",
  },
  unclear: {
    text: "text-muted-foreground",
    badge: "border-border bg-muted text-muted-foreground",
  },
};
const StatusIcon = ({ status, className }) => {
  const Icon = STATUS_ICON[status] || CircleHelp;
  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", status === "partial" && "[&_path]:fill-current", TONE[status]?.text, className)} />;
};

// A <summary> drawn as shadcn's Select trigger, and a <details> panel drawn as its
// menu. The browser's disclosure triangle is hidden.
const SUMMARY_RESET = "list-none [&::-webkit-details-marker]:hidden";
const MENU_ITEM = "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50";

// Arrow keys open the resume dropdown, then walk its rows, delete buttons included;
// Escape closes it. Returns whether the key was the dropdown's.
function pickerKeydown(event) {
  const picker = event.target.closest(".resume-picker");
  if (!picker) return false;
  const summary = picker.firstElementChild;
  if (!picker.open) {
    if (event.target !== summary || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return false;
    event.preventDefault();
    if (!picker.classList.contains("is-disabled")) picker.open = true;
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault(); event.stopPropagation();
    picker.open = false; summary.focus({ preventScroll: true });
    return true;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
  const list = [...picker.querySelectorAll(".resume-picker-panel button:not(:disabled)")];
  const at = list.indexOf(document.activeElement);
  const next = event.key === "Home" ? list[0] : event.key === "End" ? list[list.length - 1]
    : list[Math.max(0, Math.min(list.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
  event.preventDefault(); next?.focus();
  return true;
}

// One dropdown for everything about resumes: pick one, delete any from its own row, or
// add another from the foot of the list. Drawn like shadcn's Select, but by hand on
// <details>, since a Select cannot hold the delete buttons and the add action, and the
// keyboard path above (and the browser test) rely on this structure.
function ResumePicker({ selected, disabled, onChoose, onRemove, onAdd }) {
  const ref = useRef(null);
  const items = cache.items;
  const active = items.find((r) => r.id === selected);
  const label = active ? active.label : items.length ? "Select resume" : "No resumes yet";
  const close = () => { if (ref.current) ref.current.open = false; };
  // Opening the dropdown puts focus on the chosen resume, as SelectMenu does.
  const onToggle = () => {
    const p = ref.current;
    if (!p || !p.open) return;
    if (disabled) { p.open = false; return; }
    (p.querySelector(".select-option.is-selected") || p.querySelector(".select-option, .resume-picker-add"))?.focus({ preventScroll: true });
  };
  return (
    <details ref={ref} className={cn("company-picker select-picker resume-picker group/picker relative w-full", disabled && "is-disabled")} onToggle={onToggle}>
      <summary aria-haspopup="true" aria-label={`Resume: ${label}`} title={label} aria-disabled={disabled ? "true" : undefined}
        className={cn(SUMMARY_RESET, "flex h-8 w-full cursor-pointer items-center justify-between gap-1.5 rounded-md border border-input bg-transparent pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none select-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring aria-disabled:pointer-events-none aria-disabled:opacity-50")}>
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-open/picker:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="company-panel select-panel resume-picker-panel absolute top-full left-0 z-30 mt-1 flex w-72 flex-col max-w-[calc(100vw-2rem)] gap-0.5 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-border"
        role="group" aria-label="Your resumes">
        {items.map((r) => (
          <div className="resume-picker-row flex items-center gap-1" key={r.id}>
            <button type="button" className={cn("select-option relative", MENU_ITEM, "min-w-0 flex-1 pr-8", r.id === selected && "is-selected font-medium")}
              data-act="choose" data-resume-id={r.id} aria-pressed={r.id === selected} aria-label={r.label} title={r.label} disabled={disabled}
              onClick={() => { close(); onChoose(r.id); }}>
              <span className="min-w-0 truncate">{r.label}</span>
              {r.id === selected ? <Check aria-hidden="true" className="absolute right-2 size-4" /> : null}
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="resume-picker-delete text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive dark:hover:bg-destructive/20"
                  data-act="remove" data-resume-id={r.id} aria-label={`Delete ${r.label}`} disabled={disabled} onClick={() => onRemove(r.id)}>
                  <Trash2 aria-hidden="true" className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Delete resume</TooltipContent>
            </Tooltip>
          </div>
        ))}
        {items.length ? <div className="-mx-1 my-0.5 h-px bg-border" aria-hidden="true"></div> : null}
        <button type="button" className={cn("resume-picker-add", MENU_ITEM)} data-act="upload" disabled={disabled} onClick={() => { close(); onAdd(); }}>
          <Plus aria-hidden="true" className="size-4 text-muted-foreground" />Add resume
        </button>
      </div>
    </details>
  );
}

// "Find in JD" for a requirement the description holds exactly once; otherwise the
// fallback text beside it.
function Locate({ text, mappable, onJump, children, fallback, label, className }) {
  const mapped = mappable.has(text);
  return (
    <>
      <a className={cn("requirement-locate rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring", className)} href="#detail-body"
        data-passage={text} aria-label={label} hidden={!mapped}
        onClick={(e) => { e.preventDefault(); onJump(text); }}>{children}</a>
      <span hidden={mapped}>{fallback}</span>
    </>
  );
}

function Notes({ result }) {
  const limits = (result && result.limits) || {};
  return [
    limits.resumeShortened ? "Only the first part of the resume was assessed." : limits.resumeQuotesCapped ? "The resume was read in full; supporting quotes are limited to its first 100 lines." : "",
    limits.descriptionShortened ? "Only the first part of the description was read in full." : "",
    limits.requirementsCapped ? "Only the 30 most important extracted items were compared." : "",
  ].filter(Boolean).map((n) => <p key={n} className="match-fine text-muted-foreground">{n}</p>);
}

function Insights({ rows, mappable, onJump }) {
  const chosen = rows.slice(0, 1);
  const second = rows.find((f) => f !== chosen[0] && f.status === "shown") ||
    rows.find((f) => f !== chosen[0] && f.status === "partial") || rows[1];
  if (second) chosen.push(second);
  return (
    <section className="analysis-insights-section grid gap-2" aria-labelledby="analysis-insights-title">
      <h4 id="analysis-insights-title" className="text-sm font-medium">Key things to review</h4>
      <ul className="analysis-insights grid gap-2" aria-label="Prioritized insights">
        {chosen.slice(0, INSIGHT_LIMIT).map((f, i) => {
          const text = insightSummary(f.text);
          const lead = { shown: "Supported", partial: "Clarify evidence", unclear: "Review evidence" }[f.status];
          return (
            <li key={i} title={f.text} className="flex gap-3 rounded-lg bg-muted px-3 py-2.5">
              <StatusIcon status={f.status} className="mt-px" />
              <div className="grid min-w-0 gap-0.5">
                <span className="insight-lead text-xs font-medium text-muted-foreground">{lead}</span>
                <div className="insight-copy text-sm leading-snug wrap-anywhere">
                  <Locate text={f.text} mappable={mappable} onJump={onJump} label={`Find in job description: ${f.text}`} fallback={text}
                    className="text-foreground underline decoration-muted-foreground underline-offset-4 hover:decoration-foreground">{text}</Locate>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// shadcn's Skeleton, whose pulse stops for anyone who asks for reduced motion.
const Shape = ({ className }) => <Skeleton className={cn("motion-reduce:animate-none", className)} />;

// Placeholder shapes while a score is on its way, roughly where the score, the three
// counts and the two insights will land, so the card grows once rather than twice.
function ResultSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      <div className="flex items-center gap-4"><Shape className="h-8 w-20" /><div className="grid flex-1 gap-2"><Shape className="h-4 w-40" /><Shape className="h-1.5 w-full" /></div></div>
      <div className="grid grid-cols-3 gap-2"><Shape className="h-14" /><Shape className="h-14" /><Shape className="h-14" /></div>
      <Shape className="h-14 w-full" />
    </div>
  );
}

const LOADING_LINE = "analysis-loading flex items-center gap-2 text-sm text-muted-foreground";

export default function ResumeMatch({ job, paneRef, description }) {
  const { ready, account } = useAuth();
  const host = useRef(null);
  const dialog = useRef(null);
  const input = useRef(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const focusAfter = useRef(null); // a selector to focus once the card has redrawn
  const breakdownReturn = useRef(0);
  const descRef = useRef(description);
  descRef.current = description;

  const [s, setS] = useState({
    busy: "loading", message: null, loaded: false, signedOut: false,
    breakdownOpen: false, breakdownFilter: "all", expanded: new Set(),
    showToolbar: false, unlockError: null, pending: new Set(), reviewErrors: new Map(), tick: 0,
  });
  const sRef = useRef(s);
  const update = (patch) => {
    sRef.current = { ...sRef.current, ...patch, tick: sRef.current.tick + 1 };
    if (mounted.current) setS(sRef.current);
  };
  const [marksOn, setMarksOn] = useState(marksEnabled);
  const [mappable, setMappable] = useState(() => new Set());

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // The resume dropdown and "How scoring works" close on a click elsewhere, as the
  // site's other menus do.
  useEffect(() => {
    const outside = (e) => {
      host.current?.querySelectorAll(".resume-picker[open], .scoring-help[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, []);

  const hasDescription = description.ready ? description.hasText : null;
  const current = activeId();
  const stored = () => { const id = activeId(); return id ? cache.scores.get(key(id, job.job_id)) : undefined; };
  const hitNow = () => { const st = sRef.current; return !st.signedOut && (!st.busy || st.busy === "checking") ? stored() : null; };
  const result = !s.signedOut && (!s.busy || s.busy === "checking") ? stored() : null;
  const body = () => document.getElementById("detail-body");

  // ---- loading the account's resumes and this job's stored score ----
  async function start() {
    const version = ++revision.current;
    update({ busy: "loading", message: null, loaded: false, breakdownOpen: false, breakdownFilter: "all", expanded: new Set() });
    if (!ready) return; // the effect runs again once sign-in has answered
    if (!account) { update({ busy: null, signedOut: true }); return; }
    const patch = { signedOut: false };
    try {
      await loadList();
      if (version !== revision.current) return;
      patch.loaded = true;
      await fetchStored(activeId(), job.job_id);
    } catch (err) {
      if (version !== revision.current) return;
      patch.loaded = true;
      if (err.signedOut) patch.signedOut = true;
      else patch.message = { kind: "error", text: err.message };
    }
    if (version !== revision.current) return;
    update({ ...patch, busy: null });
  }
  useEffect(() => { start(); }, [ready, account]); // eslint-disable-line react-hooks/exhaustive-deps

  const signedOutNow = () => sRef.current.signedOut || !account;

  async function upload(file) {
    if (signedOutNow()) { requestResumeSignIn(); return; }
    const version = ++revision.current, identity = cache.accountVersion;
    update({ busy: "reading", message: null, breakdownOpen: false, breakdownFilter: "all", expanded: new Set() });
    let uploaded = false;
    const patch = {};
    try {
      const resume = await addResume(file, (stage) => { if (version === revision.current) update({ busy: stage }); });
      // The account changed mid-upload: start() has already redrawn the card.
      if (identity !== cache.accountVersion || !resume) return;
      cache.scores.set(key(resume.id, job.job_id), null);
      uploaded = true;
    } catch (err) {
      console.error(`Resume upload failed while ${sRef.current.busy === "uploading" ? "uploading" : "reading"}:`, err);
      if (err.signedOut) patch.signedOut = true;
      patch.message = { kind: "error", text: err.message || "That file could not be read." };
    }
    if (version !== revision.current) return;
    update({ ...patch, busy: null });
    const d = descRef.current;
    if (uploaded && !(d.ready && !d.hasText)) run();
  }

  async function run() {
    const id = activeId();
    if (!id || sRef.current.busy) return;
    const version = ++revision.current, identity = cache.accountVersion, again = !!stored();
    const restoreFocus = !!host.current && host.current.contains(document.activeElement);
    update({ busy: "checking", message: null });
    const patch = {};
    try {
      const r = await call("/match", json("POST", { resume_id: id, job_id: job.job_id, title: job.title, force: again }));
      if (identity !== cache.accountVersion) return;
      cache.scores.set(key(id, job.job_id), r);
      cache.stale.delete(key(id, job.job_id));
      if (r && r.usage) cache.lastUsage = r.usage;
      cache.limitHit = null;
    } catch (err) {
      if (err.signedOut) patch.signedOut = true;
      else if (err.code === "daily_limit" && err.usage) { cache.limitHit = err.usage; patch.unlockError = null; }
      else patch.message = { kind: "error", text: err.message };
    }
    if (version !== revision.current) return;
    if (cache.limitHit && cache.limitHit.canUnlock) focusAfter.current = { selector: "[data-limit-form] input" };
    else if (restoreFocus) focusAfter.current = { selector: '[data-act="run"]', onlyIfLost: true };
    update({ ...patch, busy: null });
  }

  // Feedback that unlocks more checks, then the check that was refused runs.
  async function unlock(form) {
    const rating = form.querySelector('input[name="limit-rating"]:checked')?.value;
    const text = form.querySelector("textarea").value.trim();
    if (!rating) { update({ unlockError: "Choose a rating from 1 to 5." }); return; }
    if (text.length < 20) { update({ unlockError: "Please write at least 20 characters, so we know what to improve." }); return; }
    update({ busy: "unlocking", unlockError: null });
    try {
      const d = await call("/match/unlock", json("POST", { rating: Number(rating), message: text, job_id: job.job_id }));
      cache.lastUsage = d.usage; cache.limitHit = null;
      update({ busy: null });
      run();
    } catch (err) {
      const patch = { busy: null };
      if (err.code === "no_unlock" && err.usage) { cache.limitHit = { ...err.usage, canUnlock: false }; patch.unlockError = null; }
      else patch.unlockError = err.message;
      update(patch);
    }
  }

  async function remove(id) {
    const r = cache.items.find((x) => x.id === id);
    if (!r || !window.confirm(`Remove “${r.label}”?`)) return;
    const version = ++revision.current, identity = cache.accountVersion;
    update({ busy: "removing", message: null, breakdownOpen: false, breakdownFilter: "all", expanded: new Set() });
    const patch = {};
    try {
      await deleteResume(id);
      if (identity !== cache.accountVersion) return;
      await fetchStored(activeId(), job.job_id);
    } catch (err) { patch.message = { kind: "error", text: err.message }; }
    if (version !== revision.current) return;
    update({ ...patch, busy: null });
  }

  async function chooseResume(id) {
    if (sRef.current.busy || !cache.items.some((r) => r.id === id)) return;
    const version = ++revision.current;
    setActive(id);
    update({ busy: cache.scores.has(key(id, job.job_id)) ? null : "loading", message: null, breakdownOpen: false, breakdownFilter: "all", expanded: new Set() });
    const patch = {};
    try { await fetchStored(id, job.job_id); } catch (err) { if (version === revision.current) patch.message = { kind: "error", text: err.message }; }
    if (version !== revision.current) return;
    focusAfter.current = { selector: ".select-picker > summary" };
    update({ ...patch, busy: null });
  }

  const addAnother = () => { if (signedOutNow()) requestResumeSignIn(); else input.current?.click(); };

  // ---- the "was this helpful" thumbs ----
  const reviewKey = (r, id = activeId()) => key(id, job.job_id) + "|" + (r && r.checkedAt);
  function feedbackState(r) {
    const id = reviewKey(r);
    return {
      disabled: !!s.busy || s.pending.has(id) || !Number.isSafeInteger(r && r.checkedAt),
      rating: r && r.feedback && r.feedback.rating,
      message: s.pending.has(id) ? "Saving…" : s.reviewErrors.get(id) || (r && r.feedback ? "Feedback saved. Thank you." : ""),
      error: s.reviewErrors.has(id),
    };
  }
  async function review(rating, fromKeyboard = false) {
    const r = hitNow(), id = activeId(), identity = cache.accountVersion;
    if (!r || sRef.current.busy || !Number.isSafeInteger(r.checkedAt) || (r.feedback && r.feedback.rating === rating)) return;
    const k = reviewKey(r, id);
    if (sRef.current.pending.has(k)) return;
    const errors = new Map(sRef.current.reviewErrors); errors.delete(k);
    // Both thumbs are disabled while saving, which drops focus to the page. Pressed from
    // the keyboard, focus comes back to that thumb, as after a check. Not after a click:
    // focusing it would open its tooltip with no pointer there to close it.
    const restoreFocus = fromKeyboard && !!host.current && host.current.contains(document.activeElement);
    update({ pending: new Set(sRef.current.pending).add(k), reviewErrors: errors });
    try {
      const response = await call("/match/feedback", json("POST", { resume_id: id, job_id: job.job_id, checked_at: r.checkedAt, rating }));
      if (identity !== cache.accountVersion) return;
      const cached = cache.scores.get(key(id, job.job_id));
      if (cached && cached.checkedAt === r.checkedAt) cached.feedback = response.feedback;
    } catch (err) {
      if (identity === cache.accountVersion) update({ reviewErrors: new Map(sRef.current.reviewErrors).set(k, err.message || "Could not save feedback. Please try again.") });
    } finally {
      const pending = new Set(sRef.current.pending); pending.delete(k);
      if (restoreFocus) focusAfter.current = { selector: `[data-act="review"][data-rating="${rating}"]`, onlyIfLost: true };
      update({ pending });
    }
  }

  // ---- the requirement breakdown dialog ----
  function setBreakdownOpen(open, restore = true) {
    const d = dialog.current;
    if (!d) return;
    const pane = paneRef.current;
    if (open) breakdownReturn.current = pane ? pane.scrollTop : 0;
    update({ breakdownOpen: open, expanded: new Set(), ...(open ? { breakdownFilter: "all" } : {}) });
    if (open) {
      if (!d.open) d.showModal();
      d.querySelector('[data-act="breakdown-close"]')?.focus({ preventScroll: true });
    } else if (d.open) d.close();
    if (!open && restore) {
      if (pane) pane.scrollTop = breakdownReturn.current;
      host.current?.querySelector(".breakdown-open")?.focus({ preventScroll: true });
    }
  }
  const onJump = (passage) => {
    if (sRef.current.breakdownOpen) setBreakdownOpen(false, false);
    jumpTo(passage);
  };

  // ---- after each draw ----
  // A result shown once keeps the compact toolbar for the rest of this job.
  useEffect(() => { if (result && !s.showToolbar) update({ showToolbar: true }); });

  // The marks in the description follow the result on show, and the switch.
  const resultKey = result ? `${current}|${result.checkedAt}|${(result.findings || []).length}` : "";
  useLayoutEffect(() => {
    const b = body();
    if (!b) return;
    if (!description.ready || b.dataset.ready !== job.job_id) { clearMarks(b); return; }
    preservePosition(paneRef.current, b, () => annotate(b, hitNow()));
    const next = new Set(findings(hitNow()).filter((f) => locate(b, f.text)).map((f) => f.text));
    setMappable((m) => (m.size === next.size && [...next].every((t) => m.has(t)) ? m : next));
  }, [description.ready, resultKey, marksOn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the reading position when the card changes height above a scrolled description.
  const lastOffset = useRef(null);
  useLayoutEffect(() => {
    const pane = paneRef.current, b = body();
    if (!pane || !b) return;
    const now = b.offsetTop, was = lastOffset.current;
    lastOffset.current = now;
    if (was === null || now === was) return;
    const covered = coveredHeight(pane);
    if (pane.scrollTop >= was - covered) pane.scrollTop = Math.max(0, pane.scrollTop + now - was);
  });

  // The breakdown stays open across a redraw, and focus lands where the action said.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (d && s.breakdownOpen && !d.open) d.showModal();
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    // After a check, focus goes back to the button only if it fell to the page.
    const a = document.activeElement;
    if (f.onlyIfLost && a && a !== document.body) return;
    host.current?.querySelector(f.selector)?.focus({ preventScroll: true });
  });

  // ---- drawing ----
  const busy = s.busy;
  const checking = busy === "checking";
  const rows = ranked(findings(result));
  const hasBreakdown = !!(result && Array.isArray(result.findings));
  const canCheck = s.loaded && !s.signedOut && cache.items.length && hasDescription !== false && !busy;
  const picker = <ResumePicker selected={current} disabled={!!busy} onChoose={chooseResume} onRemove={remove} onAdd={addAnother} />;
  // Analyze is the card's one primary action; once there is a score, Reanalyze steps
  // back to an outline button beside the dropdown.
  const action = (
    <Button type="button" variant={result ? "outline" : "default"} size={result ? "sm" : "default"}
      className={cn("match-run", result ? "analysis-reanalyze" : "analysis-primary", checking && "is-busy")} data-act="run"
      disabled={!canCheck} onClick={run}>
      {checking ? <Busy /> : result ? <RefreshCw aria-hidden="true" /> : <Sparkles aria-hidden="true" className="ai-icon" />}
      <span>{checking ? (result ? "Updating…" : "Analyzing resume…") : result ? "Reanalyze" : "Analyze resume"}</span>
    </Button>
  );
  const heading = (
    <h3 className="flex items-center gap-2 text-sm leading-none font-semibold">
      <Sparkles aria-hidden="true" className="ai-icon size-4 text-muted-foreground" />Resume match
    </h3>
  );
  // Analyzed: the title, then the dropdown with when it was analyzed, and Reanalyze to
  // the side. Not yet (a resume just switched to): no label, just Analyze under the
  // dropdown.
  const toolbar = result ? (
    <div className="analysis-header-toolbar grid grid-cols-[minmax(0,1fr)_max-content] items-start gap-x-3 gap-y-3">
      <div className="col-span-2">{heading}</div>
      <div className="analysis-source flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <div className="analysis-header-picker min-w-0 flex-[1_1_9rem] sm:max-w-60">{picker}</div>
        <span className="analysis-timestamp text-xs text-muted-foreground">{result.checkedAt ? `Analyzed ${ago(result.checkedAt)}` : "Analyzed"}</span>
      </div>
      <div className="analysis-tools flex items-center gap-2 self-start">{action}</div>
    </div>
  ) : (
    <div className="analysis-header-toolbar is-pending grid justify-items-start gap-3">
      {heading}
      <div className="analysis-header-picker w-full max-w-60">{picker}</div>
      {action}
    </div>
  );
  const uploadButton = (
    <Button type="button" className="match-run analysis-primary" data-act="upload" disabled={!!busy && !s.signedOut} onClick={addAnother}>
      {busy === "reading" || busy === "uploading" ? <Busy /> : <Upload aria-hidden="true" />}
      {busy === "reading" ? "Reading resume…" : busy === "uploading" ? "Uploading resume…" : "Upload resume"}
    </Button>
  );
  const muted = "match-msg text-sm text-muted-foreground";

  let content;
  if (result) {
    const score = Number.isFinite(result.score) ? result.score : null;
    const metric = (status) => rows.filter((f) => f.status === status).length;
    const fb = feedbackState(result);
    const visible = rows.filter((f) => s.breakdownFilter === "all" || f.status === s.breakdownFilter).length;
    content = (
      <div className="analysis-result grid gap-4">
        {toolbar}
        <div className="analysis-score-section grid gap-3 border-t pt-4">
          <div className="analysis-score-head flex items-center gap-4">
            {score !== null ? (
              <span className="analysis-score-number shrink-0 text-3xl leading-none font-semibold tracking-tight tabular">{score}<small className="ml-0.5 text-sm font-normal tracking-normal text-muted-foreground">/100</small></span>
            ) : null}
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="relative flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <h4 className="text-sm font-medium">Resume evidence score</h4>
                <details className="scoring-help">
                  <summary className={cn(SUMMARY_RESET, "inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring")}>
                    <Info aria-hidden="true" className="size-3.5" />How scoring works
                  </summary>
                  <div className="scoring-explanation absolute top-full right-0 z-30 mt-2 grid w-72 max-w-[calc(100vw-3rem)] gap-2 rounded-md bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md ring-1 ring-border">
                    <p>The score measures resume evidence coverage of extracted requirements. Required items carry more weight than responsibilities or preferences, and partial evidence contributes to coverage. It is not a prediction of hiring outcomes.</p>
                    <Notes result={result} />
                  </div>
                </details>
              </div>
              {score !== null ? (
                <Progress className="analysis-progress" value={score} aria-valuenow={score} aria-valuetext={`${score}/100`} aria-label="Resume evidence score" />
              ) : null}
            </div>
          </div>
          {hasBreakdown ? (
            <ul className="analysis-metrics grid grid-cols-3 gap-1.5 sm:gap-2" aria-label="Requirement classifications">
              {[["shown", "Demonstrated"], ["partial", "Partial"], ["unclear", "Not evidenced"]].map(([status, label]) => (
                <li key={status} className="grid content-start gap-1 rounded-lg border px-2.5 py-2 sm:px-3">
                  <span className="flex items-center gap-1.5"><StatusIcon status={status} className="size-3.5" /><strong className="text-base leading-none font-semibold tabular">{metric(status)}</strong></span>
                  <span className="text-xs leading-tight text-muted-foreground">{label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {checking ? <p className={LOADING_LINE} role="status"><Busy />Updating analysis… Previous result shown.</p> : null}
        {rows.length ? <Insights rows={rows} mappable={mappable} onJump={onJump} />
          : <p className={muted}>{hasBreakdown ? "No requirement findings were returned." : "The stored analysis has no requirement breakdown. Reanalyze for current details."}</p>}
        {rows.length || score !== null ? (
          <div className="analysis-links flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
            {rows.length ? (
              <Button type="button" variant="outline" size="sm" className="breakdown-open" data-act="breakdown" aria-haspopup="dialog" aria-expanded={s.breakdownOpen} aria-controls="requirement-breakdown"
                onClick={() => setBreakdownOpen(!sRef.current.breakdownOpen)}><ListChecks aria-hidden="true" />Full requirement breakdown ({rows.length})</Button>
            ) : null}
            {score !== null ? (
              <div className="analysis-feedback flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" role="group" aria-label="Review this analysis">
                <span className="analysis-feedback-label">Was this analysis helpful?</span>
                <div className="analysis-feedback-buttons flex gap-1">
                  {[["up", "Helpful analysis", ThumbsUp], ["down", "Not helpful analysis", ThumbsDown]].map(([rating, label, Thumb]) => (
                    <Tooltip key={rating}>
                      <TooltipTrigger asChild>
                        <button type="button" data-act="review" data-rating={rating} aria-label={label} aria-pressed={fb.rating === rating}
                          className={cn(toggleVariants({ variant: "outline", size: "sm" }), "size-8 px-0 text-muted-foreground aria-pressed:text-foreground aria-pressed:[&_svg]:fill-current")}
                          disabled={fb.disabled} onClick={(e) => review(rating, e.detail === 0)}><Thumb aria-hidden="true" className="size-3.5" /></button>
                      </TooltipTrigger>
                      <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                {/* Empty, it is visually hidden but stays a live region, so "Saving…" is
                    announced when it appears. */}
                <span className={cn("analysis-feedback-status empty:sr-only", fb.error && "is-error text-destructive")} role="status" aria-live="polite">{fb.message}</span>
              </div>
            ) : null}
          </div>
        ) : null}
        {rows.length ? (
          // A native modal, drawn with the classes of shadcn's DialogContent and, on
          // ::backdrop, its DialogOverlay (the same scrim as the site's other dialogs).
          <dialog ref={dialog} className="requirement-breakdown m-auto max-h-[min(760px,calc(100dvh-2rem))] w-[min(720px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl bg-popover p-0 text-sm text-popover-foreground ring-1 ring-border backdrop:bg-black/10 supports-backdrop-filter:backdrop:backdrop-blur-xs open:flex"
            id="requirement-breakdown" aria-labelledby="breakdown-title"
            onCancel={(e) => { e.preventDefault(); setBreakdownOpen(false); }}
            onClick={(e) => {
              if (e.target !== dialog.current) return;
              const b = dialog.current.getBoundingClientRect();
              if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) setBreakdownOpen(false);
            }}>
            <div className="grid shrink-0 gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
              <div className="breakdown-head flex items-center justify-between gap-3">
                <h3 id="breakdown-title" className="text-base font-semibold">Requirement breakdown</h3>
                <Button type="button" variant="ghost" size="sm" className="-mr-2 text-muted-foreground" data-act="breakdown-close" aria-label="Close requirement breakdown" onClick={() => setBreakdownOpen(false)}>
                  <X aria-hidden="true" />Close
                </Button>
              </div>
              <p className="breakdown-note -mt-2 text-sm text-muted-foreground">Match status describes evidence in this resume. Open a row to explore available evidence.</p>
              <div className="breakdown-filters flex flex-wrap gap-1.5" role="group" aria-label="Filter requirements by status">
                {[["all", "All"], ["shown", "Demonstrated"], ["partial", "Partial"], ["unclear", "Not found"]].map(([status, label]) => (
                  <button key={status} type="button" data-act="filter-status" data-filter-status={status} aria-pressed={s.breakdownFilter === status}
                    className={cn(toggleVariants({ variant: "outline", size: "sm" }), "gap-1.5 aria-pressed:border-foreground aria-pressed:text-foreground")}
                    onClick={() => update({ breakdownFilter: status })}>
                    {status === "all" ? null : <StatusIcon status={status} className="size-3.5" />}
                    {label} <span className="text-xs text-muted-foreground tabular">{status === "all" ? rows.length : metric(status)}</span>
                  </button>
                ))}
              </div>
              <p className="breakdown-results pb-1 text-xs text-muted-foreground" role="status" aria-live="polite">{visible} of {rows.length} requirements</p>
            </div>
            <div className="breakdown-content min-h-0 flex-1 overflow-y-auto overscroll-contain border-t px-4 pb-3 [scrollbar-gutter:stable] sm:px-6">
              {GROUPS.map(([kind, title]) => {
                const group = rows.filter((f) => inGroup(kind, f));
                if (!group.length) return null;
                const shown = group.filter((f) => s.breakdownFilter === "all" || f.status === s.breakdownFilter).length;
                return (
                  <section key={kind} className="requirement-group pt-4" hidden={shown === 0}>
                    <h4 className="flex items-baseline gap-1.5 pb-1 text-sm font-semibold">{title} <span data-group-count="" className="text-xs font-normal text-muted-foreground tabular">{s.breakdownFilter === "all" ? String(shown) : `${shown} / ${group.length}`}</span></h4>
                    <ul className="requirement-rows">
                      {group.map((f) => {
                        const index = rows.indexOf(f);
                        return (
                          <li key={index} data-status={f.status} hidden={s.breakdownFilter !== "all" && f.status !== s.breakdownFilter}
                            className="border-b last:border-b-0 [&:not(:has(~li:not([hidden])))]:border-b-0">
                            <details className="requirement-row group/row" data-index={index} open={s.expanded.has(index)}
                              onToggle={(e) => {
                                const open = e.currentTarget.open;
                                if (open === sRef.current.expanded.has(index)) return;
                                const next = new Set(sRef.current.expanded);
                                if (open) next.add(index); else next.delete(index);
                                update({ expanded: next });
                              }}>
                              <summary className={cn(SUMMARY_RESET, "-mx-2 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring")}>
                                <StatusIcon status={f.status} className={`requirement-dot is-${f.status} mt-0.5`} />
                                <span className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1">
                                  <span className="requirement-row-text min-w-0 flex-[1_1_14rem] text-sm leading-5 wrap-anywhere">{f.text}</span>
                                  <Badge variant="outline" className={cn(`requirement-row-status is-${f.status} mt-px`, TONE[f.status].badge)} title={STATUS_LABEL[f.status]}>{ROW_STATUS[f.status]}</Badge>
                                </span>
                                <ChevronDown aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open/row:rotate-180 motion-reduce:transition-none" />
                              </summary>
                              <div className="requirement-evidence grid gap-2 pb-3 pl-7 text-sm leading-relaxed text-muted-foreground">
                                {f.evidence ? <blockquote aria-label="Resume evidence" className="border-l-2 pl-3 text-foreground">{f.evidence}</blockquote> : null}
                                {f.explanation ? <p>{f.explanation}</p> : null}
                                <p className="requirement-navigation">
                                  <Locate text={f.text} mappable={mappable} onJump={onJump} fallback="Original wording shown above."
                                    className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline">
                                    <TextSearch aria-hidden="true" className="size-3.5" />Find in JD
                                  </Locate>
                                </p>
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              <p className="breakdown-empty py-8 text-center text-sm text-muted-foreground" hidden={visible !== 0}>No requirements match this status.</p>
            </div>
            <div className="flex shrink-0 justify-end border-t px-4 py-3 sm:px-6">
              <Button type="button" variant="outline" size="sm" className="breakdown-collapse" data-act="breakdown-close" onClick={() => setBreakdownOpen(false)}>Close breakdown</Button>
            </div>
          </dialog>
        ) : null}
      </div>
    );
  } else if (s.signedOut) {
    content = <div className="analysis-entry analysis-entry-upload grid justify-items-start gap-3">{heading}<p className={muted}>Add a resume to analyse this job.</p>{uploadButton}</div>;
  } else if (!s.loaded) {
    content = (
      <div className="analysis-entry grid gap-3">{heading}
        <p className={LOADING_LINE} role="status"><Busy />Loading resume…</p>
        <div className="grid gap-3" aria-hidden="true"><Shape className="h-8 w-full max-w-60" /><Shape className="h-9 w-36" /></div>
      </div>
    );
  } else if (s.message && s.message.kind === "error" && !cache.listing) {
    content = <div className="analysis-entry grid gap-3">{heading}<p className={muted}>Analysis unavailable</p></div>;
  } else if (!cache.items.length) {
    content = <div className="analysis-entry analysis-entry-upload grid justify-items-start gap-3">{heading}<p className={muted}>Add a resume to analyse this job.</p>{uploadButton}</div>;
  } else if (s.showToolbar) {
    content = (
      <>
        {toolbar}
        {checking || busy === "loading"
          ? <><p className={LOADING_LINE} role="status"><Busy />{checking ? "Analyzing resume…" : "Loading saved analysis…"}</p><ResultSkeleton /></>
          : <p className={muted}>Analyze this resume against the selected job.</p>}
      </>
    );
  } else {
    content = (
      <>
        <div className="analysis-entry analysis-entry-ready grid justify-items-start gap-3">{heading}
          <div className="analysis-resume-controls w-full"><div className="analysis-entry-picker w-full max-w-60">{picker}</div></div>
          <div className="analysis-entry-actions flex items-center gap-2">{action}</div>
        </div>
        {checking || busy === "loading"
          ? <><p className={LOADING_LINE} role="status"><Busy />{checking ? "Analyzing resume…" : "Loading analysis…"}</p><ResultSkeleton /></> : null}
      </>
    );
  }

  const limit = cache.limitHit;
  const outdated = current && cache.stale.get(key(current, job.job_id));
  const message = s.message;

  return (
    <>
      <Card ref={host} size="sm" role="region" aria-label="Resume match" id="detail-match"
        className={cn("detail-match mt-3 mb-6 overflow-visible", result && "is-analyzed")}
        onKeyDown={(e) => {
          if (pickerKeydown(e) || e.key !== "Escape") return;
          const menu = e.target.closest("details[open]");
          if (menu) { menu.open = false; menu.querySelector("summary").focus({ preventScroll: true }); }
          else if (sRef.current.breakdownOpen && e.target.closest(".requirement-breakdown")) setBreakdownOpen(false);
          else return;
          e.preventDefault(); e.stopPropagation();
        }}>
        <CardContent className="analysis-shell gap-4" aria-busy={String(!!busy)}>
          {content}
          {limit && !limit.canUnlock ? (
            <Alert role="status" className="limit-box bg-muted">
              <Info aria-hidden="true" />
              <AlertDescription className="text-foreground"><p><strong className="font-medium">You've used all {limit.limit} resume checks for today.</strong> More open up {untilReset(limit.resetsAt)}. Saved results stay available.</p></AlertDescription>
            </Alert>
          ) : null}
          {limit && limit.canUnlock ? (
            <form className="limit-box limit-form grid gap-4 rounded-lg border bg-muted p-4" data-limit-form="" noValidate
              onSubmit={(e) => { e.preventDefault(); if (sRef.current.busy !== "unlocking") unlock(e.currentTarget); }}>
              <p className="text-sm"><strong className="font-medium">You've used today's {limit.limit} resume checks.</strong> <span className="text-muted-foreground">Tell us how resume matching is working for you to unlock {limit.bonus} more today.</span></p>
              <fieldset className="limit-rating grid gap-2">
                <legend className="mb-2 text-sm font-medium">How useful has resume matching been?</legend>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="relative">
                      <input type="radio" name="limit-rating" value={n} required className="peer sr-only" />
                      <span className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md border border-input bg-background text-sm font-medium shadow-xs transition-colors tabular hover:bg-muted peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:hover:bg-primary/90 peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring">{n}</span>
                    </label>
                  ))}
                  <span className="limit-scale ml-1 text-xs text-muted-foreground" aria-hidden="true">1 not useful · 5 very useful</span>
                </div>
              </fieldset>
              <label className="limit-message grid gap-2"><span className="text-sm font-medium">What's working, and what should be better?</span>
                <Textarea name="limit-message" rows="3" minLength="20" maxLength="2000" required placeholder="At least 20 characters" className="min-h-18 bg-background" /></label>
              {s.unlockError ? <p className="match-msg error text-sm text-destructive" role="alert">{s.unlockError}</p> : null}
              <Button type="submit" className="match-run analysis-primary justify-self-start" disabled={busy === "unlocking"}>
                {busy === "unlocking" ? <><Busy />Sending…</> : `Send feedback and unlock ${limit.bonus} check${limit.bonus === 1 ? "" : "s"}`}
              </Button>
            </form>
          ) : null}
          {!limit && cache.lastUsage && cache.lastUsage.remaining <= 5
            ? <p className="match-fine limit-left text-xs text-muted-foreground">{cache.lastUsage.remaining} resume check{cache.lastUsage.remaining === 1 ? "" : "s"} left today</p> : null}
          {message ? (
            <Alert variant={message.kind === "error" ? "destructive" : "default"} role="status" className={`match-msg ${message.kind}`}>
              <CircleAlert aria-hidden="true" />
              <AlertDescription>{message.text}</AlertDescription>
              {!cache.items.length && !s.signedOut && !busy ? (
                <AlertAction><Button type="button" variant="outline" size="xs" className="analysis-retry" data-act="retry" onClick={start}>Retry</Button></AlertAction>
              ) : null}
            </Alert>
          ) : null}
          {hasDescription === false ? (
            <Alert role={undefined} className="match-msg bg-muted"><Info aria-hidden="true" /><AlertDescription>This job has no description to compare against.</AlertDescription></Alert>
          ) : null}
          {outdated && !result ? (
            <Alert role={undefined} className="match-msg bg-muted"><Info aria-hidden="true" /><AlertDescription>{outdated === "description" ? "The job description has changed." : "The analysis has been updated."} Analyze your resume for current results.</AlertDescription></Alert>
          ) : null}
        </CardContent>
        <input ref={input} type="file" accept={Import.ACCEPT} hidden
          onChange={(e) => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) upload(file); }} />
      </Card>
      <div className="description-controls mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2" hidden={!result || !hasBreakdown || hasDescription !== true}>
        <h3 className="text-base font-semibold">Job description</h3>
        {/* A native checkbox (role="switch") drawn as shadcn's Switch: the test and
            keyboard users toggle the real input, which lies invisibly over the track. */}
        <label className="description-highlights group/hl relative inline-flex min-h-8 cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <span>Match highlights</span>
          <input type="checkbox" role="switch" aria-label="Match highlights" aria-controls="detail-body" checked={marksOn}
            className="peer absolute top-1/2 right-0 m-0 h-[18.4px] w-8 -translate-y-1/2 cursor-pointer opacity-0"
            onChange={(e) => { setMarksEnabled(e.target.checked); setMarksOn(e.target.checked); }} />
          <span className="highlight-switch pointer-events-none inline-flex h-[18.4px] w-8 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-all motion-reduce:transition-none peer-checked:bg-primary peer-focus-visible:border-ring peer-focus-visible:ring-3 peer-focus-visible:ring-ring" aria-hidden="true">
            <span className="block size-4 rounded-full bg-background transition-transform group-has-[:checked]/hl:translate-x-[calc(100%-2px)] motion-reduce:transition-none dark:bg-foreground dark:group-has-[:checked]/hl:bg-primary-foreground"></span>
          </span>
        </label>
      </div>
    </>
  );
}
