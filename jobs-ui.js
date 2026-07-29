// Shared job browser used by both the per-firm page and the all-jobs page.
// Both pages use the same control ids, so this module owns every filter, the
// activity chart, and the result list; the pages only supply the data.

(function (global) {
  "use strict";

  const ROLE_LABELS = {
    ai: "AI / ML",
    backend: "Backend",
    infra: "Infra / Platform",
    fullstack: "Full-stack",
    frontend: "Frontend",
    swe: "Software Eng",
  };
  const CITIES = ["San Francisco", "New York", "San Diego"];
  const DATE_RANGES = [
    { k: "all", label: "Any time", days: null },
    { k: "7", label: "Last 7 days", days: 7 },
    { k: "30", label: "Last 30 days", days: 30 },
    { k: "90", label: "Last 90 days", days: 90 },
  ];
  const SALARY_FLOORS = [
    { k: "all", label: "Any", min: 0 },
    { k: "150", label: "$150k+", min: 150000 },
    { k: "200", label: "$200k+", min: 200000 },
    { k: "250", label: "$250k+", min: 250000 },
    { k: "300", label: "$300k+", min: 300000 },
  ];
  const SENIORITY_LABELS = {
    intern: "Intern", junior: "Junior", mid: "Mid", senior: "Senior",
    staff: "Staff / Principal", manager: "Manager", exec: "Director+",
  };
  const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "manager", "exec"];
  const SIZE_LABELS = {
    "1-10": "1–10", "11-50": "11–50", "51-200": "51–200",
    "201-1000": "201–1,000", "1000+": "1,000+",
  };
  const SIZE_ORDER = ["1-10", "11-50", "51-200", "201-1000", "1000+"];
  const CHART_DAYS = 30;
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const ageInDays = (iso) => (iso ? Math.floor((startOfDay(Date.now()) - startOfDay(new Date(iso))) / DAY_MS) : null);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Calendar-day based, so list labels agree with the chart's buckets.
  function relativeDate(iso) {
    const days = ageInDays(iso);
    if (days === null || Number.isNaN(days)) return null;
    if (days <= 0) return "today";
    if (days === 1) return "1 day ago";
    if (days < 30) return days + " days ago";
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : months + " months ago";
  }

  /**
   * A multi-select dropdown backed by a Set.
   * The list is rebuilt only when closed→open or when its search changes, never on
   * a tick — re-sorting under the cursor mid-selection is disorienting.
   */
  function createPicker(ids, opts) {
    const root = $(ids.root);
    if (!root) return null;
    const summary = $(ids.summary);
    const list = $(ids.list);
    const search = $(ids.search);
    const clear = $(ids.clear);
    const selectAll = $(ids.selectAll);
    const selected = opts.selected;
    let query = "";
    let dirty = true;
    let visibleValues = []; // what "Select all" acts on: the rows currently listed

    function updateSummary(available) {
      const n = selected.size;
      summary.textContent =
        n === 0 ? `All (${available})`
        : n === 1 ? opts.labelFor([...selected][0])
        : `${n} selected`;
      root.classList.toggle("has-selection", n > 0);
      clear.hidden = n === 0;
    }

    function build() {
      const counts = new Map(opts.counts());
      // Keep a selected entry listed even when other filters exclude it, or the
      // only way to undo the selection would be Clear.
      selected.forEach((v) => { if (!counts.has(v)) counts.set(v, 0); });

      const entries = [...counts.entries()].sort((a, b) => {
        const sel = (v) => (selected.has(v) ? 0 : 1);
        return sel(a[0]) - sel(b[0]) || b[1] - a[1] || opts.labelFor(a[0]).localeCompare(opts.labelFor(b[0]));
      });

      // Some dimensions have a very long tail (688 industry tags, most on a handful
      // of roles). Show the meaningful head by default; searching still reaches all.
      const q = query.trim().toLowerCase();
      const cap = opts.maxOptions || 0;
      const capped = !q && cap && entries.length > cap;
      const visible = q
        ? entries.filter(([v]) => opts.labelFor(v).toLowerCase().includes(q))
        : capped ? entries.slice(0, cap) : entries;

      list.innerHTML = visible.length
        ? visible.map(([v, n]) => {
            const checked = selected.has(v) ? " checked" : "";
            const zero = n === 0 ? " is-zero" : "";
            return `<label class="company-row${zero}"><input type="checkbox" value="${escapeHtml(v)}"${checked} /><span class="company-name">${escapeHtml(opts.labelFor(v))}</span><span class="company-n">${n}</span></label>`;
          }).join("")
        : query
          ? `<p class="company-none">No match for “${escapeHtml(query)}”.</p>`
          : `<p class="company-none">Nothing left under the current filters.</p>`;

      if (capped) {
        list.insertAdjacentHTML("beforeend",
          `<p class="company-none">Top ${cap} of ${entries.length} — search to find the rest.</p>`);
      }

      list.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(cb.value);
          else selected.delete(cb.value);
          dirty = true;
          opts.onChange();          // refresh results only
          updateSummary(entries.length);
        });
      });

      // "Select all" applies to what's listed, so with a search active it selects
      // just the matches rather than silently ticking hundreds of hidden options.
      visibleValues = visible.map(([v]) => v);
      if (selectAll) {
        const unselected = visibleValues.filter((v) => !selected.has(v)).length;
        selectAll.hidden = unselected === 0;
        selectAll.textContent = query ? `Select all ${unselected} matching` : `Select all ${unselected}`;
      }

      dirty = false;
      updateSummary(entries.length);
    }

    search.addEventListener("input", (e) => { query = e.target.value; build(); });
    clear.addEventListener("click", () => { selected.clear(); dirty = true; opts.onChange(); build(); });
    if (selectAll) {
      selectAll.addEventListener("click", () => {
        visibleValues.forEach((v) => selected.add(v));
        dirty = true;
        opts.onChange();
        build();
      });
    }
    root.addEventListener("toggle", () => { if (root.open && dirty) build(); });
    document.addEventListener("click", (e) => { if (root.open && !root.contains(e.target)) root.open = false; });

    return {
      markDirty() {
        dirty = true;
        // Even while closed the summary must show how many options survive the other
        // filters, so the count on the button stays truthful.
        if (root.open) build();
        else updateSummary(opts.counts().length);
      },
    };
  }

  function createJobsView(config) {
    const cfg = Object.assign({ showFirms: false, firmLabel: (id) => id, pageSize: 300 }, config);

    // Every multi-select filter is a "dimension": a key, how to read its values off a
    // job, and how to label them. Filters combine with AND across dimensions and OR
    // within one (ticking two cities means either city).
    const DIMENSIONS = [
      { key: "city", label: "City", values: (j) => [j.city], order: CITIES },
      { key: "role", label: "Role", values: (j) => j.roles || [], labelFor: (v) => ROLE_LABELS[v] || v },
      { key: "seniority", label: "Seniority", values: (j) => (j.seniority ? [j.seniority] : []), labelFor: (v) => SENIORITY_LABELS[v] || v, order: SENIORITY_ORDER },
      { key: "company", label: "Company", values: (j) => [j.company] },
      { key: "industry", label: "Industry", values: (j) => j.markets || [] },
      { key: "size", label: "Company size", values: (j) => (j.size ? [j.size] : []), labelFor: (v) => SIZE_LABELS[v] || v, order: SIZE_ORDER },
      { key: "stage", label: "Funding", values: (j) => (j.stage ? [j.stage] : []) },
      { key: "firm", label: "Investor", values: (j) => j.firms || [], labelFor: (v) => cfg.firmLabel(v), onlyWhenFirms: true },
    ].filter((d) => !d.onlyWhenFirms || cfg.showFirms);

    const state = {
      query: "", range: "all", salary: "all", sort: "newest",
      selected: {}, // dimension key -> Set of chosen values
      jobs: [], shown: cfg.pageSize,
    };
    DIMENSIONS.forEach((d) => (state.selected[d.key] = new Set()));

    // Cities are pre-selected (SF / NY / San Diego) while every other metro stays
    // available in the dropdown. Applied once, so a refresh doesn't stomp on the
    // user's own selection.
    let defaultsApplied = false;
    function applyDefaults() {
      const cities = cfg.defaultCities || [];
      state.selected.city.clear();
      cities.forEach((c) => state.selected.city.add(c));
    }

    const el = {
      search: $("job-search"),
      pickerRow: $("picker-row"),
      dateSelect: $("date-select"),
      salarySelect: $("salary-select"),
      resetBtn: $("reset-filters"),
      sortSelect: $("sort-select"),
      chart: $("activity-chart"),
      chartPlot: $("chart-plot"),
      chartSub: $("chart-sub"),
      chartTooltip: $("chart-tooltip"),
      axisStart: $("chart-axis-start"),
      axisEnd: $("chart-axis-end"),
      count: $("job-count"),
      list: $("job-list"),
      more: $("show-more"),
    };

    // ---- filtering ----
    // `skip` omits one dimension so that dimension's own dropdown can be populated
    // with the options still reachable under every *other* active filter.
    function filtered(skip) {
      const q = state.query.trim().toLowerCase();
      const range = DATE_RANGES.find((r) => r.k === state.range);
      const floor = SALARY_FLOORS.find((s) => s.k === state.salary);

      return state.jobs.filter((j) => {
        for (const d of DIMENSIONS) {
          if (d.key === skip) continue;
          const sel = state.selected[d.key];
          if (!sel.size) continue;
          if (!d.values(j).some((v) => sel.has(v))) return false;
        }
        if (range && range.days !== null) {
          const a = ageInDays(j.posted);
          if (a === null || a >= range.days) return false;
        }
        if (floor && floor.min > 0) {
          const top = j.salaryMax || j.salaryMin || 0;
          if (top < floor.min) return false;
        }
        if (q && !j.title.toLowerCase().includes(q) && !j.company.toLowerCase().includes(q)) return false;
        return true;
      });
    }

    function sortJobs(jobs) {
      const arr = jobs.slice();
      const t = (j) => (j.posted ? new Date(j.posted).getTime() : 0);
      const pay = (j) => j.salaryMax || j.salaryMin || 0;
      if (state.sort === "newest") arr.sort((a, b) => t(b) - t(a));
      else if (state.sort === "oldest") arr.sort((a, b) => t(a) - t(b));
      else if (state.sort === "salary") arr.sort((a, b) => pay(b) - pay(a) || t(b) - t(a));
      else if (state.sort === "company") arr.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
      else if (state.sort === "title") arr.sort((a, b) => a.title.localeCompare(b.title));
      return arr;
    }

    // ---- dropdowns ----
    // One picker per dimension, built into the markup up front so ids stay stable.
    el.pickerRow.innerHTML = DIMENSIONS.map((d) => `
      <div class="picker-wrap">
        <span class="picker-label">${escapeHtml(d.label)}</span>
        <details class="company-picker" id="pick-${d.key}">
          <summary id="sum-${d.key}">All</summary>
          <div class="company-panel">
            <div class="company-panel-top">
              <input type="search" id="q-${d.key}" placeholder="Find…" aria-label="Search ${escapeHtml(d.label)}" autocomplete="off" />
            </div>
            <div class="panel-actions">
              <button type="button" class="linkish" id="sa-${d.key}">Select all</button>
              <button type="button" class="linkish" id="clr-${d.key}">Clear</button>
            </div>
            <div class="company-list" id="list-${d.key}" role="group" aria-label="Select ${escapeHtml(d.label)}"></div>
          </div>
        </details>
      </div>`).join("");

    const pickers = DIMENSIONS.map((d) => {
      const labelFor = d.labelFor || ((v) => v);
      return {
        key: d.key,
        picker: createPicker(
          { root: `pick-${d.key}`, summary: `sum-${d.key}`, list: `list-${d.key}`, search: `q-${d.key}`, clear: `clr-${d.key}`, selectAll: `sa-${d.key}` },
          {
            selected: state.selected[d.key],
            labelFor,
            maxOptions: 60,
            // Counts come from everything *except* this dimension, so an option only
            // appears if it would still return rows under the other active filters.
            counts: () => {
              const m = new Map();
              filtered(d.key).forEach((j) => d.values(j).forEach((v) => { if (v) m.set(v, (m.get(v) || 0) + 1); }));
              const arr = [...m.entries()];
              return d.order
                ? arr.sort((a, b) => d.order.indexOf(a[0]) - d.order.indexOf(b[0]))
                : arr.sort((a, b) => b[1] - a[1] || labelFor(a[0]).localeCompare(labelFor(b[0])));
            },
            onChange: () => {
              state.shown = cfg.pageSize;
              renderResults();
              refreshOtherPickers(d.key);
              updateResetBtn();
            },
          }
        ),
      };
    }).filter((p) => p.picker);

    // After a tick, every *other* dropdown's options must be recomputed — that's what
    // makes "San Francisco" narrow the company list to SF companies.
    function refreshOtherPickers(changedKey) {
      pickers.forEach((p) => { if (p.key !== changedKey) p.picker.markDirty(0); });
    }

    function refreshAllPickers() {
      pickers.forEach((p) => p.picker.markDirty(0));
    }

    // ---- chart ----
    function renderChart(jobs) {
      const today = startOfDay(Date.now());
      const buckets = [];
      for (let i = CHART_DAYS - 1; i >= 0; i--) buckets.push({ day: today - i * DAY_MS, count: 0 });

      let dated = 0;
      jobs.forEach((j) => {
        const a = ageInDays(j.posted);
        if (a === null || a < 0 || a >= CHART_DAYS) return;
        buckets[CHART_DAYS - 1 - a].count++;
        dated++;
      });

      if (dated === 0) { el.chart.hidden = true; return; }
      el.chart.hidden = false;

      const max = Math.max(...buckets.map((b) => b.count));
      const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

      el.chartSub.textContent = `${dated} of ${jobs.length} shown roles posted in the last ${CHART_DAYS} days · peak ${max}/day`;
      el.axisStart.textContent = fmt(buckets[0].day);
      el.axisEnd.textContent = "Today";

      el.chartPlot.innerHTML = buckets.map((b) => {
        const pct = max ? Math.round((b.count / max) * 100) : 0;
        const h = b.count === 0 ? 2 : Math.max(pct, 6); // zero days keep a hairline
        return `<div class="bar-slot" data-count="${b.count}" data-day="${escapeHtml(fmt(b.day))}" tabindex="0" role="presentation"><div class="bar${b.count === 0 ? " bar-zero" : ""}" style="height:${h}%"></div></div>`;
      }).join("");

      const showTip = (slot) => {
        const c = slot.dataset.count;
        el.chartTooltip.textContent = `${slot.dataset.day} · ${c} role${c === "1" ? "" : "s"}`;
        el.chartTooltip.hidden = false;
        const pb = el.chartPlot.getBoundingClientRect();
        const sb = slot.getBoundingClientRect();
        el.chartTooltip.style.left = Math.round(sb.left - pb.left + sb.width / 2) + "px";
      };
      el.chartPlot.querySelectorAll(".bar-slot").forEach((slot) => {
        slot.addEventListener("mouseenter", () => showTip(slot));
        slot.addEventListener("focus", () => showTip(slot));
        slot.addEventListener("blur", () => { el.chartTooltip.hidden = true; });
      });
      el.chartPlot.addEventListener("mouseleave", () => { el.chartTooltip.hidden = true; });
    }

    // ---- result rows ----
    function jobHtml(j) {
      const roleTags = j.roles.map((r) => `<span class="role-tag${r === "ai" ? " ai" : ""}">${escapeHtml(ROLE_LABELS[r] || r)}</span>`).join("");
      const src = j.source === "ats"
        ? `<span class="src-tag ats" title="Fetched live from ${escapeHtml(j.ats || "the company")}'s job board">${escapeHtml(j.ats || "ats")}</span>`
        : `<span class="src-tag" title="From the VC's portfolio board">vc board</span>`;
      const meta = [j.city, relativeDate(j.posted), j.remote ? "Remote OK" : null, j.salary]
        .filter(Boolean).map(escapeHtml).join(" &middot; ");
      // data-* here is read by track.js, which delegates off document — this row is
      // replaced wholesale on every filter change, so per-row listeners wouldn't survive.
      const title = j.url
        ? `<a class="job-title" href="${escapeHtml(j.url)}" target="_blank" rel="noopener noreferrer"` +
          ` data-job-id="${escapeHtml(j.job_id || "")}" data-company="${escapeHtml(j.company)}"` +
          ` data-city="${escapeHtml(j.city || "")}">${escapeHtml(j.title)}</a>`
        : `<span class="job-title">${escapeHtml(j.title)}</span>`;
      const backers = cfg.showFirms && (j.firms || []).length
        ? `<p class="job-backers">${j.firms.map((f) => escapeHtml(cfg.firmLabel(f))).join(" · ")}</p>`
        : "";
      return `
        <article class="job">
          <div class="job-main">
            ${title}
            <p class="job-company">${escapeHtml(j.company)}</p>
            ${backers}
          </div>
          <div class="job-side">
            <div class="job-tags">${roleTags}${src}</div>
            <p class="job-meta">${meta}</p>
          </div>
        </article>`;
    }

    function renderResults() {
      const results = sortJobs(filtered());
      const slice = results.slice(0, state.shown);
      el.count.textContent =
        results.length > slice.length
          ? `Showing ${slice.length} of ${results.length} matching roles`
          : `Showing ${results.length} of ${state.jobs.length} matching roles`;
      renderChart(results);
      el.list.innerHTML = slice.length ? slice.map(jobHtml).join("") : `<p class="empty">No roles match those filters.</p>`;
      if (el.more) {
        el.more.hidden = results.length <= slice.length;
        el.more.textContent = `Show ${Math.min(cfg.pageSize, results.length - slice.length)} more`;
      }
    }

    // The pre-selected cities are the baseline, not a user filter — they only count
    // as "active" once the selection differs from the default.
    function cityIsDefault() {
      const def = cfg.defaultCities || [];
      const sel = state.selected.city;
      return sel.size === def.length && def.every((c) => sel.has(c));
    }

    function activeCount() {
      let n = DIMENSIONS.reduce((a, d) => {
        if (d.key === "city") return a + (cityIsDefault() ? 0 : 1);
        return a + (state.selected[d.key].size ? 1 : 0);
      }, 0);
      if (state.range !== "all") n++;
      if (state.salary !== "all") n++;
      if (state.query.trim()) n++;
      return n;
    }

    function updateResetBtn() {
      if (!el.resetBtn) return;
      const n = activeCount();
      el.resetBtn.hidden = n === 0;
      el.resetBtn.textContent = `Reset ${n} filter${n === 1 ? "" : "s"}`;
    }

    function render() {
      state.shown = cfg.pageSize;
      refreshAllPickers();
      renderResults();
      updateResetBtn();
    }

    // ---- events ----
    if (el.search) el.search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
    if (el.sortSelect) el.sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
    if (el.more) el.more.addEventListener("click", () => { state.shown += cfg.pageSize; renderResults(); });

    if (el.dateSelect) {
      el.dateSelect.innerHTML = DATE_RANGES.map((r) => `<option value="${r.k}">${escapeHtml(r.label)}</option>`).join("");
      el.dateSelect.addEventListener("change", (e) => { state.range = e.target.value; render(); });
    }
    if (el.salarySelect) {
      el.salarySelect.innerHTML = SALARY_FLOORS.map((s) => `<option value="${s.k}">${escapeHtml(s.label)}</option>`).join("");
      el.salarySelect.addEventListener("change", (e) => { state.salary = e.target.value; render(); });
    }
    if (el.resetBtn) {
      el.resetBtn.addEventListener("click", () => {
        DIMENSIONS.forEach((d) => state.selected[d.key].clear());
        applyDefaults(); // back to the default cities, not to "every city"
        state.range = "all"; state.salary = "all"; state.query = "";
        if (el.search) el.search.value = "";
        if (el.dateSelect) el.dateSelect.value = "all";
        if (el.salarySelect) el.salarySelect.value = "all";
        render();
      });
    }

    return {
      setJobs(jobs, opts) {
        state.jobs = jobs || [];
        if (opts && opts.defaultCities) cfg.defaultCities = opts.defaultCities;
        if (!defaultsApplied) { applyDefaults(); defaultsApplied = true; }
        render();
      },
      state,
    };
  }

  global.JobsUI = { createJobsView, escapeHtml, relativeDate, ROLE_LABELS };
})(window);
