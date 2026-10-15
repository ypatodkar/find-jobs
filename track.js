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
  var SELECTOR = "a.job-title[data-job-id]";
  // What counts as opening a role: a list title, or the description pane's Apply link.
  // Only list titles are painted as seen, so painting keeps the narrower SELECTOR.
  var OPENS = SELECTOR + ", a[data-track-open][data-job-id]";

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
    // auth.js listens and copies it to a signed-in account.
    try { global.dispatchEvent(new CustomEvent("seen-change", { detail: { id: id, ts: seen[id] } })); } catch (_) {}
    return true;
  }

  // ---- rendering --------------------------------------------------------------
  // The result list is replaced wholesale on every filter change, sort, page change,
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
      // The stamp is centred on the whole row, so the row carries a class too.
      var row = a.closest ? a.closest(".job") : null;
      if (row) row.classList.toggle("row-seen", on);
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
    // An opened role gets a faint round "clicked" stamp in the empty middle of the
    // row, plus a barely-there purple tint on the title. Colours come from the
    // existing tokens so this tracks both themes and every data-ui mode.
    var css =
      // very subtle purple wash over the row, and a purple-leaning title
      ".job.row-seen{position:relative;opacity:.88}" +
      "a.job-title.is-seen{color:color-mix(in oklab,var(--accent) 42%,var(--ink-faint))}" +

      // the stamp: two rings and rotated type, sitting in the gap between the
      // title block and the tag block
      ".job.row-seen::after{content:'clicked';position:absolute;left:50%;top:50%;" +
      "width:62px;height:62px;transform:translate(-50%,-50%) rotate(-14deg);" +
      "display:grid;place-items:center;box-sizing:border-box;" +
      "border:2px solid var(--accent);border-radius:50%;" +
      "box-shadow:inset 0 0 0 3px transparent,inset 0 0 0 4px var(--accent);" +
      "font-family:var(--font);font-size: var(--text-sm);font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
      "color:var(--accent);opacity:.17;pointer-events:none}" +

      // the row stacks on narrow screens and the middle is no longer empty
      "@media (max-width:720px){.job.row-seen::after{display:none}}" +
      "@media (prefers-reduced-motion:no-preference){.job.row-seen::after{transition:opacity .15s}}";
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
        var a = e.target && e.target.closest && e.target.closest(OPENS);
        if (!a) return;
        // On pages with a description pane a plain click on a title selects the row
        // and stays on the page; only a modified click actually opens the posting.
        if (a.getAttribute("data-selects") != null && e.button === 0 && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return;
        var id = a.getAttribute("data-job-id");
        if (!id) return;

        // Mark first and paint this row immediately — the user opened a new tab, so
        // the row stays on screen and should update now, not on the next render.
        if (mark(id)) {
          // The whole document, not just around the link: from the pane's Apply link
          // the row to mark is in the list, not next to it.
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
    clear: function () {
      seen = {};
      seenCount = 0;
      revision++;
      write();
      repaint();
    },
    /** A copy of the whole history, { job_id: ts }, for signing in. */
    all: function () {
      var out = {};
      for (var k in seen) out[k] = seen[k];
      return out;
    },
    /**
     * Add history from a signed-in account (another device). A union that keeps the
     * earliest time per job, so merging can only add stamps, never move or drop one.
     */
    merge: function (map) {
      if (!map || typeof map !== "object") return;
      var changed = false;
      for (var id in map) {
        var ts = Number(map[id]);
        if (!id || !(ts > 0)) continue;
        if (!seen[id]) { seen[id] = ts; seenCount++; changed = true; }
        else if (ts < seen[id]) { seen[id] = ts; changed = true; }
      }
      if (!changed) return;
      prune();
      revision++;
      write();
      repaint();
      if (global.Viewed) global.Viewed.refresh();
      if (global.JobsUI && global.JobsUI.refreshOpenedCounts) global.JobsUI.refreshOpenedCounts();
    },
  };
})(window);
