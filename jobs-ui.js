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

      // With a search active "Select all" takes just the matches. With no search it
      // takes every available option, not only the ones inside the display cap —
      // "Select all 60" next to a list of 127 would be a lie.
      visibleValues = (query ? visible : entries).map(([v]) => v);
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
    const cfg = Object.assign({ showFirms: false, firmLabel: (id) => id, pageSize: 300, groupPageSize: 40 }, config);

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
      view: "grouped",            // "grouped" (by company) | "flat"
      expanded: new Set(),        // company names currently open
      groupsShown: cfg.groupPageSize,
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
      viewGrouped: $("view-grouped"),
      viewFlat: $("view-flat"),
      countGrouped: $("count-grouped"),
      countFlat: $("count-flat"),
      groupActions: $("group-actions"),
      expandAll: $("expand-all"),
      collapseAll: $("collapse-all"),
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
    // "USD 295,000–445,000 / year" under every title is a lot of glyphs to scan past;
    // the full string stays available on hover.
    function compactPay(j) {
      if (!j.salaryMin) return j.salary || null;
      if (j.salary && !/USD|\$/.test(j.salary)) return j.salary; // leave other currencies alone
      const k = (n) => "$" + Math.round(n / 1000) + "k";
      return j.salaryMax && j.salaryMax !== j.salaryMin
        ? `${k(j.salaryMin)}–${k(j.salaryMax)}`
        : `${k(j.salaryMin)}+`;
    }

    // `inGroup` drops the company and investor lines: inside a company card they are
    // in the header already, repeated once per row.
    function jobHtml(j, inGroup) {
      const roleTags = j.roles.map((r) => `<span class="role-tag${r === "ai" ? " ai" : ""}">${escapeHtml(ROLE_LABELS[r] || r)}</span>`).join("");
      const src = j.source === "ats"
        ? `<span class="src-tag ats" title="Fetched live from ${escapeHtml(j.ats || "the company")}'s job board">${escapeHtml(j.ats || "ats")}</span>`
        : `<span class="src-tag" title="From the VC's portfolio board">vc board</span>`;
      // Date is always the final item so its position never shifts between rows.
      const meta = [j.city, j.remote ? "Remote OK" : null, relativeDate(j.posted)]
        .filter(Boolean).map(escapeHtml).join(" &middot; ");
      const pay = compactPay(j);
      const payLine = pay
        ? `<p class="job-salary"${j.salary ? ` title="${escapeHtml(j.salary)}"` : ""}>${escapeHtml(pay)}</p>`
        : "";
      // data-* here is read by track.js, which delegates off document — this row is
      // replaced wholesale on every filter change, so per-row listeners wouldn't survive.
      const title = j.url
        ? `<a class="job-title" href="${escapeHtml(j.url)}" target="_blank" rel="noopener noreferrer"` +
          ` data-job-id="${escapeHtml(j.job_id || "")}" data-company="${escapeHtml(j.company)}"` +
          ` data-city="${escapeHtml(j.city || "")}">${escapeHtml(j.title)}</a>`
        : `<span class="job-title">${escapeHtml(j.title)}</span>`;
      const backers = !inGroup && cfg.showFirms && (j.firms || []).length
        ? `<p class="job-backers">${j.firms.map((f) => escapeHtml(cfg.firmLabel(f))).join(" · ")}</p>`
        : "";
      const companyLine = inGroup ? "" : `<p class="job-company">${escapeHtml(j.company)}</p>`;
      return `
        <article class="job">
          <div class="job-main">
            ${title}
            ${companyLine}
            ${backers}
            ${payLine}
          </div>
          <div class="job-side">
            <div class="job-tags">${roleTags}${src}</div>
            <p class="job-meta">${meta}</p>
          </div>
        </article>`;
    }

    // ---- company grouping ----
    // A monogram tint stands in for a company logo (we store none). Derived from the
    // name so a company keeps the same colour across renders and pages.
    const MONOGRAM_TINTS = 6;
    function monogram(name) {
      let h = 0;
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 100000;
      const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
      // One-word names take two letters ("OpenAI" → "OP"), multi-word take initials.
      const initials = (
        words.length === 0 ? "?"
        : words.length === 1 ? words[0].slice(0, 2)
        : words.slice(0, 2).map((w) => w[0]).join("")
      ).toUpperCase();
      return { initials, tint: h % MONOGRAM_TINTS };
    }

    function buildGroups(jobs) {
      const map = new Map();
      for (const j of jobs) {
        let g = map.get(j.company);
        if (!g) {
          g = { company: j.company, jobs: [], cities: new Map(), newest: 0, payMax: 0,
                size: j.size, stage: j.stage, markets: j.markets || [] };
          map.set(j.company, g);
        }
        g.jobs.push(j);
        g.cities.set(j.city, (g.cities.get(j.city) || 0) + 1);
        const t = j.posted ? new Date(j.posted).getTime() : 0;
        if (t > g.newest) g.newest = t;
        const pay = j.salaryMax || j.salaryMin || 0;
        if (pay > g.payMax) g.payMax = pay;
        if (!g.size && j.size) g.size = j.size;
        if (!g.stage && j.stage) g.stage = j.stage;
      }
      const groups = [...map.values()];
      if (state.sort === "company" || state.sort === "title") {
        groups.sort((a, b) => a.company.localeCompare(b.company));
      } else if (state.sort === "salary") {
        groups.sort((a, b) => b.payMax - a.payMax || b.jobs.length - a.jobs.length);
      } else if (state.sort === "count") {
        groups.sort((a, b) => b.jobs.length - a.jobs.length || a.company.localeCompare(b.company));
      } else if (state.sort === "oldest") {
        groups.sort((a, b) => a.newest - b.newest);
      } else {
        groups.sort((a, b) => b.newest - a.newest);
      }
      return groups;
    }

    function groupHtml(g) {
      const open = state.expanded.has(g.company);
      const m = monogram(g.company);
      const n = g.jobs.length;

      const cities = [...g.cities.entries()].sort((a, b) => b[1] - a[1])
        .map(([c, k]) => `${escapeHtml(c)}${n > 1 ? ` <span class="cg-n">${k}</span>` : ""}`).join("<span class=\"cg-sep\">·</span>");

      const facts = [
        g.size ? (SIZE_LABELS[g.size] || g.size) + " staff" : null,
        g.stage,
        g.payMax ? "up to $" + Math.round(g.payMax / 1000) + "k" : null,
        relativeDate(new Date(g.newest).toISOString()),
      ].filter(Boolean).map(escapeHtml).join("<span class=\"cg-sep\">·</span>");

      const rows = open ? g.jobs.map((j) => jobHtml(j, true)).join("") : "";

      // Investors are a company fact, so they belong here rather than on every row.
      let backers = "";
      if (cfg.showFirms) {
        const all = [...new Set(g.jobs.flatMap((j) => j.firms || []))];
        if (all.length) {
          const names = all.slice(0, 3).map((f) => escapeHtml(cfg.firmLabel(f)));
          const extra = all.length > 3 ? ` +${all.length - 3}` : "";
          backers = `<span class="cg-backers">${names.join("<span class=\"cg-sep\">·</span>")}${extra}</span>`;
        }
      }

      return `
        <section class="cgroup${open ? " is-open" : ""}">
          <button class="cg-head" type="button" data-company="${escapeHtml(g.company)}" aria-expanded="${open}">
            <span class="cg-mono t${m.tint}" aria-hidden="true">${escapeHtml(m.initials)}</span>
            <span class="cg-main">
              <span class="cg-name">${escapeHtml(g.company)}</span>
              <span class="cg-cities">${cities}</span>
              ${backers}
            </span>
            <span class="cg-right">
              <span class="cg-facts">${facts}</span>
              <span class="cg-count">${n} role${n === 1 ? "" : "s"}</span>
            </span>
            <svg class="cg-chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="cg-body">${rows}</div>
        </section>`;
    }

    function renderResults() {
      const results = sortJobs(filtered());
      renderChart(results);

      const grouped = state.view === "grouped";
      if (el.groupActions) el.groupActions.hidden = !grouped;

      // Each tab advertises what it would show, so the choice is informed before the
      // click: companies on one side, individual roles on the other.
      if (el.countFlat) el.countFlat.textContent = results.length.toLocaleString();
      if (el.countGrouped) {
        el.countGrouped.textContent = new Set(results.map((j) => j.company)).size.toLocaleString();
      }

      if (!grouped) {
        const slice = results.slice(0, state.shown);
        el.count.textContent = results.length > slice.length
          ? `Showing ${slice.length} of ${results.length} matching roles`
          : `Showing ${results.length} of ${state.jobs.length} matching roles`;
        // Must be an arrow, not `.map(jobHtml)`: map passes the index as the second
        // argument, which would read as `inGroup` for every row after the first.
        el.list.innerHTML = slice.length ? slice.map((j) => jobHtml(j, false)).join("") : `<p class="empty">No roles match those filters.</p>`;
        if (el.more) {
          el.more.hidden = results.length <= slice.length;
          el.more.textContent = `Show ${Math.min(cfg.pageSize, results.length - slice.length)} more`;
        }
        return;
      }

      const groups = buildGroups(results);
      const slice = groups.slice(0, state.groupsShown);
      el.count.textContent = groups.length > slice.length
        ? `Showing ${slice.length} of ${groups.length} companies · ${results.length} roles`
        : `${groups.length} compan${groups.length === 1 ? "y" : "ies"} · ${results.length} roles`;
      el.list.innerHTML = slice.length ? slice.map(groupHtml).join("") : `<p class="empty">No roles match those filters.</p>`;
      if (el.more) {
        el.more.hidden = groups.length <= slice.length;
        el.more.textContent = `Show ${Math.min(cfg.groupPageSize, groups.length - slice.length)} more companies`;
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
      state.groupsShown = cfg.groupPageSize;
      refreshAllPickers();
      renderResults();
      updateResetBtn();
    }

    // ---- events ----
    if (el.search) el.search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
    if (el.sortSelect) el.sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
    if (el.more) {
      el.more.addEventListener("click", () => {
        if (state.view === "grouped") state.groupsShown += cfg.groupPageSize;
        else state.shown += cfg.pageSize;
        renderResults();
      });
    }

    // Expanding one company re-renders only that section, so the rest of the list
    // (and the reader's scroll position) stays put.
    el.list.addEventListener("click", (e) => {
      const head = e.target.closest(".cg-head");
      if (!head) return;
      const company = head.dataset.company;
      if (state.expanded.has(company)) state.expanded.delete(company);
      else state.expanded.add(company);

      const hadFocus = document.activeElement === head;
      renderResults();
      // The re-render replaces the button that was just activated, which would drop
      // keyboard focus to the top of the page and make collapsing impossible.
      if (hadFocus) {
        const again = el.list.querySelector(`.cg-head[data-company="${CSS.escape(company)}"]`);
        if (again) again.focus();
      }
    });

    function setView(view) {
      state.view = view;
      state.shown = cfg.pageSize;
      state.groupsShown = cfg.groupPageSize;
      if (el.viewGrouped) {
        el.viewGrouped.classList.toggle("active", view === "grouped");
        el.viewGrouped.setAttribute("aria-pressed", String(view === "grouped"));
      }
      if (el.viewFlat) {
        el.viewFlat.classList.toggle("active", view === "flat");
        el.viewFlat.setAttribute("aria-pressed", String(view === "flat"));
      }
      renderResults();
    }
    if (el.viewGrouped) el.viewGrouped.addEventListener("click", () => setView("grouped"));
    if (el.viewFlat) el.viewFlat.addEventListener("click", () => setView("flat"));

    if (el.expandAll) {
      el.expandAll.addEventListener("click", () => {
        buildGroups(sortJobs(filtered())).slice(0, state.groupsShown).forEach((g) => state.expanded.add(g.company));
        renderResults();
      });
    }
    if (el.collapseAll) {
      el.collapseAll.addEventListener("click", () => { state.expanded.clear(); renderResults(); });
    }

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

    if (el.viewGrouped) el.viewGrouped.classList.add("active");

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
