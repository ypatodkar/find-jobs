// Shared job browser used by both the per-firm page and the all-jobs page.
// Both pages use the same control ids, so this module owns every filter, the
// activity chart, and the result list; the pages only supply the data.

(function (global) {
  "use strict";

  // Mirrors the labels on ROLE_PATTERNS in boards.js. Kept as its own copy because
  // boards.js is a CommonJS module the browser never loads; a key added there and
  // missed here surfaces in the filter as a raw slug rather than breaking.
  const ROLE_LABELS = {
    ai: "AI / ML",
    robotics: "Robotics",
    backend: "Backend",
    infra: "Infra / Platform",
    fullstack: "Full-stack",
    frontend: "Frontend",
    data: "Data",
    security: "Security",
    mobile: "Mobile",
    solutions: "Solutions / FDE",
    qa: "QA / Test",
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
  // From reading the posting rather than the title (classify.js), so a plain "Software
  // Engineer" asking for two years lands under Early career. Roles not yet classified
  // carry no value and are counted with "Not stated".
  const CAREER_LABELS = { early: "Early career", experienced: "Experienced", unclear: "Not stated" };
  const CAREER_ORDER = ["early", "experienced", "unclear"];
  const SIZE_LABELS = {
    "1-10": "1–10", "11-50": "11–50", "51-200": "51–200",
    "201-1000": "201–1,000", "1000+": "1,000+",
  };
  // Companies that have since been acquired. The VC boards still carry them under the
  // old name — nobody updates a portfolio entry after an exit — but their apply URLs
  // now resolve to the acquirer's ATS, so clicking "Element AI" lands you on a
  // ServiceNow posting with no explanation. Naming the acquirer on the card removes the
  // surprise without dropping the role, which is worth keeping: the job is real.
  //
  // Only acquisitions belong here. A company posting under a parent's slug (Snap Inc.
  // → snapchat), a legal entity (Apex Space → apex-technology-inc) or a rebrand
  // (Iterative Scopes → Iterative Health) has *not* been acquired, and saying so on a
  // public page would be a false claim about a real company. When in doubt, leave it
  // out — an unlabelled card is merely surprising; a wrong label is wrong.
  //
  // Keys are matched with punctuation and case stripped, the same way boards.js
  // compares BLOCKED_COMPANIES.
  const ACQUIRED_BY = {
    prepared: "Axon",                     // Sept 2025, $640M
    elementai: "ServiceNow",
    offerfit: "Braze",                    // June 2025, $325M
    verta: "Cloudera",                    // June 2024
    habu: "LiveRamp",                     // Jan 2024, $200M
    shapesecurity: "F5",
    volterra: "F5",
    lilaccloud: "F5",
    doctorondemand: "Included Health",
    normalyze: "Proofpoint",
    dataai: "Sensor Tower",
    tile: "Life360",
    validately: "UserTesting",
    convex: "ServiceTitan",
    ribbonhealth: "H1",
  };
  const acquirerOf = (company) =>
    ACQUIRED_BY[String(company || "").toLowerCase().replace(/[^a-z0-9]/g, "")] || null;

  // Rendered straight after the company name wherever it appears. Returns "" for the
  // overwhelming majority of companies, so it costs nothing on an unaffected card.
  function acquiredNote(company) {
    const by = acquirerOf(company);
    return by ? ` <span class="acquired-note">(acquired by ${escapeHtml(by)})</span>` : "";
  }

  // ---- "you've opened N roles here" ----
  //
  // Derived by joining the job list already in memory against track.js's opened set,
  // rather than kept as its own per-company tally. Two things fall out of that: it is
  // retroactive over history recorded long before this existed, and localStorage
  // still holds exactly one map of job ids with nothing to migrate or keep in step.
  //
  // Local to this browser, like everything else track.js records. It counts roles you
  // opened from this site — not applications, which the site has no way of knowing
  // about.
  let openedByCompany = null;
  let openedStamp = -1;
  let openedJobs = null;

  function openedCountFor(company) {
    const seen = global.Seen;
    if (!seen || !seen.count) return 0;
    const n = seen.count();
    if (!n) return 0;

    // Both checks are constant time. Count alone cannot invalidate this cache:
    // history stays at 5,000 entries while new clicks replace its oldest entries.
    const stamp = seen.revision ? seen.revision() : n;
    const all = global.JobsData ? global.JobsData.all() : null;
    if (openedStamp !== stamp || openedJobs !== all) {
      openedByCompany = new Map();
      for (const j of all || []) {
        if (!j.job_id || !seen.has(j.job_id)) continue;
        openedByCompany.set(j.company, (openedByCompany.get(j.company) || 0) + 1);
      }
      openedStamp = stamp;
      openedJobs = all;
    }
    return openedByCompany.get(company) || 0;
  }

  /**
   * What the badge says. A bare "(4)" beside a company name is a number with no unit —
   * it could as easily be open roles or investors — so the row states what it counts.
   *
   * "Opened", not "applied", and the distinction is not pedantry: clicking a title
   * hands you to the employer's own application page and nothing ever comes back from
   * it. The site knows you looked. It cannot know what you did next, and a row reading
   * "applied" would be claiming otherwise every time you opened a job and closed it.
   */
  function openedLabel(n) {
    return n ? `${n} role${n === 1 ? "" : "s"} opened at this company` : "";
  }

  /**
   * Update the badges already on screen.
   *
   * track.js marks a click and repaints that one row rather than re-rendering the
   * list, so without this the count beside the company name would sit one behind
   * until the next filter change — most visibly on the row you just clicked.
   *
   * The span is always rendered, empty at zero and hidden by :empty in CSS, so this
   * only ever sets text and never has to insert a node into a row.
   */
  function refreshOpenedCounts(root) {
    const scope = root && root.querySelectorAll ? root : document;
    const nodes = scope.querySelectorAll(".job-company-opened[data-opened-for]");
    for (const el of nodes) {
      const text = openedLabel(openedCountFor(el.getAttribute("data-opened-for")));
      if (el.textContent === text) continue;
      el.textContent = text;
    }
  }

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
        n === 0 ? (opts.placeholder || (opts.emptyLabel ? `${opts.emptyLabel} (${available})` : `All (${available})`))
        : n === 1 ? opts.labelFor([...selected][0])
        : `${n} ${opts.exclude ? "excluded" : "selected"}`;
      summary.textContent = value;
      summary.setAttribute("aria-label", `${opts.label} filter: ${n === 0 && opts.placeholder ? "Any" : value}`);
      root.classList.toggle("has-selection", n > 0);
      clear.hidden = n === 0;
    }

    function build() {
      const counts = new Map(opts.counts());
      // Keep a selected entry listed even when other filters exclude it, or the
      // only way to undo the selection would be Clear.
      selected.forEach((v) => { if (!counts.has(v)) counts.set(v, 0); });

      // An ordinal dimension carries its own scale and has to stay on it: a company
      // size list running 1,000+ → 51–200 → 201–1,000 reads as broken however well it
      // is sorted by volume, and ticking a box must not move the row you just ticked.
      // Everything else — companies, cities, industries — has no natural order, so it
      // leads with what you have selected and then with what has the most roles.
      // A value missing from the scale sorts to the end rather than to the front,
      // which is where indexOf's -1 would otherwise put it.
      const rank = opts.order
        ? (v) => { const i = opts.order.indexOf(v); return i < 0 ? Infinity : i; }
        : null;
      const entries = [...counts.entries()].sort((a, b) => {
        if (rank) return rank(a[0]) - rank(b[0]);
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
      // Hidden on an exclude filter, where "Select all" means "exclude every company"
      // and empties the list — a one-click way to reach a blank page and no obvious way
      // back. Excluding is done a company or two at a time; there is no bulk case.
      if (selectAll && opts.exclude) selectAll.hidden = true;
      else if (selectAll) {
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

  const dayOf = (j) => (j.posted ? startOfDay(new Date(j.posted)) : 0);
  // Groups seed `newest` at 0 and `oldest` at Infinity, and startOfDay(Infinity) is
  // NaN — which a comparator reads as 0 and silently scrambles the order around it.
  const dayOfTs = (ts) => (ts && isFinite(ts) ? startOfDay(ts) : 0);

  // The Companies view orders companies whose newest role landed on the same day at
  // random, so the first few do not take every visitor's attention forever. Each
  // company draws once per page load: drawing inside the comparator would not be a
  // valid ordering, and redrawing between renders would reshuffle the list under
  // someone paging through it. Keyed by name, since groups are rebuilt each render.
  const companyShuffle = new Map();
  function companyShuffleOf(name) {
    let v = companyShuffle.get(name);
    if (v === undefined) companyShuffle.set(name, (v = Math.random()));
    return v;
  }

  function createJobsView(config) {
    const cfg = Object.assign({ showFirms: false, firmLabel: (id) => id, contextLabel: null }, config);

    // Every multi-select filter is a "dimension": a key, how to read its values off a
    // job, and how to label them. Filters combine with AND across dimensions and OR
    // within one (ticking two cities means either city).
    //
    // `group` splits them into the two labelled blocks the controls render as. It is
    // presentation only: filtering, saved views, the counts and the reset button all
    // still treat DIMENSIONS as one flat list, so moving a filter between groups
    // changes where it sits on screen and nothing else.
    // Primary filters sit in the row beside the search; the rest in the grid under
    // it. Array order is the order they appear in each.
    const GROUPS = [
      { id: "advanced", target: "advanced-grid" },
    ];

    const DIMENSIONS = [
      { key: "role", label: "Role", group: "advanced", values: (j) => j.roles || [], labelFor: (v) => ROLE_LABELS[v] || v },
      { key: "city", label: "Location", group: "advanced", values: (j) => [j.city] },
      { key: "seniority", label: "Experience", group: "advanced", values: (j) => (j.seniority ? [j.seniority] : []), labelFor: (v) => SENIORITY_LABELS[v] || v, order: SENIORITY_ORDER },
      { key: "career", label: "Career stage", group: "advanced", values: (j) => [j.career || "unclear"], labelFor: (v) => CAREER_LABELS[v] || v, order: CAREER_ORDER },
      { key: "company", label: "Company", group: "advanced", values: (j) => [j.company] },
      // The only subtractive filter here. Everything else narrows to what you picked;
      // this one removes it, which is the difference between "show me these six
      // companies" and "show me everything except this one". Worth having because a
      // single employer that never closes a requisition can dominate a whole page —
      // one currently carries 665 roles, none posted in the last three months — and
      // the include filter cannot express "all of them but that".
      { key: "notcompany", label: "Exclude company", group: "advanced", values: (j) => [j.company], exclude: true },
      { key: "industry", label: "Industry", group: "advanced", values: (j) => j.markets || [] },
      { key: "size", label: "Company size", group: "advanced", values: (j) => (j.size ? [j.size] : []), labelFor: (v) => SIZE_LABELS[v] || v, order: SIZE_ORDER },
      { key: "stage", label: "Funding", group: "advanced", values: (j) => (j.stage ? [j.stage] : []) },
      { key: "firm", label: "Investor", group: "advanced", values: (j) => j.firms || [], labelFor: (v) => cfg.firmLabel(v), onlyWhenFirms: true },
    ].filter((d) => !d.onlyWhenFirms || cfg.showFirms);

    const state = {
      query: "", range: "all", salary: "all", sort: "newest",
      // Hides roles you have already opened. "Opened" is the only signal there is —
      // clicking a title sends you to the employer's application page, so it is the
      // closest thing to "applied" without asking you to tell us twice. See the
      // checkbox's own label, which says opened rather than applied for that reason.
      hideOpened: false,
      // Leaves only companies you have never opened a role at.
      //
      // The company-level sibling of hideOpened above: that one hides the individual
      // rows you have already been to, this one hides the company entirely the moment
      // you open anything there. Together they are the difference between "not this
      // exact role again" and "I have looked at this company, show me somewhere new".
      hideOpenedCompanies: false,
      selected: {}, // dimension key -> Set of chosen values
      jobs: [], page: 1,
      view: "flat",               // "flat" (every role) | "grouped" (by company)
      expanded: new Set(),        // company names open in the grouped view
    };
    DIMENSIONS.forEach((d) => (state.selected[d.key] = new Set()));

    const el = {
      search: $("job-search"),
      dateSelect: $("date-select"),
      salarySelect: $("salary-select"),
      resetBtn: $("reset-filters"),
      undoBtn: $("undo-filters"),
      sortSelect: $("sort-select"),
      hideOpened: $("hide-opened"),
      hideOpenedCompanies: $("hide-opened-companies"),
      count: $("job-count"),
      list: $("job-list"),
      pagination: $("job-pagination"),
      mobileFilterToggle: $("mobile-filter-toggle"),
      detail: $("job-detail"),
      viewTabs: $("job-view-tabs"),
      listHead: $("list-head"),
      sortWrap: $("list-sort"),
      viewFlat: $("view-flat"),
      viewGrouped: $("view-grouped"),
      countFlat: $("count-flat"),
      countGrouped: $("count-grouped"),
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
          const hit = d.values(j).some((v) => sel.has(v));
          // An exclude dimension drops what it matches; every other one keeps only
          // what it matches. Same set, opposite sign.
          if (d.exclude ? hit : !hit) return false;
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
        // track.js owns the opened set and loads after this file, so read it lazily
        // rather than capturing a reference that would still be undefined.
        if (state.hideOpened && global.Seen && j.job_id && global.Seen.has(j.job_id)) return false;
        // Company-level, so every row at a company passes or fails together: one click
        // anywhere at a company takes all of its roles out of the list. The count is a
        // cached Map lookup rather than a scan — see openedCountFor.
        if (state.hideOpenedCompanies && openedCountFor(j.company) > 0) return false;
        return true;
      });
    }

    function sortJobs(jobs) {
      const arr = jobs.slice();
      const t = (j) => (j.posted ? new Date(j.posted).getTime() : 0);
      const pay = (j) => j.salaryMax || j.salaryMin || 0;
      const byTitle = (a, b) => a.title.localeCompare(b.title) || a.company.localeCompare(b.company);

      // Both date orders group by posting day and, within a day, put roles that have a
      // description before roles that do not (`described`, marked by pipeline.js):
      // within the same day, the ones you can read about and check a resume against
      // are the more useful to reach first.
      //
      // Inside each of those groups "Newest first" is still newest at the finest
      // granularity the sources give (98.6% of roles carry a real posting time), not
      // alphabetical — fc7e671 sorted a day by title and put every "AI Engineer" at
      // the top of it, ahead of roles genuinely posted later. Roles that tie keep the
      // order they arrived in, because Array#sort is stable.
      const undescribed = (j) => (j.described ? 0 : 1);
      if (state.sort === "newest") arr.sort((a, b) => dayOf(b) - dayOf(a) || undescribed(a) - undescribed(b) || t(b) - t(a));
      // Oldest reads forwards from the bottom of the pile, where a stable alphabetical
      // order within each group is easier to scan than a minute-by-minute one.
      else if (state.sort === "oldest") arr.sort((a, b) => dayOf(a) - dayOf(b) || undescribed(a) - undescribed(b) || byTitle(a, b));
      else if (state.sort === "salary") arr.sort((a, b) => pay(b) - pay(a) || t(b) - t(a) || byTitle(a, b));
      else if (state.sort === "count") {
        // "Most roles" puts roles from the companies with the most matches under the
        // current filters first.
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
    // A primary picker has no visible label: it sits in a row of controls the size of
    // the search box, so its name doubles as the placeholder until something is picked.
    // One in the grid under it keeps its label above it.
    const pickerMarkup = (d) => `
      <div class="picker-wrap">
        ${d.group === "primary" ? "" : `<span class="picker-label">${escapeHtml(d.label)}</span>`}
        <details class="company-picker" id="pick-${d.key}">
          <summary id="sum-${d.key}">${d.group === "primary" ? escapeHtml(d.label) : "All"}</summary>
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
      </div>`;

    // Prepended, not assigned: the grid already holds Posted and Salary in
    // the page markup, with their options and listeners, and they
    // belong after the pickers. Both containers are filled once at init and never rebuilt.
    GROUPS.forEach((g) => {
      const host = $(g.target);
      const dims = DIMENSIONS.filter((d) => d.group === g.id);
      if (host && dims.length) host.insertAdjacentHTML("afterbegin", dims.map(pickerMarkup).join(""));
    });

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
            order: d.order || null,
            exclude: !!d.exclude,
            // "All (1617)" would be a lie on a filter that removes things: with nothing
            // ticked it excludes nothing at all.
            emptyLabel: d.exclude ? "None" : null,
            placeholder: d.group === "primary" ? d.label : null,
            maxOptions: 60,
            // Counts come from everything *except* this dimension, so an option only
            // appears if it would still return rows under the other active filters.
            counts: () => {
              const m = new Map();
              filtered(d.key).forEach((j) => d.values(j).forEach((v) => { if (v) m.set(v, (m.get(v) || 0) + 1); }));
              // Deliberately unsorted: the picker owns ordering, because it is the only
              // one that can see which options are selected and which zero-count rows it
              // had to add back. Sorting here as well is what let the two disagree — this
              // ordered by the scale, the picker re-sorted by volume, and the picker won.
              return [...m.entries()];
            },
            onChange: () => {
              state.page = 1;
              renderResults();
              refreshOtherPickers(d.key);
              updateResetBtn();
              // Ticking a dropdown deliberately skips render() — it must not rebuild
              // the list under the cursor — so history and the URL are updated here too.
              if (!restoring) recordHistory();
              syncUrl();
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

    // ---- saved jobs (saved.js) ----
    const BOOKMARK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';
    const isSaved = (id) => !!(global.Saved && id && global.Saved.has(id));
    const saveButton = (j, cls) =>
      `<button type="button" class="${cls}${isSaved(j.job_id) ? " is-saved" : ""}" data-save="${escapeHtml(j.job_id)}" aria-pressed="${isSaved(j.job_id)}"` +
      ` aria-label="${isSaved(j.job_id) ? "Remove from saved jobs" : "Save job"}: ${escapeHtml(j.title)}" title="${isSaved(j.job_id) ? "Saved" : "Save job"}">${BOOKMARK}</button>`;
    // A saved job that is no longer on the boards, rebuilt from its saved copy.
    function savedOnly(id) {
      const s = global.Saved && global.Saved.all().find((x) => x.id === id);
      return s ? { ...s.job, job_id: s.id, roles: [], unlisted: true } : null;
    }
    const findJob = (id) => state.jobs.find((x) => x.job_id === id) || savedOnly(id);

    // The tag row and meta line, shared by a list row and the description pane.
    function jobParts(j) {
      const roleTags = j.roles.map((r) => `<span class="role-tag${r === "ai" ? " ai" : ""}">${escapeHtml(ROLE_LABELS[r] || r)}</span>`).join("");
      const src = j.unlisted
        ? `<span class="src-tag" title="Saved earlier; no longer on the job boards">no longer listed</span>`
        : j.source === "ats"
        ? `<span class="src-tag ats" title="Fetched live from ${escapeHtml(j.ats || "the company")}'s job board">${escapeHtml(j.ats || "ats")}</span>`
        : `<span class="src-tag" title="From the VC's portfolio board">vc board</span>`;
      // Date is always the final item so its position never shifts between rows. A
      // saved job that has left the boards says so here, since rows carry no tags.
      const meta = [j.unlisted ? "No longer listed" : null, j.city, j.remote ? "Remote OK" : null, relativeDate(j.posted)]
        .filter(Boolean).map(escapeHtml).join(" &middot; ");
      const pay = compactPay(j);
      const payBit = pay
        ? `<span class="job-salary"${j.salary ? ` title="${escapeHtml(j.salary)}"` : ""}>${escapeHtml(pay)}</span>`
        : "";
      // The same facts split for a row, which gives where and when a line each.
      const place = [j.unlisted ? "No longer listed" : null, j.city, j.remote ? "Remote OK" : null]
        .filter(Boolean).map(escapeHtml).join(" &middot; ");
      const when = j.posted ? escapeHtml(relativeDate(j.posted)) : "";
      return { roleTags, src, meta, payBit, place, when };
    }

    // `inGroup` drops the company line: inside a company card the name is the header.
    function jobHtml(j, inGroup) {
      const { payBit, place, when } = jobParts(j);
      // With a description pane, a plain click on the title selects the row instead of
      // leaving the page; data-selects tells track.js that click is not an "opened".
      // Cmd/Ctrl/middle-click still open the posting in a new tab, and count.
      const selects = el.detail && j.job_id ? " data-selects" : "";
      // data-* here is read by track.js, which delegates off document — this row is
      // replaced wholesale on every filter change, so per-row listeners wouldn't survive.
      const title = j.url
        ? `<a class="job-title" href="${escapeHtml(j.url)}" target="_blank" rel="noopener noreferrer"` +
          ` data-job-id="${escapeHtml(j.job_id || "")}" data-company="${escapeHtml(j.company)}"` +
          ` data-city="${escapeHtml(j.city || "")}"${selects}>${escapeHtml(j.title)}</a>`
        : `<span class="job-title">${escapeHtml(j.title)}</span>`;
      // Investors are deliberately absent from the row: they repeat on every job at a
      // company and crowd the title. The Investor filter still works.
      // How many roles at this company you have opened, under the date at the right.
      // Always emitted, empty at zero: refreshOpenedCounts() then only has to set
      // text on a click, and CSS :empty keeps a company you've never opened looking
      // exactly as it did before.
      const openedBit = inGroup ? "" :
        `<span class="job-company-opened" data-opened-for="${escapeHtml(j.company)}">` +
        `${escapeHtml(openedLabel(openedCountFor(j.company)))}</span>`;
      const companyBit = inGroup ? "" : `<span class="job-company">${escapeHtml(j.company)}${acquiredNote(j.company)}</span>`;
      // Company and salary share one line; in a company card, the salary alone, or none.
      const subLine = companyBit || payBit ? `<p class="job-sub">${companyBit}${payBit}</p>` : "";
      return `
        <article class="job${j.job_id && j.job_id === selectedId ? " is-selected" : ""}"${j.job_id ? ` data-job-id="${escapeHtml(j.job_id)}"` : ""}>
          <div class="job-main">
            ${title}
            ${subLine}
            ${place ? `<p class="job-meta job-place">${place}</p>` : ""}
          </div>
          <div class="job-side">
            ${when ? `<p class="job-meta job-when">${when}</p>` : ""}
            ${openedBit}
          </div>
        </article>`;
    }

    // ---- description pane ----
    // Descriptions are not in the job list; each lives in a shard file of a few jobs,
    // fetched on first click (see description.js). Shards are cached for the visit.
    let selectedId = null;
    const shardCache = new Map(); // shard -> Promise<{ job_id: text }>
    const NARROW = global.matchMedia ? global.matchMedia("(max-width: 1099px)") : null;
    const isNarrow = () => !!(NARROW && NARROW.matches);

    function loadDescription(id) {
      const D = global.JobDescription;
      if (!D) return Promise.resolve(null);
      const k = D.shardOf(id);
      if (!shardCache.has(k)) {
        shardCache.set(k, fetch(`api/desc/${k}.json`)
          .then((r) => (r.ok ? r.json() : {}))
          .catch(() => {
            shardCache.delete(k); // a network blip should not stick for the whole visit
            return null;
          }));
      }
      return shardCache.get(k).then((shard) => (shard ? shard[id] || "" : null));
    }

    // The description arrives as HTML in a small vocabulary (see description.js). It is
    // parsed into an inert document — DOMParser runs no scripts and loads no images —
    // and rebuilt here from the same allowlist, so only these elements, and a link's
    // http(s) or mailto address, ever reach the page.
    const DESC_TAGS = new Set(["P", "BR", "UL", "OL", "LI", "H3", "H4", "STRONG", "EM", "A"]);
    function descriptionFragment(html) {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const frag = document.createDocumentFragment();
      (function copy(from, to) {
        for (const n of from.childNodes) {
          if (n.nodeType === 3) { to.appendChild(document.createTextNode(n.nodeValue)); continue; }
          if (n.nodeType !== 1) continue;
          if (!DESC_TAGS.has(n.tagName)) { copy(n, to); continue; }
          const el = document.createElement(n.tagName.toLowerCase());
          if (n.tagName === "A") {
            const href = n.getAttribute("href") || "";
            if (/^(https?:|mailto:)/i.test(href)) {
              el.href = href;
              el.target = "_blank";
              el.rel = "noopener noreferrer nofollow";
            }
          }
          copy(n, el);
          to.appendChild(el);
        }
      })(doc.body, frag);
      // A paragraph that is nothing but bold text is how most boards write a section
      // heading ("About the role"), so it gets a heading's spacing.
      frag.querySelectorAll("p").forEach((p) => {
        const kids = [...p.childNodes].filter((n) => n.nodeType === 1 || n.nodeValue.trim());
        if (kids.length === 1 && kids[0].nodeName === "STRONG") p.className = "desc-label";
      });
      return frag;
    }

    // Show the slim bar once the full header has scrolled out of the pane.
    function updateBar() {
      const head = $("detail-top");
      const bar = $("detail-bar");
      if (!head || !bar) return;
      const shown = el.detail.scrollTop > head.offsetTop + head.offsetHeight - bar.offsetHeight;
      if (shown === bar.classList.contains("is-shown")) return;
      bar.classList.toggle("is-shown", shown);
      bar.inert = !shown;
    }
    if (el.detail) el.detail.addEventListener("scroll", updateBar, { passive: true });

    function renderDetail(j) {
      if (!el.detail) return;
      const { meta, payBit, roleTags, src } = jobParts(j);
      const detailPay = payBit || (j.salary ? escapeHtml(j.salary) : "");
      // data-track-open: track.js counts this as opening the role, as a title click was.
      const apply = j.url
        ? `<a class="detail-apply" href="${escapeHtml(j.url)}" target="_blank" rel="noopener noreferrer" data-track-open` +
          ` data-job-id="${escapeHtml(j.job_id || "")}" data-company="${escapeHtml(j.company)}"` +
          ` data-city="${escapeHtml(j.city || "")}" data-title="${escapeHtml(j.title)}">Apply<span class="apply-more"> on company site</span> ↗</a>`
        : "";
      // One persistent header keeps Apply and Save available without duplicate controls.
      const back = `<button type="button" class="detail-close" aria-label="Back to jobs"><span aria-hidden="true">←</span><span class="detail-close-text" aria-hidden="true"> Back to jobs</span></button>`;
      // As on LinkedIn: the full header scrolls away with the description, and once it
      // is out of view a slim bar takes its place at the top of the pane — title,
      // company and place, Save and Apply. The bar sits in a zero-height sticky anchor
      // so it never pushes the text, and it is inert while hidden so its controls are
      // not duplicate tab stops.
      const place = [j.city, j.remote ? "Remote OK" : null].filter(Boolean).join(" · ");
      const bar = `
        <div class="detail-bar-anchor"><div class="detail-bar" id="detail-bar" inert>
          ${back}
          <div class="detail-bar-text">
            <p class="detail-bar-title">${escapeHtml(j.title)}</p>
            <p class="detail-bar-sub">${escapeHtml(j.company)}${place ? ` · ${escapeHtml(place)}` : ""}</p>
          </div>
          <div class="detail-actions">${j.job_id ? saveButton(j, "detail-save") : ""}${apply}</div>
        </div></div>`;
      el.detail.innerHTML = `${bar}
        <div class="detail-head" id="detail-top">
            ${back}
            <p class="detail-company">${escapeHtml(j.company)}${acquiredNote(j.company)}</p>
            <h2 class="detail-title" id="detail-title" title="${escapeHtml(j.title)}" tabindex="-1">${escapeHtml(j.title)}</h2>
            <p class="detail-meta">${meta}${detailPay ? ` &middot; ${detailPay}` : ""}</p>
            <div class="job-tags detail-tags">${roleTags}${src}</div>
            <div class="detail-actions">${apply}${j.job_id ? saveButton(j, "detail-save") : ""}</div>
        </div>
        <section class="detail-match" id="detail-match" aria-label="Resume match"></section>
        <div class="description-controls" hidden><h3>Job description</h3><label class="description-highlights"><span>Match highlights</span><input type="checkbox" role="switch" aria-label="Match highlights" aria-controls="detail-body"><span class="highlight-switch" aria-hidden="true"></span></label></div>
        <section class="detail-body" id="detail-body" aria-label="Full job description" aria-busy="true"><p class="detail-note">Loading description…</p></section>`;
      el.detail.scrollTop = 0;
      updateBar();
      const description = loadDescription(j.job_id);
      if (global.ResumeMatch) global.ResumeMatch.mount($("detail-match"), j, description);
      description.then((text) => {
        if (selectedId !== j.job_id) return; // another job was picked meanwhile
        const body = $("detail-body");
        if (!body) return;
        if (text) body.replaceChildren(descriptionFragment(text));
        else if (text === null) body.innerHTML = `<p class="detail-note">The description could not be loaded. Try again in a moment, or open the posting.</p>`;
        else if (j.unlisted) body.innerHTML = `<p class="detail-note">This job is no longer on the boards we track, so its description isn't available here. The link above may still lead to the posting.</p>`;
        else body.innerHTML = `<p class="detail-note">This listing was published without a description. The posting on the company's site has the details.</p>`;
        // resume-match.js marks the requirements in the text once it is on the page.
        body.dataset.ready = j.job_id;
        body.removeAttribute("aria-busy");
        el.detail.dispatchEvent(new CustomEvent("description-ready", { bubbles: true, detail: { jobId: j.job_id, body, hasText: !!text } }));
      });
    }

    function setDetailOpen(open) {
      if (!el.detail) return;
      el.detail.classList.toggle("is-open", open);
      document.body.classList.toggle("detail-open", open && isNarrow());
      const overlay = open && isNarrow();
      if (overlay) {
        el.detail.setAttribute("role", "dialog");
        el.detail.setAttribute("aria-modal", "true");
        el.detail.setAttribute("aria-labelledby", "detail-title");
      } else {
        el.detail.removeAttribute("role");
        el.detail.removeAttribute("aria-modal");
        el.detail.removeAttribute("aria-labelledby");
      }
    }

    function revealDetailWorkspace() {
      if (!el.detail || isNarrow()) return;
      // Move past the landing header, keeping the pinned filters above the pane.
      // Once the workspace is in view, browsing more jobs must not move the page.
      const top = el.detail.getBoundingClientRect().top;
      const dock = parseFloat(getComputedStyle(el.detail).top) || 0;
      if (top <= dock + 1) return;
      global.scrollTo({
        top: global.scrollY + top - dock,
        behavior: global.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    }

    function selectJob(id, { revealWorkspace = true } = {}) {
      const j = findJob(id);
      if (!j) return;
      selectedId = id;
      el.list.querySelectorAll(".job.is-selected").forEach((r) => r.classList.remove("is-selected"));
      const row = el.list.querySelector(`.job[data-job-id="${CSS.escape(id)}"]`);
      if (row) row.classList.add("is-selected");
      renderDetail(j);
      setDetailOpen(true);
      if (revealWorkspace) revealDetailWorkspace();
      // Over the list on narrow screens, so focus has to go with it; beside the list,
      // focus stays on the row so arrow-and-click browsing keeps its place.
      if (isNarrow()) { const t = $("detail-title"); if (t) t.focus({ preventScroll: true }); }
    }

    function closeDetail() {
      if (!el.detail || !el.detail.classList.contains("is-open")) return;
      setDetailOpen(false);
      if (isNarrow() && selectedId) {
        const row = el.list.querySelector(`.job[data-job-id="${CSS.escape(selectedId)}"] .job-title`);
        if (row) row.focus();
      }
    }

    if (el.detail) {
      el.list.addEventListener("click", (e) => {
        if (e.target.closest("[data-save]")) return; // handled below, without selecting the row
        // Modified clicks keep their browser meaning: a new tab or window on the posting.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const row = e.target.closest(".job[data-job-id]");
        if (!row) return;
        e.preventDefault();
        selectJob(row.dataset.jobId);
      });
      el.detail.addEventListener("click", (e) => {
        if (e.target.closest(".detail-close")) closeDetail();
      });
      document.addEventListener("keydown", (e) => {
        if (e.defaultPrevented || !isNarrow() || !el.detail.classList.contains("is-open")) return;
        if (e.key === "Escape") { closeDetail(); return; }
        if (e.key !== "Tab") return;
        const focusable = [...el.detail.querySelectorAll("a[href], button, input, select, summary, [tabindex='0']")]
          // Not the slim bar's controls while it is hidden: it is inert, so the browser
          // skips them, and counting them would let focus slip out of the pane.
          .filter((node) => !node.disabled && node.getAttribute("tabindex") !== "-1" && node.getClientRects().length && !node.closest("[inert]"));
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !el.detail.contains(document.activeElement))) {
          e.preventDefault(); last?.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !el.detail.contains(document.activeElement))) {
          e.preventDefault(); first?.focus();
        }
      });
      // Widening past the breakpoint turns the overlay back into the column; the scroll
      // lock it held has to go with it.
      if (NARROW) NARROW.addEventListener("change", () => setDetailOpen(el.detail.classList.contains("is-open")));
    }

    // ---- side by side ----
    // From 1100px the list and the description sit side by side. The list is part of
    // the page and scrolls with it, footer and all; the description pane stays in view
    // (sticky) and scrolls on its own. .is-split only marks the wide layout, for the
    // things that only make sense there (the arrow-key hint).
    const split = $("results-split");
    const WIDE = global.matchMedia ? global.matchMedia("(min-width: 1100px)") : null;
    const COLUMN_KEY = 'find-jobs-column-ratio';
    const DEFAULT_COLUMN_RATIO = 0.6; // the list's share; the description has the rest
    let columnRatio = DEFAULT_COLUMN_RATIO, columnDrag = null;
    try {
      const saved = Number(localStorage.getItem(COLUMN_KEY));
      if (Number.isFinite(saved) && saved > 0 && saved < 1) columnRatio = saved;
    } catch { /* Width adjustment works without browser storage. */ }
    const divider = split && el.detail ? document.createElement('div') : null;
    if (divider) {
      divider.className = 'column-resizer';
      divider.tabIndex = 0;
      divider.setAttribute('role', 'separator');
      divider.setAttribute('aria-label', 'Resize job columns');
      divider.setAttribute('aria-orientation', 'vertical');
      divider.setAttribute('aria-controls', 'job-list job-detail');
      divider.setAttribute('aria-description', 'Use Left and Right arrows to resize. Home and End set the limits. Enter or double-click resets the widths.');
      divider.title = 'Drag to resize · Arrow keys to adjust · Double-click to reset';
      el.detail.before(divider);
    }
    // The list's header at its natural width: every tab and Sort at their content
    // size, plus the gap between them. The divider stops there, so dragging it left
    // never pushes Sort into the tabs.
    function listHeadWidth() {
      const head = el.listHead;
      if (!head || !head.offsetParent) return 0;
      const natural = (node) => {
        if (!node) return 0;
        const { flex, width } = node.style;
        node.style.flex = "none"; node.style.width = "max-content";
        const w = node.getBoundingClientRect().width;
        node.style.flex = flex; node.style.width = width;
        return w;
      };
      const gap = parseFloat(getComputedStyle(head).columnGap) || 0;
      return natural(el.viewTabs) + (el.sortWrap ? gap + natural(el.sortWrap) : 0);
    }
    function columnBounds() {
      if (!divider || !WIDE?.matches) return null;
      const gap = parseFloat(getComputedStyle(split).columnGap) || 0;
      const available = split.clientWidth - gap * 2 - divider.offsetWidth;
      const minList = Math.max(350, Math.ceil(listHeadWidth()));
      return available > minList + 440 ? { available, gap, min: minList / available, max: 1 - 440 / available } : null;
    }
    function updateColumns(requested = columnRatio, remember = false) {
      if (!divider) return;
      divider.hidden = !WIDE?.matches;
      if (divider.hidden) { el.detail.classList.remove('is-narrow-column'); return; }
      const bounds = columnBounds();
      if (!bounds) return;
      const ratio = Math.min(bounds.max, Math.max(bounds.min, requested));
      if (remember) columnRatio = ratio;
      // Keep each fraction above 1 so a column hitting its minimum does not leave
      // unallocated grid space (CSS partially fills tracks whose fr sum is < 1).
      split.style.setProperty('--job-list-width', `${ratio * 100}fr`);
      split.style.setProperty('--job-detail-width', `${(1 - ratio) * 100}fr`);
      divider.setAttribute('aria-valuemin', String(Math.round(bounds.min * 100)));
      divider.setAttribute('aria-valuemax', String(Math.round(bounds.max * 100)));
      divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      divider.setAttribute('aria-valuetext', `Job list ${Math.round(ratio * 100)}%, job details ${100 - Math.round(ratio * 100)}%`);
      el.detail.classList.toggle('is-narrow-column', bounds.available * (1 - ratio) < 560);
    }
    function saveColumns() {
      try { localStorage.setItem(COLUMN_KEY, String(columnRatio)); } catch { /* Fine. */ }
    }
    function finishColumnDrag(commit) {
      if (!columnDrag) return;
      const previous = columnDrag;
      columnDrag = null;
      document.documentElement.classList.remove('is-resizing-columns');
      if (!commit) updateColumns(previous.initial, true); else saveColumns();
      if (divider.hasPointerCapture(previous.id)) divider.releasePointerCapture(previous.id);
    }
    if (divider) {
      divider.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !columnBounds()) return;
        event.preventDefault();
        divider.focus({ preventScroll: true });
        const rect = divider.getBoundingClientRect();
        columnDrag = { id: event.pointerId, initial: columnRatio, offset: event.clientX - rect.left - rect.width / 2 };
        divider.setPointerCapture(event.pointerId);
        document.documentElement.classList.add('is-resizing-columns');
      });
      divider.addEventListener('pointermove', (event) => {
        if (!columnDrag || event.pointerId !== columnDrag.id) return;
        const bounds = columnBounds();
        if (!bounds) { finishColumnDrag(false); return; }
        const left = event.clientX - split.getBoundingClientRect().left - columnDrag.offset - bounds.gap - divider.offsetWidth / 2;
        updateColumns(left / bounds.available, true);
      });
      divider.addEventListener('pointerup', () => finishColumnDrag(true));
      divider.addEventListener('pointercancel', () => finishColumnDrag(false));
      divider.addEventListener('lostpointercapture', () => finishColumnDrag(true));
      divider.addEventListener('dblclick', () => { updateColumns(DEFAULT_COLUMN_RATIO, true); saveColumns(); });
      divider.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && columnDrag) { event.preventDefault(); finishColumnDrag(false); return; }
        const bounds = columnBounds();
        if (!bounds || !['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const current = split.querySelector('.results-main').offsetWidth / bounds.available;
        const step = event.shiftKey ? 0.1 : 0.02;
        const requested = event.key === 'Home' ? bounds.min : event.key === 'End' ? bounds.max : event.key === 'Enter' ? DEFAULT_COLUMN_RATIO : current + (event.key === 'ArrowLeft' ? -step : step);
        updateColumns(requested, true); saveColumns();
      });
    }
    // On wide screens the filter bar stays pinned at the top of the window; the pane
    // sits just under it, so its height is published as --toolbar-height.
    const controls = $("job-controls");
    function updateDock() {
      const wide = !!(WIDE && WIDE.matches) && !!el.detail;
      if (split) split.classList.toggle("is-split", wide);
      if (!wide && columnDrag) finishColumnDrag(false);
      updateColumns();
      const pinned = wide && controls && getComputedStyle(controls).position === "sticky";
      document.documentElement.style.setProperty("--toolbar-height", pinned ? controls.offsetHeight + "px" : "0px");
    }
    if (split) {
      if (WIDE) WIDE.addEventListener("change", updateDock);
      if (controls && global.ResizeObserver) new ResizeObserver(updateDock).observe(controls);
      if (divider && global.ResizeObserver) new ResizeObserver(() => updateColumns()).observe(split);
      updateDock();
    }

    // ---- the first role, selected ----
    // Beside the list the pane is never left empty: on arrival, after the filters
    // change, on a new page, and on switching tabs, the first role on screen is selected
    // — in the Companies tab, the first company opens and its first role is taken. Not
    // under 1100px, where selecting opens a sheet over the list the reader came to see.
    // Not scrolled to, and not counted as opening the role: only Apply is.
    let firstTimer = null;
    function selectFirst(delay = 0) {
      clearTimeout(firstTimer);
      firstTimer = setTimeout(() => {
        if (!el.detail || !(WIDE && WIDE.matches)) return;
        if (state.view === "grouped") {
          const head = el.list.querySelector(".cg-head");
          if (head && !state.expanded.has(head.dataset.company)) {
            state.expanded.add(head.dataset.company);
            renderResults();
          }
        }
        const row = el.list.querySelector(".job[data-job-id]");
        if (row && row.dataset.jobId !== selectedId) selectJob(row.dataset.jobId, { revealWorkspace: false });
      }, delay);
    }

    // ---- All jobs / Companies tabs ----
    function updateListTabs() {
      if (el.viewFlat) el.viewFlat.setAttribute("aria-pressed", String(state.view === "flat"));
      if (el.viewGrouped) el.viewGrouped.setAttribute("aria-pressed", String(state.view === "grouped"));
    }

    // Bookmarks, on a row or in the pane: save or unsave without selecting anything.
    function onSaveClick(e) {
      const b = e.target.closest("[data-save]");
      if (!b || !global.Saved) return;
      e.preventDefault();
      const job = findJob(b.dataset.save);
      if (job) global.Saved.toggle(job);
    }
    if (el.detail) {
      el.list.addEventListener("click", onSaveClick);
      el.detail.addEventListener("click", onSaveClick);
    }
    // Any change — here, in another tab of the site, or the account's list arriving —
    // repaints every bookmark on screen.
    function refreshSaved() {
      document.querySelectorAll("[data-save]").forEach((b) => {
        const on = isSaved(b.dataset.save);
        b.classList.toggle("is-saved", on);
        b.setAttribute("aria-pressed", String(on));
        b.title = on ? "Saved" : "Save job";
        b.setAttribute("aria-label", (on ? "Remove from saved jobs" : "Save job") + b.getAttribute("aria-label").replace(/^[^:]*/, ""));
      });
    }
    global.addEventListener("saved-change", refreshSaved);
    global.addEventListener("saved-sync", refreshSaved);

    // ---- ↑ / ↓ through the list ----
    // Moves the selection, and the description with it, without leaving the keyboard.
    // Past the last row it carries on to the next page; past the first, to the end of
    // the previous one. Only while nothing else wants the arrows: focus on the list or
    // on nothing, so typing in search, an open menu, or scrolling the description
    // with the keyboard all keep the arrows for themselves.
    function keepRowInView(row) {
      row.scrollIntoView({ block: "nearest" });
    }
    function selectRow(row) {
      selectJob(row.dataset.jobId, { revealWorkspace: false });
      keepRowInView(row);
      const title = row.querySelector(".job-title");
      if (title && !isNarrow()) title.focus({ preventScroll: true });
    }
    function turnPage(page, pick) {
      state.page = page;
      pushNext = true;
      renderResults();
      syncUrl();
      const anchor = el.count ? el.count.parentElement : el.list;
      if (anchor) anchor.scrollIntoView({ block: "start" });
      const rows = el.list.querySelectorAll(".job[data-job-id]");
      if (rows.length) selectRow(pick === "last" ? rows[rows.length - 1] : rows[0]);
    }
    if (el.detail) {
      document.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        if (isNarrow() && el.detail.classList.contains("is-open")) return; // the sheet covers the list
        const a = document.activeElement;
        const idle = !a || a === document.body || a === document.documentElement;
        if (!idle && !el.list.contains(a)) return;
        // An open dropdown (filters, sort, saved filters, resume, account) has the arrows.
        if (document.querySelector("details.company-picker[open], details.preset-picker[open], details.account-menu[open]")) return;
        const rows = [...el.list.querySelectorAll(".job[data-job-id]")];
        if (!rows.length) return;
        e.preventDefault();
        const down = e.key === "ArrowDown";
        const at = rows.findIndex((r) => r.classList.contains("is-selected"));
        const next = at === -1 ? (down ? 0 : rows.length - 1) : at + (down ? 1 : -1);
        if (next >= rows.length) { if (state.page < currentPageCount) turnPage(state.page + 1, "first"); return; }
        if (next < 0) { if (state.page > 1) turnPage(state.page - 1, "last"); return; }
        selectRow(rows[next]);
      });
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

    // ---- Companies view ----
    // The same filtered roles, one card per company; a card opens to its roles, and a
    // role opens in the description pane like any other row. A monogram tint stands in
    // where a company has no logo, derived from the name so it keeps its colour.
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
                titleFirst: j.title, payMax: 0, size: j.size, stage: j.stage, logo: j.logo || null };
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
        if (!g.logo && j.logo) g.logo = j.logo;
      }
      const groups = [...map.values()];
      const byName = (a, b) => a.company.localeCompare(b.company);
      if (state.sort === "company") groups.sort(byName);
      // Title A–Z orders companies by the first title they hold, so it stays about titles.
      else if (state.sort === "title") groups.sort((a, b) => a.titleFirst.localeCompare(b.titleFirst) || byName(a, b));
      else if (state.sort === "salary") groups.sort((a, b) => b.payMax - a.payMax || b.jobs.length - a.jobs.length || byName(a, b));
      else if (state.sort === "count") groups.sort((a, b) => b.jobs.length - a.jobs.length || byName(a, b));
      else if (state.sort === "oldest") groups.sort((a, b) => dayOfTs(a.oldest) - dayOfTs(b.oldest) || companyShuffleOf(a.company) - companyShuffleOf(b.company));
      else groups.sort((a, b) => dayOfTs(b.newest) - dayOfTs(a.newest) || companyShuffleOf(a.company) - companyShuffleOf(b.company));
      return groups;
    }

    function groupHtml(g) {
      const open = state.expanded.has(g.company);
      const m = monogram(g.company);
      const n = g.jobs.length;
      const badge = `<span class="cg-mono t${m.tint}" aria-hidden="true">${escapeHtml(m.initials)}</span>`;
      // A logo that fails to load gives way to the monogram, in the same box.
      const logo = g.logo
        ? `<span class="cg-logo"><img src="${escapeHtml(g.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"` +
          ` onerror="this.parentNode.replaceWith(Object.assign(document.createElement('span'),{className:'cg-mono t${m.tint}',textContent:'${escapeHtml(m.initials)}'}))" /></span>`
        : badge;
      const cities = [...g.cities.entries()].sort((a, b) => b[1] - a[1])
        .map(([c, k]) => `<span class="cg-city">${escapeHtml(c)}${n > 1 ? `&nbsp;<span class="cg-n">${k}</span>` : ""}</span>`)
        .join(`&#8203;<span class="cg-sep">·</span>`);
      const facts = [
        g.size ? (SIZE_LABELS[g.size] || g.size) + " staff" : null,
        g.stage,
        g.payMax ? "up to $" + Math.round(g.payMax / 1000) + "k" : null,
        g.newest ? relativeDate(new Date(g.newest).toISOString()) : null,
      ].filter(Boolean).map((f) => `<span class="cg-fact">${escapeHtml(f)}</span>`).join("");
      const opened = openedCountFor(g.company);
      return `
        <section class="cgroup${open ? " is-open" : ""}">
          <button class="cg-head" type="button" data-company="${escapeHtml(g.company)}" aria-expanded="${open}">
            <span class="cg-top">
              ${logo}
              <span class="cg-heading">
                <span class="cg-name">${escapeHtml(g.company)}${acquiredNote(g.company)}${opened ? ` <span class="job-company-opened">${escapeHtml(openedLabel(opened))}</span>` : ""}</span>
                ${facts ? `<span class="cg-facts">${facts}</span>` : ""}
              </span>
              <span class="cg-count">${n} role${n === 1 ? "" : "s"}</span>
              <span class="cg-toggle" aria-hidden="true"></span>
            </span>
            <span class="cg-cities"><span class="cg-label">Hiring in</span>${cities}</span>
          </button>
          ${open ? `<div class="cg-body">${g.jobs.map((j) => jobHtml(j, true)).join("")}</div>` : ""}
        </section>`;
    }

    function renderGroups(results) {
      const groups = buildGroups(results);
      const pageCount = Math.max(1, Math.ceil(groups.length / COMPANIES_PER_PAGE));
      state.page = Math.min(Math.max(1, state.page), pageCount);
      const start = (state.page - 1) * COMPANIES_PER_PAGE;
      const slice = groups.slice(start, start + COMPANIES_PER_PAGE);
      el.count.dataset.total = groups.length.toLocaleString();
      el.count.textContent = groups.length
        ? `Showing ${start + 1}–${start + slice.length} of ${groups.length} companies · ${results.length} roles`
        : "0 companies · 0 roles";
      el.list.innerHTML = slice.length ? slice.map(groupHtml).join("") : `<p class="empty">No roles match those filters.</p>`;
      renderPagination(pageCount);
    }

    // Opening or closing a company redraws the list in place and keeps focus on its
    // header, which the redraw replaces.
    el.list.addEventListener("click", (e) => {
      const head = e.target.closest(".cg-head");
      if (!head) return;
      const company = head.dataset.company;
      if (state.expanded.has(company)) state.expanded.delete(company);
      else state.expanded.add(company);
      const hadFocus = document.activeElement === head;
      renderResults();
      if (hadFocus) el.list.querySelector(`.cg-head[data-company="${CSS.escape(company)}"]`)?.focus();
    });

    // `isNav` is set only by the tabs themselves: restoring a URL also moves the tab,
    // and that should not leave a history entry behind.
    function setView(view, isNav) {
      view = view === "grouped" ? "grouped" : "flat";
      if (isNav && view !== state.view) pushNext = true;
      state.view = view;
      state.page = 1;
      renderResults();
      syncUrl();
      selectFirst();
    }
    if (el.viewFlat) el.viewFlat.addEventListener("click", () => setView("flat", true));
    if (el.viewGrouped) el.viewGrouped.addEventListener("click", () => setView("grouped", true));

    function renderResults() {
      updateListTabs();
      const results = sortJobs(filtered());
      // Each tab says what it would show, so the choice is informed before the click.
      if (el.countFlat) el.countFlat.textContent = results.length.toLocaleString();
      if (el.countGrouped) el.countGrouped.textContent = new Set(results.map((j) => j.company)).size.toLocaleString();
      if (state.view === "grouped") { renderGroups(results); return; }
      const pageCount = Math.max(1, Math.ceil(results.length / JOBS_PER_PAGE));
      state.page = Math.min(Math.max(1, state.page), pageCount);
      const start = (state.page - 1) * JOBS_PER_PAGE;
      const slice = results.slice(start, start + JOBS_PER_PAGE);
      el.count.dataset.total = results.length.toLocaleString();
      el.count.textContent = results.length
        ? `Showing ${start + 1}–${start + slice.length} of ${results.length} matching roles`
        : "0 matching roles";
      el.list.innerHTML = slice.length ? slice.map((j) => jobHtml(j)).join("") : `<p class="empty">No roles match those filters.</p>`;
      renderPagination(pageCount);
    }

    function activeCount() {
      let n = DIMENSIONS.reduce((a, d) => a + (state.selected[d.key].size ? 1 : 0), 0);
      if (state.range !== "all") n++;
      if (state.salary !== "all") n++;
      if (state.query.trim()) n++;
      if (state.hideOpened) n++;
      if (state.hideOpenedCompanies) n++;
      return n;
    }

    function updateResetBtn() {
      const n = activeCount();
      if (el.undoBtn) updateUndoBtn();

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

    // ---- browser history ----
    // The URL describes what you are looking at, so a filtered view survives a reload
    // and can be shared or bookmarked. Two kinds of change, deliberately:
    //
    //   pushState     page and tab. These read as navigation, so Back steps through them.
    //   replaceState  filters, search, sort. These refine one view; giving each its own
    //                 history entry is what makes Back feel like a trap you have to
    //                 press your way out of. The Undo button reverses these instead.
    //
    // `global.history` rather than `history`: the undo stack above shadows the browser's
    // history object inside this closure.
    //
    // Everything is written as repeated params (?city=A&city=B) rather than a joined
    // string, because company names and markets contain commas of their own.
    // "view" is written only for the Companies tab. "sponsorship" is no longer written
    // — the visa filter is gone — but stays listed so an old link's value is dropped
    // from the address bar rather than carried along as someone else's param.
    const OURS = ["q", "posted", "salary", "sort", "view", "sponsorship", "page", "unseen", "unopened"];
    let syncing = false;      // guard: applying a URL must not write one straight back
    let pushNext = false;     // set immediately before a navigation-like render

    function stateToUrl() {
      const p = new URLSearchParams();
      // Anything we don't own is passed through untouched — firm.html carries ?id=,
      // and track.js reads it off the URL to attribute clicks to the right investor.
      new URLSearchParams(location.search).forEach((v, k) => {
        if (!OURS.includes(k) && !DIMENSIONS.some((d) => d.key === k)) p.append(k, v);
      });
      DIMENSIONS.forEach((d) => state.selected[d.key].forEach((v) => p.append(d.key, v)));
      if (state.query) p.set("q", state.query);
      if (state.range !== "all") p.set("posted", state.range);
      if (state.salary !== "all") p.set("salary", state.salary);
      if (state.sort !== "newest") p.set("sort", state.sort);
      if (state.hideOpened) p.set("unseen", "1");
      if (state.hideOpenedCompanies) p.set("unopened", "1");
      if (state.view === "grouped") p.set("view", "grouped");
      if (state.page > 1) p.set("page", String(state.page));
      const qs = p.toString();
      return location.pathname + (qs ? "?" + qs : "") + location.hash;
    }

    function urlToState() {
      const p = new URLSearchParams(location.search);
      const selected = {};
      DIMENSIONS.forEach((d) => {
        const vals = p.getAll(d.key).filter(Boolean);
        if (vals.length) selected[d.key] = vals;
      });
      return {
        filters: {
          selected,
          query: p.get("q") || "",
          range: p.get("posted") || "all",
          salary: p.get("salary") || "all",
          sort: p.get("sort") || "newest",
          hideOpened: p.get("unseen") === "1",
          hideOpenedCompanies: p.get("unopened") === "1",
        },
        page: Math.max(1, Math.floor(Number(p.get("page"))) || 1),
        view: p.get("view") === "grouped" ? "grouped" : "flat",
      };
    }

    // True when the URL actually carries a view of ours, so a plain visit doesn't pay
    // for a second render just to apply an empty state.
    function urlHasState() {
      const p = new URLSearchParams(location.search);
      return OURS.some((k) => p.has(k)) || DIMENSIONS.some((d) => p.has(d.key));
    }

    function syncUrl() {
      if (syncing || !global.history || !global.history.replaceState) return;
      const url = stateToUrl();
      const snapshot = { page: state.page };
      if (pushNext) global.history.pushState(snapshot, "", url);
      else global.history.replaceState(snapshot, "", url);
      pushNext = false;
    }

    // Shared by the URL, the popstate handler and presets.js, so all three go through
    // the same resync of the selects.
    function applyFilterState(f) {
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
      state.hideOpened = !!f.hideOpened;
      state.hideOpenedCompanies = !!f.hideOpenedCompanies;
      if (el.search) el.search.value = state.query;
      if (el.dateSelect) el.dateSelect.value = state.range;
      if (el.salarySelect) el.salarySelect.value = state.salary;
      if (el.sortSelect) el.sortSelect.value = state.sort;
      if (el.hideOpened) el.hideOpened.checked = state.hideOpened;
      if (el.hideOpenedCompanies) el.hideOpenedCompanies.checked = state.hideOpenedCompanies;

      render();
    }

    // Captured before anything renders. The first render() replaceStates the current
    // (empty) state over the address bar, which would wipe the params of the very link
    // we were opened with before setJobs ever got to read them.
    const openedWith = urlHasState() ? urlToState() : null;

    // Back, Forward, and the first paint after a shared link is opened all land here.
    // `restoring` keeps it out of the undo stack — arriving somewhere via Back is not
    // a filter change to be undone — and `syncing` stops it echoing a URL back out.
    function applyUrl() {
      applyUrlState(urlToState());
    }

    function applyUrlState({ filters, page, view: tab }) {
      syncing = true;
      restoring = true;
      applyFilterState(filters);   // resets page to 1 by way of render()
      setView(tab);
      state.page = page;
      renderResults();             // clamps an out-of-range page against the real count
      restoring = false;
      syncing = false;
      previous = view.getFilters();
      updateUndoBtn();
      listeners.forEach((fn) => fn());
      syncUrl();                   // normalise, in case the page was clamped
      selectFirst();
    }

    function render() {
      state.page = 1;
      refreshAllPickers();
      renderResults();
      updateResetBtn();
      if (!restoring) recordHistory();
      syncUrl();
      listeners.forEach((fn) => fn());
      // A quarter second, so typing in the search box selects once it pauses, not per key.
      selectFirst(250);
    }

    // ---- events ----
    if (el.search) el.search.addEventListener("input", (e) => { state.query = e.target.value; render(); });
    if (el.sortSelect) el.sortSelect.addEventListener("change", (e) => { state.sort = e.target.value; render(); });
    if (el.hideOpened) {
      el.hideOpened.addEventListener("change", (e) => { state.hideOpened = e.target.checked; render(); });
    }
    if (el.hideOpenedCompanies) {
      el.hideOpenedCompanies.addEventListener("change", (e) => {
        state.hideOpenedCompanies = e.target.checked;
        render();
      });
    }
    if (el.pagination) {
      const scrollToResults = () => {
        const anchor = el.count ? el.count.parentElement : el.list;
        if (anchor && typeof anchor.scrollIntoView === "function") {
          anchor.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      };

      const goToPage = (page, focusNumber) => {
        state.page = page;
        pushNext = true; // paging is navigation: Back should return to the page you left
        renderResults();
        syncUrl();
        selectFirst();
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

    if (el.dateSelect) {
      el.dateSelect.innerHTML = DATE_RANGES.map((r) => `<option value="${r.k}">${escapeHtml(r.label)}</option>`).join("");
      // Assigned, not left to default: the setter is what repaints a select-menu.js picker.
      el.dateSelect.value = state.range;
      el.dateSelect.addEventListener("change", (e) => { state.range = e.target.value; render(); });
    }
    if (el.salarySelect) {
      el.salarySelect.innerHTML = SALARY_FLOORS.map((s) => `<option value="${s.k}">${escapeHtml(s.label)}</option>`).join("");
      el.salarySelect.value = state.salary;
      el.salarySelect.addEventListener("change", (e) => { state.salary = e.target.value; render(); });
    }
    if (el.resetBtn) {
      el.resetBtn.addEventListener("click", () => {
        DIMENSIONS.forEach((d) => state.selected[d.key].clear());
        state.range = "all"; state.salary = "all"; state.query = ""; state.hideOpened = false;
        state.hideOpenedCompanies = false;
        if (el.search) el.search.value = "";
        if (el.dateSelect) el.dateSelect.value = "all";
        if (el.salarySelect) el.salarySelect.value = "all";
        if (el.hideOpened) el.hideOpened.checked = false;
        if (el.hideOpenedCompanies) el.hideOpenedCompanies.checked = false;
        render();
      });
    }

    if (el.undoBtn) el.undoBtn.addEventListener("click", undo);

    let booted = false;

    const view = {
      setJobs(jobs) {
        state.jobs = jobs || [];
        render();
        // The first batch of data is the earliest point a URL can be honoured: the
        // pickers need real values to tick, and the page count needs real rows to
        // clamp against.
        if (!booted) {
          booted = true;
          if (openedWith) applyUrlState(openedWith);
          selectFirst();
        }
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
          hideOpened: state.hideOpened,
          hideOpenedCompanies: state.hideOpenedCompanies,
        };
      },

      applyFilters: applyFilterState,

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

    // Back and Forward. Wired after `view` exists because applyUrl reads getFilters()
    // off it to resync the undo stack's idea of "where we are now".
    global.addEventListener("popstate", () => {
      if (!booted) return; // data hasn't landed yet; setJobs will read the URL instead
      applyUrl();
    });

    // Wired here rather than from the pages so both get it automatically. presets.js
    // loads before them, so it is present by the time this runs.
    if (global.Presets && global.Presets.attach) global.Presets.attach(view);
    return view;
  }

  // refreshOpenedCounts is called by track.js the moment a click is recorded, so the
  // badge moves with the row it belongs to rather than on the next render.
  global.JobsUI = { createJobsView, escapeHtml, relativeDate, ROLE_LABELS, refreshOpenedCounts };
})(window);
