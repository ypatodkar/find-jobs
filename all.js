(function () {
  "use strict";

  const firmName = (id) => {
    const f = VC_FIRMS.find((x) => x.id === id);
    return f ? f.short || f.name : id;
  };

  const stats = document.getElementById("all-stats");
  const controls = document.getElementById("job-controls");
  const message = document.getElementById("all-message");
  const note = document.getElementById("all-note");

  const view = JobsUI.createJobsView({
    showFirms: true,
    firmLabel: firmName,
    pageSize: 300,
  });

  // Home page owns the scrape trigger; reload the merged list when it finishes.
  const refresh = RefreshUI.initRefresh({
    firmName,
    onDone: () => load(),
  });

  function load() {
    // Relative, and ending in .json: server.js answers this path live, and build.js
    // writes a real file at the same path. Relative matters because Pages serves a
    // project repo from a subdirectory, where a leading "/" would miss.
    return fetch("api/all-jobs.json")
    .then((r) => r.json())
    .then((data) => {
      // No server to scrape on demand once deployed.
      if (data.static && refresh) refresh.hide("Refreshed automatically twice a day");
      const jobs = data.jobs || [];
      if (!jobs.length) {
        stats.innerHTML = "<span>No data yet</span>";
        message.hidden = false;
        message.innerHTML =
          `<p><strong>No roles scraped yet.</strong></p>
           <p>Hit <em>Refresh all boards</em> above to pull listings from every portfolio.</p>`;
        if (refresh) refresh.setStatus("No job data yet — hit refresh to scrape all boards.");
        return;
      }
      message.hidden = true;

      const companies = new Set(jobs.map((j) => j.company)).size;
      const investors = new Set(jobs.flatMap((j) => j.firms || [])).size;
      const live = jobs.filter((j) => j.source === "ats").length;
      const scraped = data.scrapedAt ? new Date(data.scrapedAt).toLocaleString() : "never";

      stats.innerHTML = [
        `${jobs.length.toLocaleString()} roles`,
        `${companies} companies`,
        `${investors} investors`,
        `${live.toLocaleString()} live from company boards`,
        `scraped ${scraped}`,
      ].map((s) => `<span>${JobsUI.escapeHtml(s)}</span>`).join("");

      const multi = jobs.filter((j) => (j.firms || []).length > 1).length;
      note.textContent =
        `Merged across every scraped portfolio and deduplicated on company, title, and city — ` +
        `${multi.toLocaleString()} of these roles are at companies backed by more than one investor. ` +
        `Where a company publishes to its own applicant tracking system, that live listing is preferred over the investor's board.`;

      if (refresh) refresh.setStatus(`last scraped ${scraped}`);
      controls.hidden = false;
      view.setJobs(jobs, { defaultCities: data.defaultCities });
    })
    .catch(() => {
      stats.innerHTML = "<span>No job data</span>";
      message.hidden = false;
      message.innerHTML =
        `<p><strong>Couldn't load the job data.</strong></p>
         <p>Locally, run <code>node scrape.js</code> then <code>node server.js</code>.</p>`;
      if (refresh) { refresh.setStatus("No job data — run `node scrape.js`."); refresh.disable(); }
    });
  }

  load();

  // --- Theme toggle ---
  const themeToggle = document.getElementById("theme-toggle");
  const saved = localStorage.getItem("vc-directory-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
  themeToggle.addEventListener("click", () => {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const current = document.documentElement.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("vc-directory-theme", next);
  });
})();
