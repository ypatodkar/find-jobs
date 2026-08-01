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
  const DAY_MS = 86400000;
  const JOBS_PER_PAGE = 45;
  const COMPANIES_PER_PAGE = 40;

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
      const value =
        n === 0 ? `All (${available})`
        : n === 1 ? opts.labelFor([...selected][0])
        : `${n} selected`;
      summary.textContent = value;
      summary.setAttribute("aria-label", `${opts.label} filter: ${value}`);
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
    const cfg = Object.assign({ showFirms: false, firmLabel: (id) => id, contextLabel: null }, config);

    // Every multi-select filter is a "dimension": a key, how to read its values off a
    // job, and how to label them. Filters combine with AND across dimensions and OR
    // within one (ticking two cities means either city).
    const DIMENSIONS = [
      { key: "city", label: "City", values: (j) => [j.city] },
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
      jobs: [], page: 1,
      view: "flat",               // "flat" (every role) | "grouped" (by company)
      expanded: new Set(),        // company names currently open
    };
    DIMENSIONS.forEach((d) => (state.selected[d.key] = new Set()));

    const el = {
      search: $("job-search"),
      pickerRow: $("picker-row"),
      dateSelect: $("date-select"),
      salarySelect: $("salary-select"),
      resetBtn: $("reset-filters"),
      undoBtn: $("undo-filters"),
      sortSelect: $("sort-select"),
      count: $("job-count"),
      list: $("job-list"),
      pagination: $("job-pagination"),
      viewGrouped: $("view-grouped"),
      viewFlat: $("view-flat"),
      countGrouped: $("count-grouped"),
      countFlat: $("count-flat"),
      groupActions: $("group-actions"),
      expandAll: $("expand-all"),
      collapseAll: $("collapse-all"),
      mobileFilterToggle: $("mobile-filter-toggle"),
    };

    if (el.expandAll) el.expandAll.textContent = "Expand visible";

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
      const byTitle = (a, b) => a.title.localeCompare(b.title) || a.company.localeCompare(b.company);
      if (state.sort === "newest") arr.sort((a, b) => t(b) - t(a) || byTitle(a, b));
      else if (state.sort === "oldest") arr.sort((a, b) => t(a) - t(b) || byTitle(a, b));
      else if (state.sort === "salary") arr.sort((a, b) => pay(b) - pay(a) || t(b) - t(a) || byTitle(a, b));
      else if (state.sort === "count") {
        // In a flat list, "Most roles" means roles from companies with the most
        // matches under the current filters. It is therefore useful without having
        // to switch to the grouped view.
        const counts = new Map();
        arr.forEach((j) => counts.set(j.company, (counts.get(j.company) || 0) + 1));
        arr.sort((a, b) =>
          (counts.get(b.company) || 0) - (counts.get(a.company) || 0) ||
          t(b) - t(a) ||
          byTitle(a, b)
        );
      } else if (state.sort === "company") {
        arr.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
      } else if (state.sort === "title") {
        arr.sort(byTitle);
      }
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
            label: d.label,
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
              state.page = 1;
              renderResults();
              refreshOtherPickers(d.key);
              updateResetBtn();
              // Ticking a dropdown deliberately skips render() — it must not rebuild
              // the list under the cursor — so history is recorded here too.
              if (!restoring) recordHistory();
              listeners.forEach((fn) => fn());
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
      const payBit = pay
        ? `<span class="job-salary"${j.salary ? ` title="${escapeHtml(j.salary)}"` : ""}>${escapeHtml(pay)}</span>`
        : "";
      // data-* here is read by track.js, which delegates off document — this row is
      // replaced wholesale on every filter change, so per-row listeners wouldn't survive.
      const title = j.url
        ? `<a class="job-title" href="${escapeHtml(j.url)}" target="_blank" rel="noopener noreferrer"` +
          ` data-job-id="${escapeHtml(j.job_id || "")}" data-company="${escapeHtml(j.company)}"` +
          ` data-city="${escapeHtml(j.city || "")}">${escapeHtml(j.title)}</a>`
        : `<span class="job-title">${escapeHtml(j.title)}</span>`;
      // Investors are deliberately absent from the row: they repeat on every job at a
      // company and crowd the title. The company card's header still lists them, and
      // the Investor filter still works.
      const companyBit = inGroup ? "" : `<span class="job-company">${escapeHtml(j.company)}</span>`;
      // Company and salary share one line. Inside a company card the company name is
      // in the header, so the line carries the salary alone — and is dropped entirely
      // when there is neither, rather than leaving an empty gap.
      const subLine = companyBit || payBit ? `<p class="job-sub">${companyBit}${payBit}</p>` : "";
      return `
        <article class="job">
          <div class="job-main">
            ${title}
            ${subLine}
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
          g = { company: j.company, jobs: [], cities: new Map(), newest: 0, oldest: Infinity,
                titleFirst: j.title, payMax: 0,
                size: j.size, stage: j.stage, markets: j.markets || [] };
          map.set(j.company, g);
        }
        g.jobs.push(j);
        g.cities.set(j.city, (g.cities.get(j.city) || 0) + 1);
        const t = j.posted ? new Date(j.posted).getTime() : 0;
        if (t > g.newest) g.newest = t;
        if (t && t < g.oldest) g.oldest = t;
        if (j.title.localeCompare(g.titleFirst) < 0) g.titleFirst = j.title;
        const pay = j.salaryMax || j.salaryMin || 0;
        if (pay > g.payMax) g.payMax = pay;
        if (!g.size && j.size) g.size = j.size;
        if (!g.stage && j.stage) g.stage = j.stage;
      }
      const groups = [...map.values()];
      if (state.sort === "company") {
        groups.sort((a, b) => a.company.localeCompare(b.company));
      } else if (state.sort === "title") {
        // Alphabetize companies by the first job title they contain. This keeps
        // Title A–Z genuinely title-based instead of duplicating Company A–Z.
        groups.sort((a, b) => a.titleFirst.localeCompare(b.titleFirst) || a.company.localeCompare(b.company));
      } else if (state.sort === "salary") {
        groups.sort((a, b) => b.payMax - a.payMax || b.jobs.length - a.jobs.length || a.company.localeCompare(b.company));
      } else if (state.sort === "count") {
        groups.sort((a, b) => b.jobs.length - a.jobs.length || a.company.localeCompare(b.company));
      } else if (state.sort === "oldest") {
        groups.sort((a, b) => a.oldest - b.oldest || a.company.localeCompare(b.company));
      } else {
        groups.sort((a, b) => b.newest - a.newest || a.company.localeCompare(b.company));
      }
      return groups;
    }

    function groupHtml(g, index) {
      const open = state.expanded.has(g.company);
      const m = monogram(g.company);
      const n = g.jobs.length;
      const directoryNumber = String(index + 1).padStart(2, "0");

      const cities = [...g.cities.entries()].sort((a, b) => b[1] - a[1])
        .map(([c, k]) => `${escapeHtml(c)}${n > 1 ? ` <span class="cg-n">${k}</span>` : ""}`).join("<span class=\"cg-sep\">·</span>");

      const facts = [
        g.size ? (SIZE_LABELS[g.size] || g.size) + " staff" : null,
        g.stage,
        g.payMax ? "up to $" + Math.round(g.payMax / 1000) + "k" : null,
        relativeDate(new Date(g.newest).toISOString()),
      ].filter(Boolean).map((fact) => `<span class="cg-fact">${escapeHtml(fact)}</span>`).join("");

      const rows = open ? g.jobs.map((j) => jobHtml(j, true)).join("") : "";

      // Investors are a company fact, so they belong here rather than on every row.
      let backers = "";
      if (cfg.showFirms) {
        const all = [...new Set(g.jobs.flatMap((j) => j.firms || []))];
        if (all.length) {
          const names = all.slice(0, 3).map((f) => escapeHtml(cfg.firmLabel(f)));
          const extra = all.length > 3 ? ` +${all.length - 3}` : "";
          backers = `<span class="cg-backers"><span class="cg-label">Backed by</span>${names.join("<span class=\"cg-sep\">·</span>")}${extra}</span>`;
        }
      }

      return `
        <section class="cgroup${open ? " is-open" : ""}">
          <button class="cg-head" type="button" data-company="${escapeHtml(g.company)}" aria-expanded="${open}">
            <span class="cg-mono t${m.tint}" aria-hidden="true">${escapeHtml(m.initials)}</span>
            <span class="cg-main">
              <span class="cg-kicker">Company ${directoryNumber}</span>
              <span class="cg-name">${escapeHtml(g.company)}</span>
              <span class="cg-cities"><span class="cg-label">Hiring in</span>${cities}</span>
              ${backers}
            </span>
            <span class="cg-right">
              <span class="cg-facts">${facts}</span>
              <span class="cg-action">
                <span class="cg-count">${n} role${n === 1 ? "" : "s"}</span>
                <span class="cg-toggle" aria-hidden="true"></span>
              </span>
            </span>
          </button>
          <div class="cg-body">${rows}</div>
        </section>`;
    }

    let currentPageCount = 1;

    function renderPagination(pageCount) {
      if (!el.pagination) return;
      // Build the shell once. Previous, Next, and the jump controls are never
      // replaced during navigation, which keeps keyboard focus predictable.
      if (!el.pagination.querySelector(".page-prev")) {
        el.pagination.innerHTML = `
          <button type="button" class="page-prev">Previous</button>
          <span class="page-numbers" role="group" aria-label="Choose a results page"></span>
          <span class="page-status" role="status" aria-live="polite" aria-atomic="true"></span>
          <button type="button" class="page-next">Next</button>
          <form class="page-jump" novalidate>
            <label for="page-input">Go to page</label>
            <input id="page-input" class="page-input" type="number" min="1" step="1"
              inputmode="numeric" autocomplete="off" aria-label="Go to page" />
            <span class="page-total">of 1</span>
            <button type="submit" class="page-go">Go</button>
          </form>`;
      }

      currentPageCount = pageCount;
      el.pagination.hidden = pageCount <= 1;

      const prev = el.pagination.querySelector(".page-prev");
      const next = el.pagination.querySelector(".page-next");
      const numbers = el.pagination.querySelector(".page-numbers");
      const status = el.pagination.querySelector(".page-status");
      const input = el.pagination.querySelector(".page-input");
      const total = el.pagination.querySelector(".page-total");

      prev.disabled = state.page === 1;
      next.disabled = state.page === pageCount;
      status.textContent = `Page ${state.page} of ${pageCount}`;
      total.textContent = `of ${pageCount}`;
      input.max = String(pageCount);
      input.setAttribute("aria-label", `Go to page, 1 to ${pageCount}`);
      // Do not erase a page number while somebody is in the middle of typing it.
      if (document.activeElement !== input || !input.value) input.value = String(state.page);

      // Page numbers move in blocks: 1–10, 11–20, and so on. Keep the same
      // buttons mounted while navigating inside a block.
      const first = Math.floor((state.page - 1) / 10) * 10 + 1;
      const last = Math.min(first + 9, pageCount);
      const windowKey = `${first}-${last}`;
      if (numbers.dataset.window !== windowKey) {
        numbers.dataset.window = windowKey;
        numbers.innerHTML = Array.from({ length: last - first + 1 }, (_, i) => {
          const page = first + i;
          return `<button type="button" class="page-number" data-page="${page}" aria-label="Page ${page}">${page}</button>`;
        }).join("");
      }
      numbers.querySelectorAll(".page-number").forEach((button) => {
        const active = Number(button.dataset.page) === state.page;
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
    }

    function renderResults() {
      const results = sortJobs(filtered());

      const grouped = state.view === "grouped";
      if (el.groupActions) el.groupActions.hidden = !grouped;

      // Each tab advertises what it would show, so the choice is informed before the
      // click: companies on one side, individual roles on the other.
      if (el.countFlat) el.countFlat.textContent = results.length.toLocaleString();
      if (el.countGrouped) {
        el.countGrouped.textContent = new Set(results.map((j) => j.company)).size.toLocaleString();
      }

      if (!grouped) {
        const pageCount = Math.max(1, Math.ceil(results.length / JOBS_PER_PAGE));
        state.page = Math.min(Math.max(1, state.page), pageCount);
        const start = (state.page - 1) * JOBS_PER_PAGE;
        const slice = results.slice(start, start + JOBS_PER_PAGE);
        el.count.textContent = results.length
          ? `Showing ${start + 1}–${start + slice.length} of ${results.length} matching roles`
          : "0 matching roles";
        // Must be an arrow, not `.map(jobHtml)`: map passes the index as the second
        // argument, which would read as `inGroup` for every row after the first.
        el.list.innerHTML = slice.length ? slice.map((j) => jobHtml(j, false)).join("") : `<p class="empty">No roles match those filters.</p>`;
        renderPagination(pageCount);
        return;
      }

      const groups = buildGroups(results);
      const pageCount = Math.max(1, Math.ceil(groups.length / COMPANIES_PER_PAGE));
      state.page = Math.min(Math.max(1, state.page), pageCount);
      const start = (state.page - 1) * COMPANIES_PER_PAGE;
      const slice = groups.slice(start, start + COMPANIES_PER_PAGE);
      el.count.textContent = groups.length
        ? `Showing ${start + 1}–${start + slice.length} of ${groups.length} companies · ${results.length} roles`
        : "0 companies · 0 roles";
      el.list.innerHTML = slice.length
        ? slice.map((group, index) => groupHtml(group, start + index)).join("")
        : `<p class="empty">No roles match those filters.</p>`;
      renderPagination(pageCount);
    }

    function activeCount() {
      let n = DIMENSIONS.reduce((a, d) => a + (state.selected[d.key].size ? 1 : 0), 0);
      if (state.range !== "all") n++;
      if (state.salary !== "all") n++;
      if (state.query.trim()) n++;
      return n;
    }

    function updateResetBtn() {
      const n = activeCount();
      if (el.undoBtn) {
        el.undoBtn.addEventListener("click", undo);
        updateUndoBtn();
      }

      if (el.resetBtn) {
        el.resetBtn.hidden = n === 0;
        el.resetBtn.textContent = `Reset ${n} filter${n === 1 ? "" : "s"}`;
      }
      if (el.mobileFilterToggle) {
        el.mobileFilterToggle.textContent = n ? `Filters · ${n} active` : "Filters";
        const expanded = el.mobileFilterToggle.getAttribute("aria-expanded") === "true";
        el.mobileFilterToggle.setAttribute(
          "aria-label",
          `${expanded ? "Hide" : "Show"} filters${n ? `, ${n} active` : ""}`
        );
      }
    }

    // Notified after every filter change, so the saved-filters bar can show which
    // preset (if any) matches the current state.
    const listeners = [];

    // ---- undo ----
    // Every filter change funnels through render(), so history is captured in one
    // place rather than instrumenting each control. We snapshot the state we are
    // leaving, not the one we are arriving at, so undo steps backwards.
    //
    // Applying a saved filter is a single change and therefore a single undo step:
    // one press returns you to whatever you had before you recalled it. Undo only
    // ever restores filter state — it never touches the saved filters themselves,
    // so it can't delete a preset you spent time building.
    const HISTORY_MAX = 25;
    const COALESCE_MS = 1200; // typing in the search box collapses into one step
    const history = [];
    let previous = null;   // the state as it was after the last settled change
    let lastPushAt = 0;
    let restoring = false; // guard: undo calls render(), which must not re-record

    const sameFilters = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    // True when the only thing that moved is the free-text query, which is what makes
    // a burst of keystrokes collapse into one undo step instead of twenty.
    function onlyQueryChanged(a, b) {
      if (!a || !b) return false;
      return a.query !== b.query && sameFilters({ ...a, query: "" }, { ...b, query: "" });
    }

    function recordHistory() {
      const now = view.getFilters();
      if (previous === null) { previous = now; return; }
      if (sameFilters(now, previous)) return;

      const t = Date.now();
      const coalesce =
        history.length &&
        onlyQueryChanged(previous, now) &&
        onlyQueryChanged(history[history.length - 1], previous) &&
        t - lastPushAt < COALESCE_MS;

      if (!coalesce) {
        history.push(previous);
        if (history.length > HISTORY_MAX) history.shift();
        lastPushAt = t;
      }
      previous = now;
      updateUndoBtn();
    }

    function updateUndoBtn() {
      if (!el.undoBtn) return;
      el.undoBtn.hidden = history.length === 0;
      el.undoBtn.disabled = history.length === 0;
    }

    function undo() {
      if (!history.length) return;
      const target = history.pop();
      restoring = true;
      view.applyFilters(target);
      restoring = false;
      previous = view.getFilters();
      updateUndoBtn();
      listeners.forEach((fn) => fn()); // let the saved-filters bar re-evaluate its match
    }

    function render() {
      state.page = 1;
      refreshAllPickers();
      renderResults();
      updateResetBtn();
      if (!restoring) recordHistory();
      listeners.forEach((fn) => fn());
    }

    // ---- events ----
    if (el.search) el.search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
    if (el.sortSelect) el.sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
    if (el.pagination) {
      const scrollToResults = () => {
        const anchor = el.count ? el.count.parentElement : el.list;
        if (anchor && typeof anchor.scrollIntoView === "function") {
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };

      const goToPage = (page, focusNumber) => {
        state.page = page;
        renderResults();
        if (focusNumber) {
          const active = el.pagination.querySelector('.page-number[aria-current="page"]');
          if (active) {
            try { active.focus({ preventScroll: true }); }
            catch (_) { active.focus(); }
          }
        }
        scrollToResults();
      };

      el.pagination.addEventListener("click", (e) => {
        const number = e.target.closest(".page-number");
        if (number) {
          goToPage(Number(number.dataset.page), true);
          return;
        }

        const button = e.target.closest(".page-prev, .page-next");
        if (!button || button.disabled) return;
        goToPage(state.page + (button.classList.contains("page-next") ? 1 : -1), false);
      });

      el.pagination.addEventListener("input", (e) => {
        if (e.target.classList.contains("page-input")) e.target.setCustomValidity("");
      });

      // A form gives the jump field native Enter-key behavior as well as a visible
      // Go button. Validation is repeated here so programmatic submits are safe too.
      el.pagination.addEventListener("submit", (e) => {
        if (!e.target.classList.contains("page-jump")) return;
        e.preventDefault();
        const input = e.target.querySelector(".page-input");
        const page = Number(input.value);
        input.setCustomValidity("");
        if (!Number.isInteger(page) || page < 1 || page > currentPageCount) {
          input.setCustomValidity(`Enter a whole page number from 1 to ${currentPageCount}.`);
          input.reportValidity();
          input.focus();
          input.select();
          return;
        }
        goToPage(page, false);
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
      if (el.viewGrouped) {
        el.viewGrouped.classList.toggle("active", view === "grouped");
        el.viewGrouped.setAttribute("aria-pressed", String(view === "grouped"));
      }
      if (el.viewFlat) {
        el.viewFlat.classList.toggle("active", view === "flat");
        el.viewFlat.setAttribute("aria-pressed", String(view === "flat"));
      }
      render();
    }
    if (el.viewGrouped) el.viewGrouped.addEventListener("click", () => setView("grouped"));
    if (el.viewFlat) el.viewFlat.addEventListener("click", () => setView("flat"));

    if (el.expandAll) {
      el.expandAll.addEventListener("click", () => {
        const start = (state.page - 1) * COMPANIES_PER_PAGE;
        buildGroups(sortJobs(filtered())).slice(start, start + COMPANIES_PER_PAGE)
          .forEach((g) => state.expanded.add(g.company));
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
        state.range = "all"; state.salary = "all"; state.query = "";
        if (el.search) el.search.value = "";
        if (el.dateSelect) el.dateSelect.value = "all";
        if (el.salarySelect) el.salarySelect.value = "all";
        render();
      });
    }

    if (el.viewFlat) el.viewFlat.classList.add("active");

    const view = {
      setJobs(jobs) {
        state.jobs = jobs || [];
        render();
      },
      state,
      contextLabel: cfg.contextLabel,

      // ---- saved filters ----
      // presets.js goes through these rather than poking at `state`, because applying
      // a set of filters also has to resync the selects and the view tabs — exactly
      // what the Reset button does. Skip that and the controls silently disagree with
      // the results being shown.

      /** The current filter state, as plain JSON. */
      getFilters() {
        const selected = {};
        DIMENSIONS.forEach((d) => {
          if (state.selected[d.key].size) selected[d.key] = [...state.selected[d.key]];
        });
        return {
          selected,
          query: state.query,
          range: state.range,
          salary: state.salary,
          sort: state.sort,
          view: state.view,
        };
      },

      applyFilters(f) {
        if (!f) return;
        DIMENSIONS.forEach((d) => {
          state.selected[d.key].clear();
          const vals = (f.selected || {})[d.key];
          if (Array.isArray(vals)) vals.forEach((v) => state.selected[d.key].add(v));
        });
        // An absent or empty city selection intentionally means every city. A preset
        // saved on the all-roles page can name an Investor dimension that firm pages
        // don't have; that key has no matching DIMENSIONS entry here and is ignored.

        state.query = f.query || "";
        state.range = f.range || "all";
        state.salary = f.salary || "all";
        state.sort = f.sort || "newest";
        if (el.search) el.search.value = state.query;
        if (el.dateSelect) el.dateSelect.value = state.range;
        if (el.salarySelect) el.salarySelect.value = state.salary;
        if (el.sortSelect) el.sortSelect.value = state.sort;

        setView(f.view === "grouped" ? "grouped" : "flat");
      },

      /** Human label for one value, so a preset can name itself after its contents. */
      labelFor(key, value) {
        const d = DIMENSIONS.find((x) => x.key === key);
        return d && d.labelFor ? d.labelFor(value) : value;
      },

      salaryLabel: (k) => (SALARY_FLOORS.find((s) => s.k === k) || {}).label || null,
      rangeLabel: (k) => (DATE_RANGES.find((r) => r.k === k) || {}).label || null,

      /** Fires whenever the filter state changes, so the preset bar can highlight
       *  which saved filter (if any) matches what is on screen. */
      onChange(fn) { listeners.push(fn); },
    };

    // Wired here rather than from the pages so both get it automatically. presets.js
    // loads before them, so it is present by the time this runs.
    if (global.Presets && global.Presets.attach) global.Presets.attach(view);
    return view;
  }

  global.JobsUI = { createJobsView, escapeHtml, relativeDate, ROLE_LABELS };
})(window);
