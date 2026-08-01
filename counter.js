// The live click counter in the page header.
//
// Reads a single aggregate from the worker — total clicks, distinct jobs, visitors —
// and shows the total. Nothing identifying is fetched or sent; the per-job breakdown
// stays behind ADMIN_TOKEN on /counts.
//
// Deliberately quiet about failure: if the worker is unreachable, or ENDPOINT is
// unset, the counter simply never appears. A header that says "— job clicks" or
// spins forever is worse than no header at all.
(function (global) {
  "use strict";

  // Same convention as track.js: blank means the feature is off.
  var ENDPOINT = "https://vcjobs-clicks.ypatodkar.workers.dev";
  var MOUNT_ID = "counter-slot";
  var MIN_TO_SHOW = 10; // below this it reads as "nobody is here", so stay hidden

  function mount() {
    var el = document.getElementById(MOUNT_ID);
    if (el) return el;
    var top = document.querySelector(".masthead-top");
    if (!top) return null;
    el = document.createElement("div");
    el.id = MOUNT_ID;
    // Between the nav on the left and the actions on the right, which is the one
    // genuinely empty spot in the header. The reference node must be a direct child
    // of `top` — #visitor-slot is nested inside .masthead-actions, and passing it
    // here throws NotFoundError.
    var ref = top.querySelector(".masthead-actions");
    if (ref && ref.parentNode === top) top.insertBefore(el, ref);
    else top.appendChild(el);
    return el;
  }

  function render(stats) {
    if (!stats || typeof stats.clicks !== "number") return;
    if (stats.clicks < MIN_TO_SHOW) return;
    var el = mount();
    if (!el) return;
    el.innerHTML =
      '<span class="counter" title="' +
      stats.jobs + ' different roles opened by ' + stats.visitors + ' visitors">' +
      '<span class="counter-dot" aria-hidden="true"></span>' +
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

  global.Counter = { refresh: load };
})(window);
