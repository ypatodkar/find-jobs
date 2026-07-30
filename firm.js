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
    message: document.getElementById("firm-message"),
    footerNote: document.getElementById("footer-note"),
  };

  const esc = JobsUI.escapeHtml;

  function showMessage(html) {
    el.message.innerHTML = html;
    el.message.hidden = false;
  }

  if (!firm) {
    el.name.textContent = "Firm not found";
    el.focus.textContent = "No firm matches that id. Head back to the index and pick one.";
    return;
  }

  document.title = firm.name + " — roles";
  el.name.textContent = firm.name;
  el.tier.textContent = TIER_META[firm.tier].label;
  el.focus.textContent = firm.focus;

  const view = JobsUI.createJobsView({ showFirms: false, pageSize: 300 });

  fetch("api/firm/" + encodeURIComponent(firmId) + ".json")
    .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(e))))
    .then((data) => {
      const scraped = data.scrapedAt ? new Date(data.scrapedAt).toLocaleString() : "never";

      if (data.status === "unsupported") {
        el.stats.innerHTML = `<span>No scrapeable board</span>`;
        showMessage(
          `<p><strong>This firm's board can't be scraped.</strong></p>
           <p>${esc(data.reason || "No public job board.")}</p>
           ${firm.url ? `<p><a class="joblink" href="${esc(firm.url)}" target="_blank" rel="noopener noreferrer">${esc(firm.urlLabel || firm.url)}</a></p>` : ""}`
        );
        return;
      }
      if (data.status === "error") {
        el.stats.innerHTML = `<span>Last attempt failed</span>`;
        showMessage(`<p><strong>Scrape failed.</strong></p><p>${esc(data.reason || "Unknown error")}</p>`);
        return;
      }

      const jobs = data.jobs || [];
      const live = jobs.filter((j) => j.source === "ats").length;

      el.stats.innerHTML = [
        `${jobs.length} matching roles`,
        live ? `${live} live from company boards` : null,
        data.totalOnBoard != null ? `${data.totalOnBoard.toLocaleString()} jobs on board` : null,
        `scraped ${scraped}`,
      ].filter(Boolean).map((s) => `<span>${esc(s)}</span>`).join("");

      el.footerNote.textContent =
        `Companies discovered via ${data.host}. ` +
        (data.atsCompanies
          ? `${data.atsCompanies} of them publish to Ashby, Greenhouse or Lever, so those ${data.fromAts} roles come straight from the company's own board; the remaining ${data.fromBoard} come from the investor's board.`
          : `Roles come from the investor's portfolio board.`);

      if (jobs.length === 0) {
        showMessage(`<p>No engineering roles in the tracked metros matched on this board right now.</p>`);
        return;
      }
      el.controls.hidden = false;
      view.setJobs(jobs, { defaultCities: data.defaultCities });
    })
    .catch(() => {
      el.stats.innerHTML = `<span>No data yet</span>`;
      showMessage(
        `<p><strong>No scraped data for this firm yet.</strong></p>
         <p>Go to the <a href="firms.html">investors page</a> and hit <em>Refresh all boards</em> to pull live listings.</p>`
      );
    });

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
