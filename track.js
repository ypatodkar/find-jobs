// Two separate concerns, deliberately in one file because both hang off the same click:
//
//   1. "Seen" memory — which roles you have opened. Per browser, in localStorage,
//      no account and no server. Always on.
//   2. Click analytics — aggregate counts for the site owner. Needs a deployed
//      Worker, so it stays off until ENDPOINT is set.
//
// (1) must not depend on (2). Someone with no Worker deployed, or an ad blocker, or
// no network still gets their own history — it never leaves the browser.
//
// When accounts arrive, signing up POSTs Seen.exportAll() to associate this browser's
// history with the new user, and Seen.importAll() merges the server's copy back in.
// The account layer is then purely a sync mechanism; this file stays the source of
// truth for what renders.
(function (global) {
  "use strict";

  // Your deployed Worker, e.g. "https://vcjobs-clicks.<subdomain>.workers.dev".
  // Left blank, analytics stay off — "seen" is unaffected either way.
  var ENDPOINT = "";

  var KEY = "vc-directory-seen";
  var MAX_ENTRIES = 5000; // ~250 KB of JSON; well inside the ~5 MB localStorage budget
  var SELECTOR = "a.job-title[data-job-id]";

  // ---- store ------------------------------------------------------------------
  // { job_id: timestamp }. Falls back to memory-only if localStorage is unavailable
  // (Safari private mode throws on write), so the page never breaks over history.
  var seen = read();
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
    var ids = Object.keys(seen);
    if (ids.length <= MAX_ENTRIES) return;
    ids.sort(function (a, b) { return seen[a] - seen[b]; })
       .slice(0, ids.length - MAX_ENTRIES)
       .forEach(function (id) { delete seen[id]; });
  }

  function mark(id, ts) {
    if (!id || seen[id]) return false;
    seen[id] = ts || Date.now();
    prune();
    write();
    return true;
  }

  // ---- rendering --------------------------------------------------------------
  // The result list is replaced wholesale on every filter change, sort, "show more"
  // and view toggle, so marking is re-applied from a MutationObserver rather than
  // done once. That also keeps this file independent of jobs-ui.js's render path.
  function paint(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var nodes = scope.querySelectorAll(SELECTOR);
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var on = !!seen[a.getAttribute("data-job-id")];
      if (on === a.classList.contains("is-seen")) continue;
      a.classList.toggle("is-seen", on);
      if (on) a.setAttribute("title", "You've opened this one");
      else a.removeAttribute("title");
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

  function injectCss() {
    // ::after is already the " ↗" affordance, so the marker uses ::before. Colours
    // come from the existing tokens so it tracks both themes and every data-ui mode.
    var css =
      "a.job-title.is-seen{color:var(--ink-soft)}" +
      "a.job-title.is-seen::before{content:'';display:inline-block;width:6px;height:6px;" +
      "margin-right:7px;border-radius:50%;background:var(--accent);opacity:.6;vertical-align:middle}" +
      "@media (prefers-reduced-motion:no-preference){a.job-title.is-seen::before{transition:opacity .15s}}";
    var el = document.createElement("style");
    el.setAttribute("data-seen-styles", "");
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ---- wiring -----------------------------------------------------------------
  function init() {
    injectCss();
    paint(document);

    var target = document.getElementById("job-list") || document.body;
    new MutationObserver(repaint).observe(target, { childList: true, subtree: true });

    document.addEventListener(
      "click",
      function (e) {
        var a = e.target && e.target.closest && e.target.closest(SELECTOR);
        if (!a) return;
        var id = a.getAttribute("data-job-id");
        if (!id) return;

        // Mark first and paint this row immediately — the user opened a new tab, so
        // the row stays on screen and should update now, not on the next render.
        if (mark(id)) paint(a.parentNode || document);

        if (!ENDPOINT || !navigator.sendBeacon) return;
        try {
          // A plain string goes out as text/plain, which is a CORS-simple request —
          // no preflight, so the Worker needs no OPTIONS handler.
          navigator.sendBeacon(
            ENDPOINT + "/click",
            JSON.stringify({
              job_id: id,
              company: a.getAttribute("data-company") || null,
              title: a.textContent || null,
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

  // ---- public API, for the account layer later --------------------------------
  global.Seen = {
    has: function (id) { return !!seen[id]; },
    count: function () { return Object.keys(seen).length; },
    // POST this on signup to claim this browser's history for the new account.
    exportAll: function () { return JSON.parse(JSON.stringify(seen)); },
    // Merge the server's copy back in after login. Oldest timestamp wins, so a job
    // first opened on another device keeps its original date.
    importAll: function (map) {
      if (!map || typeof map !== "object") return 0;
      var added = 0;
      Object.keys(map).forEach(function (id) {
        var ts = Number(map[id]) || Date.now();
        if (!seen[id] || ts < seen[id]) {
          if (!seen[id]) added++;
          seen[id] = ts;
        }
      });
      prune();
      write();
      repaint();
      return added;
    },
    clear: function () {
      seen = {};
      write();
      repaint();
    },
  };
})(window);
