// Which country's list a visitor sees. The choice lives in this browser (localStorage
// "vc-directory-country": "US" or "IN") and is made with the switch at the top of
// either list. No choice means the US list, as before India existed.
//
// One choice is made for the visitor: a first visit to the home page on India's clock.
// index.html's start-up script sends that visitor to the India list before anything
// loads, saves India as the choice, and marks the visit (sessionStorage
// "vc-directory-country-auto") so the India page can say why it opened and offer the
// way back. That script runs before this module exists, so it repeats the key names;
// test/country.test.js runs it as written.

// `inTitle` completes "Find Jobs in …"; `name` and `detail` are the menu's two lines.
export const COUNTRIES = [
  { code: "US", inTitle: "the US", name: "United States", detail: "San Francisco, New York, Seattle and 16 more metros", href: "./" },
  { code: "IN", inTitle: "India", name: "India", detail: "Bengaluru, Delhi NCR, Hyderabad and 5 more cities", href: "in.html" },
];

const KEY = "vc-directory-country";
const SENT = "vc-directory-country-auto";

export function chosenCountry() {
  try {
    const v = localStorage.getItem(KEY);
    return COUNTRIES.some((c) => c.code === v) ? v : null;
  } catch {
    return null;
  }
}

/** Save a choice from the switch. It ends the "sent here by time zone" note too. */
export function chooseCountry(code) {
  try { localStorage.setItem(KEY, code); } catch { /* private mode: this visit only */ }
  forgetSent();
}

export function wasSent() {
  try { return sessionStorage.getItem(SENT) === "1"; } catch { return false; }
}

export function forgetSent() {
  try { sessionStorage.removeItem(SENT); } catch { /* fine */ }
}

// India has one time zone; "Asia/Calcutta" is its old name, which some systems report.
export const INDIA_ZONE = /^Asia\/(Kolkata|Calcutta)$/;

export function onIndiaClock() {
  try { return INDIA_ZONE.test(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch { return false; }
}

/**
 * The note a list page shows under its description, if any:
 *   "sent"   on the India list, opened by the start-up script: why, and the way back.
 *   "also"   on the US list, for a visitor on India's clock who hasn't chosen: they
 *            used the US list before India existed, so they stay on it but are told.
 */
export function countryNote(page, { chosen = chosenCountry(), indiaClock = onIndiaClock(), sent = wasSent() } = {}) {
  if (page === "IN") return sent ? "sent" : null;
  if (page === "US") return !chosen && indiaClock ? "also" : null;
  return null;
}

/**
 * On opening the India list: a visitor on India's clock who hasn't chosen, arriving by
 * a link, has India saved as their choice, so the home page opens it next time too.
 * Anyone else opening the India list once is just looking; their home page is unchanged.
 */
export function settleCountry(page, { chosen = chosenCountry(), indiaClock = onIndiaClock() } = {}) {
  if (page !== "IN" || chosen || !indiaClock) return false;
  try { localStorage.setItem(KEY, "IN"); return true; } catch { return false; }
}
