// Two separate concerns, deliberately in one file because both hang off the same click:
//
//   1. "Seen" memory — which roles you have opened. Per browser, in localStorage,
//      no account and no server. Always on.
//   2. Click analytics — aggregate counts for the site owner. Needs a deployed
//      Worker, so it stays off until ENDPOINT is set.
//
// (1) must not depend on (2). Someone with no Worker deployed, or an ad blocker, or
// no network still gets their own history — it never leaves the browser.
(function (global) {
  "use strict";

  // Your deployed Worker, e.g. "https://vcjobs-clicks.<subdomain>.workers.dev".
  // Left blank, analytics stay off — "seen" is unaffected either way.
  var ENDPOINT = (window.API_ENDPOINT || "https://vcjobs-clicks.ypatodkar.workers.dev");

  var KEY = "vc-directory-seen";
  var MAX_ENTRIES = 5000; // ~250 KB of JSON; well inside the ~5 MB localStorage budget
  var SELECTOR =
    "a.description-original[data-job-id], a.job-card-open[data-job-id], a.job-open-role[data-job-id]";

  // ---- store ------------------------------------------------------------------
  // { job_id: timestamp }. Falls back to memory-only if localStorage is unavailable
  // (Safari private mode throws on write), so the page never breaks over history.
  var seen = read();
  var seenCount = Object.keys(seen).length;
  var revision = 0;
  var persistent = true;

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function write() {
    if (!persistent) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(seen));
    } catch (_) {
      persistent = false; // quota or private mode — keep working in memory
    }
  }

  // Drops the oldest entries rather than refusing new ones: recent history is the
  // part anyone actually looks at.
  function prune() {
    if (seenCount <= MAX_ENTRIES) return;
    var ids = Object.keys(seen);
    ids.sort(function (a, b) { return seen[a] - seen[b]; })
       .slice(0, ids.length - MAX_ENTRIES)
       .forEach(function (id) { delete seen[id]; });
    seenCount = MAX_ENTRIES;
  }

  function mark(id, ts) {
    if (!id || seen[id]) return false;
    seen[id] = ts || Date.now();
    seenCount++;
    prune();
    revision++;
    write();
    if (global.dispatchEvent) global.dispatchEvent(new Event('seenchange'));
    return true;
  }

  // ---- rendering --------------------------------------------------------------
  // The result list is replaced wholesale on every filter change, sort, page change,
  // and view toggle, so marking is re-applied from a MutationObserver rather than
  // done once. That also keeps this file independent of jobs-ui.js's render path.
  // The row shows the status itself (see jobHtml in jobs-ui.js); this keeps the class
  // and the card's spoken label in step with it.
  function paint(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll(".job[data-job-id]");
    for (var i = 0; i < nodes.length; i++) {
      var row = nodes[i];
      var opened = !!seen[row.getAttribute("data-job-id")];
      row.classList.toggle("row-seen", opened);
      var link = row.querySelector("[data-label]");
      if (link) link.setAttribute("aria-label", link.getAttribute("data-label") + (opened ? ". Opened before" : ""));
    }
  }

  var queued = false;
  function repaint() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      paint(document);
    });
  }

  // ---- wiring -----------------------------------------------------------------
  function init() {
    paint(document);

    var target = document.getElementById("job-list") || document.body;
    new MutationObserver(repaint).observe(target, { childList: true, subtree: true });

    document.addEventListener(
      "click",
      function (e) {
        // A card click that something already handled is a preview, not an open.
        // The description pane cancels the navigation to show the posting beside
        // the list; counting that as an open would inflate every figure on the
        // site with people who only glanced at a role. jobs-api.js registers its
        // listener before this one, so the flag is set by the time we see it.
        if (e.defaultPrevented) return;
        var a = e.target && e.target.closest && e.target.closest(SELECTOR);
        if (!a) return;
        var id = a.getAttribute("data-job-id");
        if (!id) return;

        // Mark first and paint this row immediately — the user opened a new tab, so
        // the row stays on screen and should update now, not on the next render.
        if (mark(id)) {
          paint(document);
          if (global.Viewed) global.Viewed.refresh();
          // The "(N)" beside every company name is derived from this same set, and
          // the list is not re-rendered on a click — so nudge the badges that are
          // already on screen, including the one on this row.
          if (global.JobsUI && global.JobsUI.refreshOpenedCounts) global.JobsUI.refreshOpenedCounts();
        }

        if (!ENDPOINT || !navigator.sendBeacon) return;
        try {
          // A plain string goes out as text/plain, which is a CORS-simple request —
          // no preflight, so the Worker needs no OPTIONS handler.
          navigator.sendBeacon(
            ENDPOINT + "/click",
            JSON.stringify({
              job_id: id,
              user_id: global.Visitor ? global.Visitor.id() : null,
              user_name: global.Visitor ? global.Visitor.name() : null,
              company: a.getAttribute("data-company") || null,
              title: a.getAttribute("data-title") || a.textContent || null,
              city: a.getAttribute("data-city") || null,
              page: location.pathname.split("/").pop() || "index.html",
              firm: new URLSearchParams(location.search).get("id"),
            })
          );
        } catch (_) {
          /* analytics must never break the link */
        }
      },
      true
    );
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ---- public API ---------------------------------------------------------------
  global.Seen = {
    has: function (id) { return !!seen[id]; },
    at: function (id) { return seen[id] || 0; },
    // Called once per job by the company filter; never enumerate history here.
    count: function () { return seenCount; },
    revision: function () { return revision; },
    ids: function () { return Object.keys(seen); },
    clear: function () {
      seen = {};
      seenCount = 0;
      revision++;
      write();
      repaint();
      if (global.dispatchEvent) global.dispatchEvent(new Event('seenchange'));
    },
  };
})(window);
