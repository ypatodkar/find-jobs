// The small things in the header: the theme toggle, the like heart, the live click
// counter, the feedback form and the startup of the day.
//
// All of them are quiet about failure: no endpoint, an unreachable API or a missing
// featured.json means the piece is simply absent, never a broken or empty one. The one
// exception is feedback that fails to send, which says so.
import { useEffect, useRef, useState } from "react";
import { ENDPOINT } from "../lib/api.js";
import { toggleTheme, useTheme } from "../lib/theme.js";
import { visitorId, visitorName } from "../lib/visitor.js";

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: this visit only */ } },
};

// ---- theme ----
export function ThemeToggle() {
  const isDark = useTheme() === "dark";
  const label = `Switch to ${isDark ? "light" : "dark"} mode`;
  return (
    <button id="theme-toggle" className="theme-toggle" type="button" aria-label={label} aria-pressed={isDark} title={label} onClick={toggleTheme}>
      <span className="theme-icon" aria-hidden="true">◐</span>
    </button>
  );
}

// ---- the heart: given once, never taken back ----
const LIKED = "vc-directory-liked";
export function Heart() {
  const [on, setOn] = useState(() => store.get(LIKED) === "1");
  const [pop, setPop] = useState(false);
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
    setPop(true); // one-off pop, see styles.css
  };
  return (
    <div id="heart-slot">
      <button type="button" className={`heart${on ? " is-liked" : ""}${pop ? " just-liked" : ""}`} aria-pressed={on}
        title={on ? "Thanks for the love" : "Like this site"} aria-label={on ? "You liked this site" : "Like this site"} onClick={like}>
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 20.7 3.9 12.6a5.1 5.1 0 0 1 7.2-7.2l.9.9.9-.9a5.1 5.1 0 1 1 7.2 7.2z" /></svg>
      </button>
    </div>
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
  return (
    <div id="counter-slot">
      <span className="counter" title={`${Number(stats.jobs).toLocaleString()} different roles opened by ${Number(stats.users).toLocaleString()} people`}>
        <span className="counter-dot" aria-hidden="true"></span>
        <span className="counter-n">{stats.clicks.toLocaleString()}</span>
        <span className="counter-label">job clicks</span>
      </span>
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

export function Feedback() {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(null); // optional; never pre-ticked
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // { text, error }
  const [sent, setSent] = useState(() => store.get(SENT) === "1");
  const slot = useRef(null);
  const text = useRef(null);
  const contact = useRef(null);

  const close = () => { setOpen(false); setDone(null); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") close(); };
    // Capture, so a click that re-renders the widget is judged before it changes.
    const onClick = (e) => { if (slot.current && !slot.current.contains(e.target)) close(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick, true); };
  }, [open]);

  useEffect(() => { if (open && !done) text.current?.focus(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sent message thanks, then closes itself.
  useEffect(() => {
    if (!done || done.error) return;
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
        setDone({ text: "Thank you — that's on its way to me.", error: false });
      })
      .catch(() => setDone({ text: "That didn't send. Please try again in a moment.", error: true }))
      .finally(() => setBusy(false));
  };

  // Nudges until someone has written in once.
  const nudge = !sent && !open;
  return (
    <div id="feedback-slot" ref={slot}>
      <div className={`fb-wrap${open ? " is-open" : ""}`}>
        <button type="button" className={`fb-btn${nudge ? " is-nudging" : ""}`} aria-label="Feedback" aria-expanded={open}
          onClick={() => { if (open) close(); else setOpen(true); }}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.6-.7L3 21l1.9-5A8.2 8.2 0 0 1 4 11.5 8.4 8.4 0 0 1 13 3a8.4 8.4 0 0 1 8 8.5z" />
          </svg><span>Feedback</span>
        </button>
        {open ? (
          <div className="fb-panel" role="dialog" aria-modal="false" aria-labelledby="fb-title">
            {done ? <div className={`fb-done${done.error ? " is-error" : ""}`}>{done.text}</div> : (
              <>
                <div className="fb-head">
                  <span className="fb-title" id="fb-title">Tell me what would make this better</span>
                  <button type="button" className="fb-close" aria-label="Close feedback" onClick={close}>&times;</button>
                </div>
                <form className="fb-form" noValidate onSubmit={submit}>
                  <span className="fb-sub">What's it about? <em>(optional)</em></span>
                  <div className="fb-topics" role="group" aria-label="What is this about? Optional.">
                    {TOPICS.map((t) => (
                      <button key={t.k} type="button" className={`fb-chip${t.k === topic ? " is-on" : ""}`} data-topic={t.k} aria-pressed={t.k === topic}
                        onClick={() => setTopic(topic === t.k ? null : t.k)}>{t.label}</button>
                    ))}
                  </div>
                  <textarea ref={text} className="fb-text" rows="3" maxLength={MAX} placeholder="Anything at all — a missing company, a filter that confused you…" aria-label="Your feedback"></textarea>
                  <input ref={contact} className="fb-contact" type="email" autoComplete="email" placeholder="Email, only if you want a reply" aria-label="Your email, optional" />
                  <div className="fb-actions">
                    <span className="fb-note">Goes straight to me. Nothing else is attached.</span>
                    <button type="submit" className="fb-send" disabled={busy}>{busy ? "Sending…" : "Send"}</button>
                  </div>
                </form>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---- the startup of the day ----
const DAY = 86400000;
// A feature older than staleAfterDays hides itself: a month-old "featured today" is
// worse than an empty masthead.
function stale(data) {
  const limit = Number(data.staleAfterDays || 0);
  if (!limit || !data.current || !data.current.featuredOn) return false;
  const when = new Date(data.current.featuredOn + "T00:00:00").getTime();
  return !!when && Date.now() - when > limit * DAY;
}

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

  if (!f) return <div id="featured-slot"></div>;
  const facts = [f.staffCount ? `${f.staffCount} people` : null, f.stage || null, f.city || null].filter(Boolean).join(" · ");
  return (
    <div id="featured-slot">
      <aside className="featured" aria-labelledby="featured-heading">
        <p className="featured-kicker" id="featured-heading">Startup of the day</p>
        <div className="featured-body">
          <p className="featured-name">{f.company}</p>
          {facts ? <p className="featured-facts">{facts}</p> : null}
          <p className="featured-blurb">{f.blurb}</p>
          <p className="featured-links">
            {f.roles ? <a className="featured-roles" href={`index.html?company=${encodeURIComponent(f.company)}`}>{String(f.roles)} open role{f.roles === 1 ? "" : "s"} →</a> : null}
            {f.domain ? (
              <a className="featured-site" href={/^https?:/.test(f.domain) ? f.domain : "https://" + f.domain} target="_blank" rel="noopener noreferrer">
                {String(f.domain).replace(/^https?:\/\//, "")} ↗
              </a>
            ) : null}
          </p>
        </div>
      </aside>
    </div>
  );
}
