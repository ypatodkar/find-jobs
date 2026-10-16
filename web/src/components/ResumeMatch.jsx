// Resume match, in the description pane: the chosen resume, an option to add another,
// and "Analyze resume", which scores it against the open job. A job opened again shows the score it already has, read back from the
// database, without calling the model.
//
// Signed out, adding a resume asks for sign-in first. Mounted once per job (DetailPane
// keys it by job id), so every per-job state starts fresh; what outlives a job (the
// resume list, the scores, today's allowance) is in lib/match.js.
//
// Below the card sits the description's header, with the Match highlights switch.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { requestResumeSignIn, useAuth } from "../lib/auth.js";
import {
  Import, STATUS_LABEL, activeId, addResume, ago, cache, call, deleteResume, fetchStored, findings,
  insightSummary, json, key, loadList, ranked, setActive, untilReset,
} from "../lib/match.js";
import { annotate, clearMarks, jumpTo, locate, marksEnabled, preservePosition, setMarksEnabled } from "../lib/jdMarks.js";

// The "sparkles" mark that has come to mean AI-assisted (Lucide, ISC licence), drawn in
// currentColor so it takes the accent wherever it sits. Decorative: the words next to
// it say what the control does.
const SPARKLE = (
  <svg className="ai-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    <path d="M20 3v4" /><path d="M22 5h-4" /><path d="M4 17v2" /><path d="M5 18H3" />
  </svg>
);
const Icon = ({ children, style }) => (
  <svg className="resume-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={style}>{children}</svg>
);
const CHEVRON = <Icon><path d="m6 9 6 6 6-6" /></Icon>;
const PLUS = <Icon><path d="M12 5v14M5 12h14" /></Icon>;
const TRASH = <Icon><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></Icon>;
const THUMB = "M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L13 2a3.1 3.1 0 0 1 2 3.9Z";
const THUMB_UP = <Icon><path d={THUMB} /></Icon>;
const THUMB_DOWN = <Icon style={{ transform: "rotate(180deg)" }}><path d={THUMB} /></Icon>;

const Spinner = () => <span className="analysis-spinner" aria-hidden="true"></span>;
const INSIGHT_LIMIT = 2;
const ROW_STATUS = { shown: "Demonstrated", partial: "Partial", unclear: "Not found" };
const GROUPS = [["required", "Required"], ["preferred", "Preferred"], ["duty", "Responsibilities"], ["other", "Other requirements"]];
const inGroup = (kind, f) => (kind === "other" ? !["required", "preferred", "duty"].includes(f.kind) : f.kind === kind);

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
// add another from the foot of the list. Drawn like the SelectMenu pickers, but by
// hand, since a <select> cannot hold the buttons.
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
    <details ref={ref} className={`company-picker select-picker resume-picker${disabled ? " is-disabled" : ""}`} onToggle={onToggle}>
      <summary aria-haspopup="true" aria-label={`Resume: ${label}`} title={label} aria-disabled={disabled ? "true" : undefined}>{label}</summary>
      <div className="company-panel select-panel resume-picker-panel" role="group" aria-label="Your resumes">
        {items.map((r) => (
          <div className="resume-picker-row" key={r.id}>
            <button type="button" className={`select-option${r.id === selected ? " is-selected" : ""}`} data-act="choose" data-resume-id={r.id}
              aria-pressed={r.id === selected} aria-label={r.label} title={r.label} disabled={disabled} onClick={() => { close(); onChoose(r.id); }}><span>{r.label}</span></button>
            <button type="button" className="resume-picker-delete" data-act="remove" data-resume-id={r.id} aria-label={`Delete ${r.label}`} title="Delete resume"
              disabled={disabled} onClick={() => onRemove(r.id)}>{TRASH}</button>
          </div>
        ))}
        <button type="button" className="resume-picker-add" data-act="upload" disabled={disabled} onClick={() => { close(); onAdd(); }}>{PLUS}Add resume</button>
      </div>
    </details>
  );
}

