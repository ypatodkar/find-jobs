// The investor directory (firms.html), as app.js: every tracked firm as a card, grouped
// by how central AI is to its thesis, with each firm's live role count. Only firms
// with roles to show are clickable; the rest would open a page that could only
// apologise.
import "../../../data.js"; // the investors, as window.VC_FIRMS and TIER_META
import { useEffect, useState } from "react";
import Masthead, { PRIVACY_NOTE } from "../components/Masthead.jsx";

const TIER_ORDER = ["ai-mega", "generalist", "ai-native", "accelerator"];
const FIRMS = window.VC_FIRMS || [];
const TIERS = window.TIER_META || {};

function Signal({ signal }) {
  const label = `AI investment signal: ${signal} of 3`;
  return (
    <span className="signal" role="img" aria-label={label} title={label}>
      {[1, 2, 3].map((i) => <i key={i} className={i <= signal ? "on" : ""} aria-hidden="true"></i>)}
    </span>
  );
}

function JobsBadge({ firm, r }) {
  if (!firm.id || !r) return null;
  if (r.status === "unsupported") return <span className="jobs-badge none" title={r.reason || ""}>no board</span>;
  if (r.status === "error") return <span className="jobs-badge err" title={r.reason || ""}>update failed</span>;
  if (r.count === 0) return <span className="jobs-badge zero">0 roles</span>;
  return <a className="jobs-badge has" href={`firm.html?id=${encodeURIComponent(firm.id)}`}>{r.count} roles →</a>;
}

function Card({ firm, r }) {
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
    link = <span className="no-board">{firm.urlLabel} · <a href={firm.url} target="_blank" rel="noopener noreferrer">no public board, visit site ↗</a></span>;
  } else if (firm.url) {
    link = <a className="joblink" href={firm.url} target="_blank" rel="noopener noreferrer">{firm.urlLabel}</a>;
  } else {
    link = <span className="no-link">no confirmed public link — search “{firm.name}” directly</span>;
  }
  return (
    <article className={`card${openable ? "" : " card-static"}`} data-name={firm.name.toLowerCase()} onClick={go} onKeyDown={onKey}
      {...(openable ? { "data-href": href, tabIndex: 0, role: "link", "aria-label": `${firm.name} — view ${r.count} roles` } : {})}>
      <div className="card-top">
        <div className="card-name-wrap">
          <p className="card-name">{firm.name}{firm.short ? <> <span className="short">{firm.short}</span></> : null}</p>
          {firm.aum ? <div className="card-aum">{firm.aum}</div> : null}
        </div>
        <span className={`tier-badge ${firm.tier}`}>{TIERS[firm.tier].short}</span>
      </div>
      <p className="card-focus">{firm.focus}</p>
      <div className="card-signal"><Signal signal={firm.signal} />{firm.note ? <span className="signal-note">{firm.note}</span> : null}</div>
      <div className="card-footer">{link}<JobsBadge firm={firm} r={firm.id && r} /></div>
    </article>
  );
}

export default function Firms() {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [onlyBoard, setOnlyBoard] = useState(false);
  const [onlyJobs, setOnlyJobs] = useState(false);
  const [results, setResults] = useState({});

  useEffect(() => {
    fetch("api/results.json").then((r) => r.json()).then((d) => setResults(d.firms || {})).catch(() => {});
  }, []);

  const counts = { all: FIRMS.length };
  TIER_ORDER.forEach((t) => { counts[t] = FIRMS.filter((f) => f.tier === t).length; });
  const chips = [{ key: "all", label: "All" }, ...TIER_ORDER.map((t) => ({ key: t, label: TIERS[t].short }))];
  const stats = [`${FIRMS.length} firms tracked`, ...TIER_ORDER.map((t) => `${counts[t]} ${TIERS[t].short.toLowerCase()}`)];

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

  return (
    <div className="wrap">
      <Masthead nav={[["index.html", "← Find Jobs"], ["about.html", "About"]]}>
        <h1 className="title">Browse by investor</h1>
        <p className="dek">A searchable directory of US venture firms worth tracking for software roles, grouped by how central AI is to each firm's current thesis. Portfolio job boards are checked twice daily for engineering roles across 19 US metros.</p>
        <div className="stats" id="stats" aria-hidden="true">{stats.map((s) => <span key={s}>{s}</span>)}</div>
      </Masthead>

      <div className="controls">
        <div className="search-wrap">
          <svg className="search-icon" width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" />
            <line x1="10.2" y1="10.2" x2="14" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input id="search" type="search" placeholder="Search firm name…" aria-label="Search firms" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="filter-group" role="group" aria-label="Filter by tier" id="tier-filters">
          {chips.map((c) => (
            <button key={c.key} className={`chip${c.key === tier ? " active" : ""}`} data-tier={c.key} aria-pressed={c.key === tier} onClick={() => setTier(c.key)}>
              {c.label}<span className="n">{counts[c.key]}</span>
            </button>
          ))}
        </div>
        <div className="toggle-group">
          <label className="toggle"><input type="checkbox" id="only-board" checked={onlyBoard} onChange={(e) => setOnlyBoard(e.target.checked)} /> <span>Has a public job board</span></label>
          <label className="toggle"><input type="checkbox" id="only-jobs" checked={onlyJobs} onChange={(e) => setOnlyJobs(e.target.checked)} /> <span>Has matching roles</span></label>
        </div>
      </div>

      <p className="results-meta" id="result-count" aria-live="polite">Showing {shown.length} of {FIRMS.length} firms</p>
      <div id="grid" className="grid">{shown.map((f) => <Card key={f.id || f.name} firm={f} r={f.id ? results[f.id] : null} />)}</div>
      <p id="empty-state" className="empty" hidden={shown.length !== 0}>No firms match those filters. Try clearing the search or filters above.</p>

      <footer>
        <div>
          <h3>Reading this list</h3>
          <ul>
            <li>Firms marked <span className="no-board-inline">no public board</span> still hire into portfolio companies — check the firm's own careers page or LinkedIn instead of a dedicated board.</li>
            <li>Most dedicated boards (Getro-powered) let you filter by role — search each one for “backend” / “software engineer” directly rather than browsing.</li>
            <li>The three signal dots show how central AI is to a firm's public investment thesis: more filled dots means a stronger AI focus, not more open jobs.</li>
            <li>AI-signal ratings reflect public reporting as of July 2026 and will shift — treat this as a starting map, not a static ranking.</li>
          </ul>
        </div>
        <div>
          <h3>Built for a focused search</h3>
          <p>Find Jobs brings investor portfolios and company career boards into one searchable directory. Listings are updated automatically twice daily.</p>
        </div>
        {PRIVACY_NOTE}
      </footer>
    </div>
  );
}
