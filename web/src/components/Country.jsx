// The country switch beside each list's title, and the note under its description
// that says why the visitor is on this list (lib/country.js has the rules).
import { useEffect, useState } from "react";
import { COUNTRIES, chooseCountry, countryNote, forgetSent, settleCountry } from "../lib/country.js";

/** Links, not buttons: each country is its own page, and a link can open in a new tab. */
export function CountrySwitch({ current }) {
  return (
    <nav className="country-switch" aria-label="Jobs by country">
      {COUNTRIES.map((c) => (
        <a
          key={c.code}
          href={c.href}
          aria-current={c.code === current ? "page" : undefined}
          title={`Engineering roles in ${c.name}`}
          onClick={(e) => {
            chooseCountry(c.code);
            if (c.code === current) e.preventDefault(); // already here: just remember it
          }}
        >
          {c.label}
        </a>
      ))}
    </nav>
  );
}

export function CountryNote({ page }) {
  const [note, setNote] = useState(() => countryNote(page));
  useEffect(() => { settleCountry(page); }, [page]);
  if (!note) return null;

  if (note === "sent") {
    return (
      <div className="country-note" role="status">
        <p>You're seeing jobs in India because your time zone is set to India.</p>
        <a href="./" onClick={() => chooseCountry("US")}>Switch to US jobs</a>
        <button type="button" className="country-note-close" aria-label="Dismiss" title="Dismiss"
          onClick={() => { forgetSent(); setNote(null); }}>×</button>
      </div>
    );
  }
  return (
    <div className="country-note" role="status">
      <p>Find Jobs now lists engineering roles in India too.</p>
      <a href="in.html" onClick={() => chooseCountry("IN")}>See jobs in India →</a>
      <button type="button" className="country-note-close" aria-label="Dismiss and stay on US jobs" title="Dismiss"
        onClick={() => { chooseCountry("US"); setNote(null); }}>×</button>
    </div>
  );
}
