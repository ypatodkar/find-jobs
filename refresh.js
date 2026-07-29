// The scrape trigger + live progress bar. Shared by the home (all roles) page and
// the firms page so there is exactly one implementation of the two-phase progress.

(function (global) {
  "use strict";

  function initRefresh(opts) {
    const cfg = Object.assign({ firmName: (id) => id, onDone: () => {}, idleStatus: null }, opts);

    const btn = document.getElementById("refresh-btn");
    const status = document.getElementById("refresh-status");
    const progress = document.getElementById("refresh-progress");
    const fill = document.getElementById("progress-fill");
    const log = document.getElementById("progress-log");
    if (!btn) return null;

    function setStatus(text) { if (status) status.textContent = text; }

    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Scraping…";
      if (progress) progress.hidden = false;
      if (fill) fill.style.width = "0%";
      if (log) log.textContent = "Starting…";

      const es = new EventSource("/api/refresh");

      // Two phases: VC boards first (discovery), then each company's own ATS.
      // The bar gives each phase half its width.
      es.addEventListener("phase", (e) => {
        const d = JSON.parse(e.data);
        if (d.phase === "ats" && log) log.textContent = `Boards done — fetching ${d.companies} company job boards…`;
      });

      es.addEventListener("progress", (e) => {
        const d = JSON.parse(e.data);
        const frac = d.total ? d.done / d.total : 0;
        if (fill) fill.style.width = (d.phase === "ats" ? 50 + Math.round(frac * 50) : Math.round(frac * 50)) + "%";
        if (!log) return;
        if (d.phase === "ats") {
          log.textContent = `Company boards ${d.done}/${d.total} — ${d.company}${d.state === "ok" ? ` (${d.count} roles)` : " (unreachable)"}`;
        } else if (d.state === "scraping") {
          log.textContent = `Scraping ${cfg.firmName(d.firmId)}… (${d.done}/${d.total})`;
        } else {
          const outcome = d.state === "ok" ? `${d.count} roles` : d.reason || d.state;
          log.textContent = `${cfg.firmName(d.firmId)}: ${outcome} (${d.done}/${d.total})`;
        }
      });

      es.addEventListener("done", (e) => {
        const d = JSON.parse(e.data);
        if (fill) fill.style.width = "100%";
        const en = d.enrichment;
        const total = Object.values(d.firms || {}).reduce((n, f) => n + (f.status === "ok" ? f.count : 0), 0);
        if (log) {
          log.textContent = en
            ? `Done — ${total} roles · ${en.fromAts} live from ${en.reached}/${en.companies} company boards, ${en.fromBoard} from VC boards.`
            : `Done — ${total} matching roles found.`;
        }
        es.close();
        btn.disabled = false;
        btn.textContent = "Refresh all boards";
        cfg.onDone(d);
        setTimeout(() => { if (progress) progress.hidden = true; }, 5000);
      });

      es.onerror = () => {
        // Reachable only in the moment before the page learns it is served statically,
        // where there is no scrape endpoint at all.
        if (log) log.textContent = "Scraping needs the local server — run `node server.js`.";
        es.close();
        btn.disabled = false;
        btn.textContent = "Refresh all boards";
      };
    });

    return {
      setStatus,
      disable: () => { btn.disabled = true; },
      // On static hosting there is no /api/refresh to stream from, so the trigger goes
      // away entirely rather than sitting there failing when clicked.
      hide: (text) => {
        btn.hidden = true;
        if (progress) progress.hidden = true;
        if (text) setStatus(text);
      },
    };
  }

  global.RefreshUI = { initRefresh };
})(window);