// "Find in JD" for a requirement the description holds exactly once; otherwise the
// fallback text beside it.
function Locate({ text, mappable, onJump, children, fallback, label }) {
  const mapped = mappable.has(text);
  return (
    <>
      <a className="requirement-locate" href="#detail-body" data-passage={text} aria-label={label} hidden={!mapped}
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
  ].filter(Boolean).map((n) => <p key={n} className="match-fine">{n}</p>);
}

function Insights({ rows, mappable, onJump }) {
  const chosen = rows.slice(0, 1);
  const second = rows.find((f) => f !== chosen[0] && f.status === "shown") ||
    rows.find((f) => f !== chosen[0] && f.status === "partial") || rows[1];
  if (second) chosen.push(second);
  return (
    <section className="analysis-insights-section" aria-labelledby="analysis-insights-title">
      <h3 id="analysis-insights-title">Key things to review</h3>
      <ul className="analysis-insights" aria-label="Prioritized insights">
        {chosen.slice(0, INSIGHT_LIMIT).map((f, i) => {
          const text = insightSummary(f.text);
          const lead = { shown: "Supported", partial: "Clarify evidence", unclear: "Review evidence" }[f.status];
          return (
            <li key={i} title={f.text}><span className="insight-lead">{lead}</span>
              <div className="insight-copy"><Locate text={f.text} mappable={mappable} onJump={onJump} label={`Find in job description: ${f.text}`} fallback={text}>{text}</Locate></div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

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
  async function review(rating) {
    const r = hitNow(), id = activeId(), identity = cache.accountVersion;
    if (!r || sRef.current.busy || !Number.isSafeInteger(r.checkedAt) || (r.feedback && r.feedback.rating === rating)) return;
    const k = reviewKey(r, id);
    if (sRef.current.pending.has(k)) return;
    const errors = new Map(sRef.current.reviewErrors); errors.delete(k);
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
    const covered = pane.querySelector(".detail-head")?.offsetHeight || 0;
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
  const rows = ranked(findings(result));
  const hasBreakdown = !!(result && Array.isArray(result.findings));
  const canCheck = s.loaded && !s.signedOut && cache.items.length && hasDescription !== false && !busy;
  const picker = <ResumePicker selected={current} disabled={!!busy} onChoose={chooseResume} onRemove={remove} onAdd={addAnother} />;
  const action = (
    <button type="button" className={`match-run${result ? " analysis-reanalyze" : " analysis-primary"}${busy === "checking" ? " is-busy" : ""}`} data-act="run"
      disabled={!canCheck} onClick={run}>
      {SPARKLE}<span>{busy === "checking" ? (result ? "Updating…" : "Analyzing resume…") : result ? "Reanalyze" : "Analyze resume"}</span>
    </button>
  );
  // Analyzed: the dropdown with when it was analyzed, and Reanalyze to the side. Not
  // yet (a resume just switched to): no label, just Analyze under the dropdown.
  const toolbar = result ? (
    <div className="analysis-header-toolbar">
      <div className="analysis-source"><div className="analysis-header-picker">{picker}</div>
        <span className="analysis-timestamp">{result.checkedAt ? `Analyzed ${ago(result.checkedAt)}` : "Analyzed"}</span></div>
      <div className="analysis-tools">{action}</div>
    </div>
  ) : (
    <div className="analysis-header-toolbar is-pending"><div className="analysis-header-picker">{picker}</div>{action}</div>
  );
  const heading = <h3>{SPARKLE} Resume match</h3>;
  const uploadButton = (
    <button type="button" className="match-run analysis-primary" data-act="upload" disabled={!!busy && !s.signedOut} onClick={addAnother}>
      {SPARKLE}{busy === "reading" ? "Reading resume…" : busy === "uploading" ? "Uploading resume…" : "Upload resume"}
    </button>
  );

  let content;
  if (result) {
    const score = Number.isFinite(result.score) ? result.score : null;
    const metric = (status) => rows.filter((f) => f.status === status).length;
    const fb = feedbackState(result);
    const visible = rows.filter((f) => s.breakdownFilter === "all" || f.status === s.breakdownFilter).length;
    content = (
      <div className="analysis-result">
        {toolbar}
        <div className="analysis-score-section">
          <div className="analysis-score-head">
            {score !== null ? <span className="analysis-score-number">{score}<small>/100</small></span> : null}
            <h3>Resume evidence score</h3>
          </div>
          {score !== null ? <progress className="analysis-progress" value={score} max="100" aria-label="Resume evidence score">{score}/100</progress> : null}
          {hasBreakdown ? (
            <ul className="analysis-metrics" aria-label="Requirement classifications">
              <li><strong>{metric("shown")}</strong> Demonstrated</li><li><strong>{metric("partial")}</strong> Partial</li><li><strong>{metric("unclear")}</strong> Not evidenced</li>
            </ul>
          ) : null}
          {score !== null ? (
            <div className="analysis-feedback" role="group" aria-label="Review this analysis">
              <span className="analysis-feedback-label">Was this analysis helpful?</span>
              <div className="analysis-feedback-buttons">
                {[["up", "Helpful analysis", THUMB_UP], ["down", "Not helpful analysis", THUMB_DOWN]].map(([rating, label, svg]) => (
                  <button key={rating} type="button" data-act="review" data-rating={rating} aria-label={label} title={label} aria-pressed={fb.rating === rating}
                    disabled={fb.disabled} onClick={() => review(rating)}>{svg}</button>
                ))}
              </div>
              <span className={`analysis-feedback-status${fb.error ? " is-error" : ""}`} role="status" aria-live="polite">{fb.message}</span>
            </div>
          ) : null}
        </div>
        {busy === "checking" ? <p className="analysis-loading" role="status"><Spinner />Updating analysis… Previous result shown.</p> : null}
        {rows.length ? <Insights rows={rows} mappable={mappable} onJump={onJump} />
          : <p className="match-msg">{hasBreakdown ? "No requirement findings were returned." : "The stored analysis has no requirement breakdown. Reanalyze for current details."}</p>}
        <div className="analysis-links">
          {rows.length ? (
            <button type="button" className="breakdown-open" data-act="breakdown" aria-haspopup="dialog" aria-expanded={s.breakdownOpen} aria-controls="requirement-breakdown"
              onClick={() => setBreakdownOpen(!sRef.current.breakdownOpen)}>Full requirement breakdown ({rows.length})</button>
          ) : null}
          <details className="scoring-help"><summary>How scoring works</summary>
            <div className="scoring-explanation"><p>The score measures resume evidence coverage of extracted requirements. Required items carry more weight than responsibilities or preferences, and partial evidence contributes to coverage. It is not a prediction of hiring outcomes.</p><Notes result={result} /></div>
          </details>
        </div>
        {rows.length ? (
          <dialog ref={dialog} className="requirement-breakdown" id="requirement-breakdown" aria-labelledby="breakdown-title"
            onCancel={(e) => { e.preventDefault(); setBreakdownOpen(false); }}
            onClick={(e) => {
              if (e.target !== dialog.current) return;
              const b = dialog.current.getBoundingClientRect();
              if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) setBreakdownOpen(false);
            }}>
            <div className="breakdown-head"><h3 id="breakdown-title">Requirement breakdown</h3>
              <button type="button" data-act="breakdown-close" aria-label="Close requirement breakdown" onClick={() => setBreakdownOpen(false)}>Close</button></div>
            <div className="breakdown-filters" role="group" aria-label="Filter requirements by status">
              {[["all", "All"], ["shown", "Demonstrated"], ["partial", "Partial"], ["unclear", "Not found"]].map(([status, label]) => (
                <button key={status} type="button" data-act="filter-status" data-filter-status={status} aria-pressed={s.breakdownFilter === status}
                  onClick={() => update({ breakdownFilter: status })}>{label} <span>{status === "all" ? rows.length : metric(status)}</span></button>
              ))}
            </div>
            <p className="breakdown-results" role="status" aria-live="polite">{visible} of {rows.length} requirements</p>
            <p className="breakdown-note">Match status describes evidence in this resume. Open a row to explore available evidence.</p>
            <div className="breakdown-content">
              {GROUPS.map(([kind, title]) => {
                const group = rows.filter((f) => inGroup(kind, f));
                if (!group.length) return null;
                const shown = group.filter((f) => s.breakdownFilter === "all" || f.status === s.breakdownFilter).length;
                return (
                  <section key={kind} className="requirement-group" hidden={shown === 0}>
                    <h4>{title} <span data-group-count="">{s.breakdownFilter === "all" ? String(shown) : `${shown} / ${group.length}`}</span></h4>
                    <ul className="requirement-rows">
                      {group.map((f) => {
                        const index = rows.indexOf(f);
                        return (
                          <li key={index} data-status={f.status} hidden={s.breakdownFilter !== "all" && f.status !== s.breakdownFilter}>
                            <details className="requirement-row" data-index={index} open={s.expanded.has(index)}
                              onToggle={(e) => {
                                const open = e.currentTarget.open;
                                if (open === sRef.current.expanded.has(index)) return;
                                const next = new Set(sRef.current.expanded);
                                if (open) next.add(index); else next.delete(index);
                                update({ expanded: next });
                              }}>
                              <summary><span className={`requirement-dot is-${f.status}`} aria-hidden="true"></span><span className="requirement-row-text">{f.text}</span>
                                <span className={`requirement-row-status is-${f.status}`} title={STATUS_LABEL[f.status]}>{ROW_STATUS[f.status]}</span>{CHEVRON}</summary>
                              <div className="requirement-evidence">
                                {f.evidence ? <blockquote aria-label="Resume evidence">{f.evidence}</blockquote> : null}
                                {f.explanation ? <p>{f.explanation}</p> : null}
                                <p className="requirement-navigation"><Locate text={f.text} mappable={mappable} onJump={onJump} fallback="Original wording shown above.">Find in JD</Locate></p>
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              <p className="breakdown-empty" hidden={visible !== 0}>No requirements match this status.</p>
            </div>
            <button type="button" className="breakdown-collapse" data-act="breakdown-close" onClick={() => setBreakdownOpen(false)}>Close breakdown</button>
          </dialog>
        ) : null}
      </div>
    );
  } else if (s.signedOut) {
    content = <div className="analysis-entry analysis-entry-upload">{heading}{uploadButton}<p className="match-msg">Add a resume to analyse this job.</p></div>;
  } else if (!s.loaded) {
    content = <div className="analysis-entry">{heading}<p className="analysis-loading" role="status"><Spinner />Loading resume…</p></div>;
  } else if (s.message && s.message.kind === "error" && !cache.listing) {
    content = <div className="analysis-entry">{heading}<p className="match-msg">Analysis unavailable</p></div>;
  } else if (!cache.items.length) {
    content = <div className="analysis-entry analysis-entry-upload">{heading}{uploadButton}<p className="match-msg">Add a resume to analyse this job.</p></div>;
  } else if (s.showToolbar) {
    content = (
      <>
        {toolbar}
        {busy === "checking" || busy === "loading"
          ? <p className="analysis-loading" role="status"><Spinner />{busy === "checking" ? "Analyzing resume…" : "Loading saved analysis…"}</p>
          : <p className="match-msg">Analyze this resume against the selected job.</p>}
      </>
    );
  } else {
    content = (
      <>
        <div className="analysis-entry analysis-entry-ready">{heading}
          <div className="analysis-resume-controls"><div className="analysis-entry-picker">{picker}</div></div>
          <div className="analysis-entry-actions">{action}</div>
        </div>
        {busy === "checking" || busy === "loading"
          ? <p className="analysis-loading" role="status"><Spinner />{busy === "checking" ? "Analyzing resume…" : "Loading analysis…"}</p> : null}
      </>
    );
  }

  const limit = cache.limitHit;
  const outdated = current && cache.stale.get(key(current, job.job_id));
  const message = s.message;

  return (
    <>
      <section ref={host} className={`detail-match${result ? " is-analyzed" : ""}`} id="detail-match" aria-label="Resume match"
        onKeyDown={(e) => {
          if (pickerKeydown(e) || e.key !== "Escape") return;
          const menu = e.target.closest("details[open]");
          if (menu) { menu.open = false; menu.querySelector("summary").focus({ preventScroll: true }); }
          else if (sRef.current.breakdownOpen && e.target.closest(".requirement-breakdown")) setBreakdownOpen(false);
          else return;
          e.preventDefault(); e.stopPropagation();
        }}>
        <div className="analysis-shell" aria-busy={String(!!busy)}>
          {content}
          {limit && !limit.canUnlock ? (
            <div className="limit-box" role="status"><p><strong>You've used all {limit.limit} resume checks for today.</strong> More open up {untilReset(limit.resetsAt)}. Saved results stay available.</p></div>
          ) : null}
          {limit && limit.canUnlock ? (
            <form className="limit-box limit-form" data-limit-form="" noValidate onSubmit={(e) => { e.preventDefault(); if (sRef.current.busy !== "unlocking") unlock(e.currentTarget); }}>
              <p><strong>You've used today's {limit.limit} resume checks.</strong> Tell us how resume matching is working for you to unlock {limit.bonus} more today.</p>
              <fieldset className="limit-rating"><legend>How useful has resume matching been?</legend>
                {[1, 2, 3, 4, 5].map((n) => <label key={n}><input type="radio" name="limit-rating" value={n} required /><span>{n}</span></label>)}
                <span className="limit-scale" aria-hidden="true">1 not useful · 5 very useful</span>
              </fieldset>
              <label className="limit-message"><span>What's working, and what should be better?</span>
                <textarea name="limit-message" rows="3" minLength="20" maxLength="2000" required placeholder="At least 20 characters"></textarea></label>
              {s.unlockError ? <p className="match-msg error" role="alert">{s.unlockError}</p> : null}
              <button type="submit" className="match-run analysis-primary" disabled={busy === "unlocking"}>
                {busy === "unlocking" ? "Sending…" : `Send feedback and unlock ${limit.bonus} check${limit.bonus === 1 ? "" : "s"}`}
              </button>
            </form>
          ) : null}
          {!limit && cache.lastUsage && cache.lastUsage.remaining <= 5
            ? <p className="match-fine limit-left">{cache.lastUsage.remaining} resume check{cache.lastUsage.remaining === 1 ? "" : "s"} left today</p> : null}
          {message ? (
            <p className={`match-msg ${message.kind}`} role="status">{message.text}
              {!cache.items.length && !s.signedOut && !busy ? <button type="button" className="analysis-retry" data-act="retry" onClick={start}>Retry</button> : null}</p>
          ) : null}
          {hasDescription === false ? <p className="match-msg">This job has no description to compare against.</p> : null}
          {outdated && !result ? <p className="match-msg">{outdated === "description" ? "The job description has changed." : "The analysis has been updated."} Analyze your resume for current results.</p> : null}
        </div>
        <input ref={input} type="file" accept={Import.ACCEPT} hidden
          onChange={(e) => { const file = e.target.files && e.target.files[0]; e.target.value = ""; if (file) upload(file); }} />
      </section>
      <div className="description-controls" hidden={!result || !hasBreakdown || hasDescription !== true}>
        <h3>Job description</h3>
        <label className="description-highlights"><span>Match highlights</span>
          <input type="checkbox" role="switch" aria-label="Match highlights" aria-controls="detail-body" checked={marksOn}
            onChange={(e) => { setMarksEnabled(e.target.checked); setMarksOn(e.target.checked); }} />
          <span className="highlight-switch" aria-hidden="true"></span>
        </label>
      </div>
    </>
  );
}
