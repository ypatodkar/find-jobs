// The page header, as each page's HTML has it, with the pieces the old scripts
// inserted in the same places: the click counter between the nav and the actions; the
// heart first among the actions and feedback just before the LinkedIn link.
//
// `nav`: the links at the top left, as [href, text]. `extras`: the heart, counter and
// feedback (every page but About). `account`: Google sign-in (the pages with jobs).
// Below the top row, each page puts its own title and description as children.
import { AccountSlot } from "./Account.jsx";
import { Counter, Feedback, Heart, ThemeToggle } from "./HeaderExtras.jsx";

export default function Masthead({ compact = false, nav, extras = true, account = false, children }) {
  return (
    <header className={`masthead${compact ? " masthead-compact" : ""}`}>
      <div className="masthead-top">
        <div className="nav-links">
          {nav.map(([href, text]) => <a key={href} className="backlink" href={href}>{text}</a>)}
        </div>
        {extras ? <Counter /> : null}
        <div className="masthead-actions">
          {extras ? <><Heart /><div id="visitor-slot"></div></> : null}
          {account ? <AccountSlot /> : null}
          {extras ? <Feedback /> : null}
          <a className="masthead-link" href="https://lnkd.in/p/g2hge79J" target="_blank" rel="noopener noreferrer" aria-label="This project on LinkedIn" title="LinkedIn">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true" focusable="false">
              <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1s2.48 1.12 2.48 2.5zM.22 8.02h4.56V24H.22zM8.34 8.02h4.37v2.18h.06c.61-1.15 2.1-2.37 4.32-2.37 4.62 0 5.47 3.04 5.47 6.99V24h-4.56v-7.28c0-1.74-.03-3.98-2.42-3.98-2.42 0-2.79 1.89-2.79 3.85V24H8.34z" />
            </svg>
          </a>
          <ThemeToggle />
        </div>
      </div>
      {children}
    </header>
  );
}

export const PRIVACY_NOTE = (
  <p className="privacy-note">
    Browsing preferences are saved in this browser. Optional Google sign-in saves your
    account, resumes, saved jobs, and analysis results on our server. Resume analysis
    sends extracted resume text and the job description to TypeSafe AI. Removing a resume
    hides it from your account, but its stored text and match results stay on our server;
    clearing browser data does not delete server records either. <a href="about.html">More about your data</a>.
  </p>
);
