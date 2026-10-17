// Opening a role, as track.js counts it: a list title opened in a new tab (a plain
// click only selects the row, marked data-selects) or the description's Apply link
// (data-track-open). Each open is remembered in this browser (lib/seen.js), which is
// always on, and reported to the analytics API as an aggregate count, which never
// blocks the link. The first must not depend on the second: an ad blocker or no
// network still leaves your own history intact.
import { ENDPOINT } from "./api.js";
import { seenStore } from "./seen.js";
import { visitorId, visitorName } from "./visitor.js";

const OPENS = "a.job-title[data-job-id], a[data-track-open][data-job-id]";

function onClick(e) {
  const a = e.target && e.target.closest && e.target.closest(OPENS);
  if (!a) return;
  if (a.getAttribute("data-selects") != null && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
  const id = a.getAttribute("data-job-id");
  if (!id) return;
  seenStore.mark(id);
  if (!ENDPOINT || !navigator.sendBeacon) return;
  try {
    // A plain string goes out as text/plain, a CORS-simple request: no preflight.
    navigator.sendBeacon(ENDPOINT + "/click", JSON.stringify({
      job_id: id,
      user_id: visitorId(),
      user_name: visitorName(),
      company: a.getAttribute("data-company") || null,
      title: a.getAttribute("data-title") || a.textContent || null,
      city: a.getAttribute("data-city") || null,
      page: location.pathname.split("/").pop() || "index.html",
      firm: new URLSearchParams(location.search).get("id"),
    }));
  } catch { /* analytics must never break the link */ }
}

// Capture phase, as before, so it runs before the row's own click handler.
if (typeof document !== "undefined") document.addEventListener("click", onClick, true);
