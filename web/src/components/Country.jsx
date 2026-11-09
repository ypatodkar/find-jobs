// Which country's list this is: the title itself, "Find Jobs in the US ▾", whose
// country opens a menu of the others; and the note under the description that says
// why the visitor is on this list (lib/country.js has the rules).
import { useEffect, useRef, useState } from "react";
import { COUNTRIES, chooseCountry, countryNote, forgetSent, settleCountry } from "../lib/country.js";

/**
 * The page title, with the country as the control that changes it. The menu holds
 * links, not buttons: each country is its own page, and a link can open in a new tab.
 * The heading stays plain text plus one button; the menu sits beside it, since a list
 * of links may not go inside an <h1>.
 */
export function CountryTitle({ current }) {
  const here = COUNTRIES.find((c) => c.code === current) || COUNTRIES[0];
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const trigger = () => ref.current?.querySelector(".country-trigger");

  useEffect(() => {
    if (!open) return;
    const outside = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("click", outside);
    ref.current.querySelector(".country-option")?.focus();
    return () => document.removeEventListener("click", outside);
  }, [open]);

  const onKeyDown = (e) => {
    if (!open) return;
    const items = [...ref.current.querySelectorAll(".country-option")];
    const at = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); trigger()?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[Math.min(items.length - 1, at + 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[Math.max(0, at - 1)]?.focus(); }
    else if (e.key === "Tab" && (e.shiftKey ? at === 0 : at === items.length - 1)) setOpen(false);
  };

  return (
    <div className="country-title" ref={ref} onKeyDown={onKeyDown}>
      <h1 className="title">
        Find Jobs in{" "}
        <button type="button" className="country-trigger" title="Change country"
          aria-expanded={open} aria-controls="country-menu" onClick={() => setOpen(!open)}>
          {here.inTitle}
          <svg className="country-caret" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
        </button>
      </h1>
      {open ? (
        <nav id="country-menu" className="country-menu" aria-label="Jobs by country">
          {COUNTRIES.map((c) => (
            <a key={c.code} className="country-option" href={c.href} aria-current={c.code === current ? "page" : undefined}
              onClick={(e) => {
                chooseCountry(c.code);
                if (c.code === current) { e.preventDefault(); setOpen(false); trigger()?.focus(); } // already here
              }}>
              <span className="country-option-name">{c.name}</span>
              <span className="country-option-detail">{c.detail}</span>
            </a>
          ))}
        </nav>
      ) : null}
    </div>
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
