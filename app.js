(function () {
  "use strict";

  const TIER_ORDER = ["ai-mega", "generalist", "ai-native", "accelerator"];

  const state = {
    query: "",
    tier: "all",
    onlyBoard: false,
    onlyJobs: false,
    results: {},
  };

  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("empty-state");
  const resultCount = document.getElementById("result-count");
  const searchInput = document.getElementById("search");
  const tierFiltersEl = document.getElementById("tier-filters");
  const onlyBoardEl = document.getElementById("only-board");
  const statsEl = document.getElementById("stats");

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function buildTierFilters() {
    const counts = { all: VC_FIRMS.length };
    TIER_ORDER.forEach((t) => { counts[t] = VC_FIRMS.filter((f) => f.tier === t).length; });

    const chips = [{ key: "all", label: "All" }].concat(
      TIER_ORDER.map((t) => ({ key: t, label: TIER_META[t].short }))
    );

    tierFiltersEl.innerHTML = chips
      .map(
        (c) =>
          `<button class="chip${c.key === state.tier ? " active" : ""}" data-tier="${c.key}" aria-pressed="${c.key === state.tier}">${c.label}<span class="n">${counts[c.key]}</span></button>`
      )
      .join("");

    tierFiltersEl.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tier = btn.dataset.tier;
        render();
      });
    });
  }

  function buildStats() {
    const total = VC_FIRMS.length;
    const parts = [`${total} firms tracked`].concat(
      TIER_ORDER.map((t) => `${VC_FIRMS.filter((f) => f.tier === t).length} ${TIER_META[t].short.toLowerCase()}`)
    );
    statsEl.innerHTML = parts.map((p) => `<span>${escapeHtml(p)}</span>`).join("");
  }

  function signalDots(signal) {
    let dots = "";
    for (let i = 1; i <= 3; i++) {
      dots += `<i class="${i <= signal ? "on" : ""}" aria-hidden="true"></i>`;
    }
    return `<span class="signal" role="img" aria-label="AI investment signal: ${signal} of 3" title="AI investment signal: ${signal} of 3">${dots}</span>`;
  }

  function jobsBadge(firm) {
    if (!firm.id) return "";
    const r = state.results[firm.id];
    if (!r) return "";
    if (r.status === "unsupported") return `<span class="jobs-badge none" title="${escapeHtml(r.reason || "")}">no board</span>`;
    if (r.status === "error") return `<span class="jobs-badge err" title="${escapeHtml(r.reason || "")}">update failed</span>`;
    if (r.count === 0) return `<span class="jobs-badge zero">0 roles</span>`;
    return `<a class="jobs-badge has" href="firm.html?id=${encodeURIComponent(firm.id)}">${r.count} roles →</a>`;
  }

  function cardHtml(firm) {
    // Only firms we can actually show roles for get the whole-card link. Twenty-one
    // of thirty-seven have no scrapeable board; making those look clickable promised
    // a page that could only apologise.
    const r = (firm.id && state.results[firm.id]) || {};
    const openable = r.status === "ok" && r.count > 0;
    const shortBit = firm.short ? ` <span class="short">${escapeHtml(firm.short)}</span>` : "";
    const aumBit = firm.aum ? `<div class="card-aum">${escapeHtml(firm.aum)}</div>` : "";
    const noteBit = firm.note ? `<span class="signal-note">${escapeHtml(firm.note)}</span>` : "";

    let linkBit;
    if (firm.url && firm.noBoard) {
      linkBit = `<span class="no-board">${escapeHtml(firm.urlLabel)} &middot; <a href="${firm.url}" target="_blank" rel="noopener noreferrer">no public board, visit site ↗</a></span>`;
    } else if (firm.url) {
      linkBit = `<a class="joblink" href="${firm.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(firm.urlLabel)}</a>`;
    } else {
      linkBit = `<span class="no-link">no confirmed public link — search “${escapeHtml(firm.name)}” directly</span>`;
    }

    return `
      <article class="card${openable ? "" : " card-static"}" data-name="${escapeHtml(firm.name.toLowerCase())}"${openable ? ` data-href="firm.html?id=${encodeURIComponent(firm.id)}" tabindex="0" role="link" aria-label="${escapeHtml(firm.name)} — view ${r.count} roles"` : ""}>
        <div class="card-top">
          <div class="card-name-wrap">
            <p class="card-name">${escapeHtml(firm.name)}${shortBit}</p>
            ${aumBit}
          </div>
          <span class="tier-badge ${firm.tier}">${escapeHtml(TIER_META[firm.tier].short)}</span>
        </div>
        <p class="card-focus">${escapeHtml(firm.focus)}</p>
        <div class="card-signal">${signalDots(firm.signal)}${noteBit}</div>
        <div class="card-footer">${linkBit}${jobsBadge(firm)}</div>
      </article>
    `;
  }

  function filteredFirms() {
    const q = state.query.trim().toLowerCase();
    return VC_FIRMS.filter((f) => {
      if (state.tier !== "all" && f.tier !== state.tier) return false;
      if (state.onlyBoard && (!f.url || f.noBoard)) return false;
      if (state.onlyJobs) {
        const r = f.id && state.results[f.id];
        if (!r || r.status !== "ok" || r.count === 0) return false;
      }
      if (q && !f.name.toLowerCase().includes(q) && !(f.short || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function render() {
    buildTierFilters();
    const results = filteredFirms();

    resultCount.textContent = `Showing ${results.length} of ${VC_FIRMS.length} firms`;

    if (results.length === 0) {
      grid.innerHTML = "";
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;
    grid.innerHTML = results.map(cardHtml).join("");
  }

  // Whole-card navigation. Real links inside the card keep their own behaviour.
  function cardTarget(e) {
    if (e.target.closest("a")) return null;
    const card = e.target.closest(".card");
    return card && card.dataset.href ? card.dataset.href : null;
  }
  grid.addEventListener("click", (e) => {
    const href = cardTarget(e);
    if (href) location.href = href;
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.closest("a")) return;
    const card = e.target.closest(".card");
    if (!card || !card.dataset.href) return;
    e.preventDefault();
    location.href = card.dataset.href;
  });

  searchInput.addEventListener("input", (e) => {
    state.query = e.target.value;
    render();
  });
  onlyBoardEl.addEventListener("change", (e) => {
    state.onlyBoard = e.target.checked;
    render();
  });
  document.getElementById("only-jobs").addEventListener("change", (e) => {
    state.onlyJobs = e.target.checked;
    render();
  });

  function loadResults() {
    // Relative and .json — see the note in all.js.
    return fetch("api/results.json")
      .then((r) => r.json())
      .then((data) => {
        state.results = data.firms || {};
        render();
      })
      .catch(() => {});
  }

  buildStats();
  render();
  loadResults();

  // --- Theme toggle ---
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    const saved = localStorage.getItem("vc-directory-theme");
    if (saved === "dark" || saved === "light") document.documentElement.setAttribute("data-theme", saved);

    const currentTheme = () =>
      document.documentElement.getAttribute("data-theme") || "light";

    const updateThemeToggle = () => {
      const dark = currentTheme() === "dark";
      const label = `Switch to ${dark ? "light" : "dark"} mode`;
      themeToggle.setAttribute("aria-label", label);
      themeToggle.setAttribute("title", label);
      themeToggle.setAttribute("aria-pressed", String(dark));
    };

    updateThemeToggle();
    themeToggle.addEventListener("click", () => {
      const current = currentTheme();
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("vc-directory-theme", next);
      updateThemeToggle();
    });
  }
})();
