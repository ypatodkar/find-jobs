// The page header, as in index.html, with the pieces the old scripts inserted in the
// same places: the click counter between the nav and the actions; the heart first
// among the actions and feedback just before the LinkedIn link.
import { AccountSlot } from "./Account.jsx";
import { Counter, Featured, Feedback, Heart, ThemeToggle } from "./HeaderExtras.jsx";

export default function Masthead() {
  return (
    <header className="masthead masthead-compact">
      <div className="masthead-top">
        <div className="nav-links">
          <a className="backlink" href="firms.html">Browse by investor →</a>
          <a className="backlink" href="about.html">About</a>
        </div>
        <Counter />
        <div className="masthead-actions">
          <Heart />
          <div id="visitor-slot"></div>
          <AccountSlot />
          <Feedback />
          <a className="masthead-link" href="https://lnkd.in/p/g2hge79J" target="_blank" rel="noopener noreferrer" aria-label="This project on LinkedIn" title="LinkedIn">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true" focusable="false">
              <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8.02h4.56V24H.22zM8.34 8.02h4.37v2.18h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V24h-4.56v-7.28c0-1.74-.03-3.98-2.42-3.98-2.42 0-2.79 1.89-2.79 3.85V24H8.34z" />
            </svg>
          </a>
          <ThemeToggle />
        </div>
      </div>
      <div className="masthead-main">
        <h1 className="title">Find Jobs</h1>
        <div className="stats" id="all-stats"></div>
      </div>
      <p className="dek">Engineering roles across all 16 tracked portfolios in a single list. Search across 19 US metros and choose the filters that fit you.</p>
      {/* One small company a day, written up by hand through the /feature command. */}
      <Featured />
    </header>
  );
}
