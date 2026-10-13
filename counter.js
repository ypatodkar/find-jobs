// The live click counter in the page header.
//
// Reads a single aggregate from the worker — total clicks, distinct jobs, users —
// and shows the total. Nothing identifying is fetched or sent; the per-job breakdown
// stays behind ADMIN_TOKEN on /counts.
//
// Deliberately quiet about failure: if the worker is unreachable, or ENDPOINT is
// unset, the counter simply never appears. A header that says "— job clicks" or
// spins forever is worse than no header at all.
(function (global) {
  "use strict";

  // Same convention as track.js: blank means the feature is off.
  var ENDPOINT = (window.API_ENDPOINT || "https://vcjobs-clicks.ypatodkar.workers.dev");
  var MOUNT_ID = "counter-slot";
  var MIN_TO_SHOW = 10; // below this it reads as "nobody is here", so stay hidden

  // The counts line under the page heading, where the other two totals already are:
  // "12,777 roles · 1,668 companies · 1,165 job clicks". It used to sit in the old
  // masthead's empty middle, and the redesign removed that row — which is why the
  // counter silently stopped appearing rather than breaking loudly.
  function mount() {
    var el = document.getElementById(MOUNT_ID);
    if (el) return el;
    var stats = document.getElementById("all-stats") || document.getElementById("firm-stats");
    if (!stats) return null;
    el = document.createElement("span");
    el.id = MOUNT_ID;
    el.className = "counter-slot";
    stats.appendChild(el);
    return el;
  }

  function render(stats) {
    if (!stats || typeof stats.clicks !== "number") return;
    if (stats.clicks < MIN_TO_SHOW) return;
    var el = mount();
    if (!el) return;
    // A separator only once there is something before it to separate from; the stats
    // line is written asynchronously and may still be empty on a slow catalogue.
    var host = el.parentNode;
    var lead = host && host.firstChild && host.firstChild !== el && (host.textContent || "").trim();
    el.innerHTML =
      (lead ? '<span class="counter-sep" aria-hidden="true"> · </span>' : "") +
      '<span class="counter" title="' +
      stats.jobs + ' different roles opened by ' + stats.users + ' people">' +
      '<svg class="i counter-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z"/>' +
      '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M5 21a2 2 0 0 1-2-2"/>' +
      '<path d="M9 3h1"/><path d="M9 21h2"/><path d="M14 3h1"/><path d="M3 9v1"/><path d="M21 9v2"/><path d="M3 14v1"/></svg>' +
      '<span class="counter-n">' + stats.clicks.toLocaleString() + '</span>' +
      '<span class="counter-label">job clicks</span>' +
      "</span>";
  }

  function load() {
    if (!ENDPOINT) return;
    fetch(ENDPOINT + "/stats", { credentials: "omit" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () {
        return null; // offline, blocked, or worker down — the counter stays absent
      })
      // Outside the catch on purpose: a fetch failure is expected and silent, but a
      // rendering bug should reach the console rather than look like a dead endpoint.
      .then(function (stats) { if (stats) render(stats); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();

  // all.js writes the roles/companies totals once the first page returns, replacing
  // the line's text content. Without this the counter either lands before that write
  // and is wiped, or lands after and reads as a lone figure with no separator.
  var host = document.getElementById("all-stats") || document.getElementById("firm-stats");
  if (host) {
    var settle;
    new MutationObserver(function () {
      if (document.getElementById(MOUNT_ID)) return;
      clearTimeout(settle);
      settle = setTimeout(load, 60);
    }).observe(host, { childList: true, characterData: true, subtree: true });
  }

  global.Counter = { refresh: load };
})(window);
