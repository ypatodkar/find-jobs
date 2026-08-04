(function () {
  "use strict";

  const firmName = (id) => {
    const f = VC_FIRMS.find((x) => x.id === id);
    return f ? f.short || f.name : id;
  };

  const stats = document.getElementById("all-stats");
  const controls = document.getElementById("job-controls");
  const mobileFilterToggle = document.getElementById("mobile-filter-toggle");
  const mobileFilterBackdrop = document.getElementById("mobile-filter-backdrop");
  const viewTabs = document.getElementById("job-view-tabs");
  const resultsBar = document.getElementById("job-results-bar");
  const jobList = document.getElementById("job-list");
  const pagination = document.getElementById("job-pagination");
  const message = document.getElementById("all-message");
  const note = document.getElementById("all-note");
  const mobileFilters = window.matchMedia("(max-width: 720px)");

  const view = JobsUI.createJobsView({
    showFirms: true,
    firmLabel: firmName,
  });

  function setMobileFiltersCollapsed(collapsed) {
    const isCollapsed = mobileFilters.matches && collapsed;
    const drawerOpen = mobileFilters.matches && !isCollapsed;
    controls.classList.toggle("mobile-collapsed", isCollapsed);
    mobileFilterToggle.setAttribute("aria-expanded", String(!isCollapsed));
    mobileFilterBackdrop.hidden = !drawerOpen;
    document.body.classList.toggle("filter-drawer-open", drawerOpen);
    const active = mobileFilterToggle.textContent.match(/\d+ active/);
    mobileFilterToggle.setAttribute(
      "aria-label",
      `${isCollapsed ? "Show" : "Hide"} filters${active ? `, ${active[0]}` : ""}`
    );
  }

  function showJobsUI() {
    controls.hidden = false;
    mobileFilterToggle.hidden = false;
    viewTabs.hidden = false;
    resultsBar.hidden = false;
    jobList.hidden = false;
    setMobileFiltersCollapsed(mobileFilters.matches);
  }

  function hideJobsUI() {
    document.body.classList.remove("filter-drawer-open");
    mobileFilterBackdrop.hidden = true;
    controls.hidden = true;
    mobileFilterToggle.hidden = true;
    viewTabs.hidden = true;
    resultsBar.hidden = true;
    jobList.hidden = true;
    pagination.hidden = true;
  }

  mobileFilterToggle.addEventListener("click", () => {
    if (!mobileFilters.matches) return;
    const collapse = !controls.classList.contains("mobile-collapsed");
    setMobileFiltersCollapsed(collapse);
    if (!collapse) requestAnimationFrame(() => document.getElementById("job-search")?.focus());
  });
  mobileFilterBackdrop.addEventListener("click", () => {
    setMobileFiltersCollapsed(true);
    mobileFilterToggle.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !mobileFilters.matches || controls.classList.contains("mobile-collapsed")) return;
    setMobileFiltersCollapsed(true);
    mobileFilterToggle.focus();
  });
  mobileFilters.addEventListener("change", (event) => {
    if (!controls.hidden) setMobileFiltersCollapsed(event.matches);
  });

  /**
   * Reverse pipeline.js's packCompanies: put each company's facts back onto its
   * rows, so every consumer downstream sees the same job objects it always has.
   *
   * The field list rides along in the payload rather than being repeated here, and
   * a payload without a companies table is passed through unchanged — a browser
   * holding a cached copy of the old flat shape still renders.
   */
  function expand(data) {
    const companies = data.companies;
    if (!companies) return data.jobs || [];
    const fields = data.companyFields || [];
    return (data.jobs || []).map(function (job) {
      const co = companies[job.c] || {};
      const out = {};
      for (const k in job) if (k !== "c") out[k] = job[k];
      out.company = co.n;
      // Absent means empty, which is what it meant before packing too; every reader
      // already guards with `|| []` or `|| null`.
      for (const f of fields) if (co[f] !== undefined) out[f] = co[f];
      return out;
    });
  }

  function load() {
    // Relative, and ending in .json: server.js answers this path live, and build.js
    // writes a real file at the same path. Relative matters because Pages serves a
    // project repo from a subdirectory, where a leading "/" would miss.
    return fetch("api/all-jobs.json")
    .then((r) => {
      if (!r.ok) throw new Error(`Job data request failed (${r.status})`);
      return r.json();
    })
    .then((data) => {
      const jobs = expand(data);
      if (!jobs.length) {
        hideJobsUI();
        view.setJobs([]);
        stats.innerHTML = "<span>No data yet</span>";
        message.hidden = false;
        message.innerHTML =
          `<p><strong>No roles are available yet.</strong></p>
           <p>Job boards are checked automatically twice daily. Please check back after the next update.</p>`;
        return;
      }
      message.hidden = true;

      const companies = new Set(jobs.map((j) => j.company)).size;
      const investors = new Set(jobs.flatMap((j) => j.firms || [])).size;
      const live = jobs.filter((j) => j.source === "ats").length;

      stats.innerHTML = [
        `${jobs.length.toLocaleString()} roles`,
        `${companies} companies`,
        `${investors} investors`,
        `${live.toLocaleString()} live from company boards`,
      ].map((s) => `<span>${JobsUI.escapeHtml(s)}</span>`).join("");

      const multi = jobs.filter((j) => (j.firms || []).length > 1).length;
      note.textContent =
        `Merged across every tracked portfolio and deduplicated on company, title, and city — ` +
        `${multi.toLocaleString()} of these roles are at companies backed by more than one investor. ` +
        `Where a company publishes to its own applicant tracking system, that live listing is preferred over the investor's board.`;

      // Exposed for viewed.js, which renders before this fetch resolves and so has
      // to be told once the data it joins against actually exists.
      window.JobsData = { all: function () { return jobs; } };
      if (window.Viewed) window.Viewed.refresh();
      view.setJobs(jobs);
      showJobsUI();
    })
    .catch(() => {
      hideJobsUI();
      view.setJobs([]);
      stats.innerHTML = "<span>No job data</span>";
      message.hidden = false;
      message.innerHTML =
        `<p><strong>We couldn't load the job data.</strong></p>
         <p>Please try again shortly. Listings are updated automatically twice daily.</p>`;
    });
  }

  load();
})();
