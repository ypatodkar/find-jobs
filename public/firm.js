(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  const firmId = params.get("id");
  const firm = VC_FIRMS.find((f) => f.id === firmId);

  const el = {
    name: document.getElementById("firm-name"),
    tier: document.getElementById("firm-tier"),
    focus: document.getElementById("firm-focus"),
    stats: document.getElementById("firm-stats"),
    controls: document.getElementById("job-controls"),
    mobileFilterToggle: document.getElementById("mobile-filter-toggle"),
    mobileFilterBackdrop: document.getElementById("mobile-filter-backdrop"),
    viewTabs: document.getElementById("job-view-tabs"),
    resultsBar: document.getElementById("job-results-bar"),
    jobList: document.getElementById("job-list"),
    message: document.getElementById("firm-message"),
    footerNote: document.getElementById("footer-note"),
  };

  const esc = JobsUI.escapeHtml;

  function showMessage(html) {
    el.message.innerHTML = html;
    el.message.hidden = false;
  }

  // Modal-sheet behaviour under 720px — focus trap, scroll lock, live result count.
  // Shared with all.js rather than duplicated; see filter-drawer.js.
  const drawer = FilterDrawer.create({
    controls: el.controls,
    toggle: el.mobileFilterToggle,
    backdrop: el.mobileFilterBackdrop,
    closeBtn: document.getElementById("filter-drawer-close"),
    applyBtn: document.getElementById("filter-drawer-apply"),
    countSource: document.getElementById("count-flat"),
    titleId: "filter-drawer-title",
  });

  function showJobsUI() {
    el.controls.hidden = false;
    el.viewTabs.hidden = false;
    el.resultsBar.hidden = false;
    el.jobList.hidden = false;
    if (drawer) drawer.reveal();
  }

  if (!firm) {
    el.name.textContent = "Firm not found";
    el.tier.textContent = "Find Jobs";
    el.focus.textContent = "No investor matches that link. Browse the investor directory to choose one.";
    el.footerNote.textContent = "Choose an investor from the directory to see its portfolio roles and company-board listings.";
    showMessage(`<p><a class="joblink" href="firms.html">Browse all investors →</a></p>`);
    return;
  }

  document.title = firm.name + " jobs — Find Jobs";
  el.name.textContent = firm.name;
  el.tier.textContent = TIER_META[firm.tier].label;
  el.focus.textContent = firm.focus;

  const view = JobsUI.createJobsView({
    showFirms: false,
    contextLabel: firm.short || firm.name,
  });

  // The footer button reads the count the results header renders, which is repainted
  // after the filter state settles rather than during it.
  view.onChange(() => drawer && drawer.syncCount());

  fetch("api/firm/" + encodeURIComponent(firmId) + ".json")
    .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
    .then((data) => {
      if (data.status === "unsupported") {
        el.stats.innerHTML = `<span>Board unavailable for automatic checks</span>`;
        el.footerNote.textContent = "This investor does not expose a portfolio board that Find Jobs can check automatically.";
        showMessage(
          `<p><strong>This firm's portfolio board can't be checked automatically.</strong></p>
           <p>${esc(data.reason || "No public job board.")}</p>
           ${firm.url ? `<p><a class="joblink" href="${esc(firm.url)}" target="_blank" rel="noopener noreferrer">${esc(firm.urlLabel || firm.url)}</a></p>` : ""}`
        );
        return;
      }
      if (data.status === "error") {
        el.stats.innerHTML = `<span>Last update failed</span>`;
        el.footerNote.textContent = "Listings for this investor are temporarily unavailable; its board will be checked again automatically.";
        showMessage(`<p><strong>Listings update failed.</strong></p><p>${esc(data.reason || "Unknown error")}</p>`);
        return;
      }

      const jobs = data.jobs || [];
      const live = jobs.filter((j) => j.source === "ats").length;

      el.stats.innerHTML = [
        `${jobs.length} matching roles`,
        live ? `${live} live from company boards` : null,
        data.totalOnBoard != null ? `${data.totalOnBoard.toLocaleString()} jobs on board` : null,
      ].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join("");

      el.footerNote.textContent =
        `Companies discovered via ${data.host}. ` +
        (data.atsCompanies
          ? `${data.atsCompanies} of them publish to Ashby, Greenhouse or Lever, so those ${data.fromAts} roles come straight from the company's own board; the remaining ${data.fromBoard} come from the investor's board.`
          : `Roles come from the investor's portfolio board.`);

      if (jobs.length === 0) {
        el.footerNote.textContent = "No matching engineering roles are open across this investor's tracked portfolio right now.";
        showMessage(`<p>No engineering roles in the tracked metros matched on this board right now.</p>`);
        return;
      }
      // Exposed for viewed.js, which renders before this fetch resolves and so has
      // to be told once the data it joins against actually exists.
      window.JobsData = { all: function () { return jobs; } };
      if (window.Viewed) window.Viewed.refresh();
      view.setJobs(jobs);
      showJobsUI();
    })
    .catch(() => {
      el.stats.innerHTML = `<span>Listings unavailable</span>`;
      el.footerNote.textContent = "Listings for this investor are temporarily unavailable; its board will be checked again automatically.";
      showMessage(
        `<p><strong>We couldn't load listings for this investor.</strong></p>
         <p>Boards are checked automatically twice daily. Please try again after the next update or <a href="firms.html">browse other investors</a>.</p>`
      );
    });
})();
