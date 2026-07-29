(function () {
  "use strict";

  const TIER_ORDER = ["ai-mega", "generalist", "ai-native", "accelerator"];

  const state = {
    query: "",
    tier: "all",
    onlyBoard: false,
    onlyList: false,
    onlyJobs: false,
    results: {},
    scrapedAt: null,
  };

  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("empty-state");
  const resultCount = document.getElementById("result-count");
  const searchInput = document.getElementById("search");
  const tierFiltersEl = document.getElementById("tier-filters");
  const onlyBoardEl = document.getElementById("only-board");
  const onlyListEl = document.getElementById("only-list");
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
      dots += `<i class="${i <= signal ? "on" : ""}"></i>`;
    }
    return `<span class="signal">${dots}</span>`;
  }

  function jobsBadge(firm) {
    if (!firm.id) return "";
    const r = state.results[firm.id];
    if (!r) return "";
    if (r.status === "unsupported") return `<span class="jobs-badge none" title="${escapeHtml(r.reason || "")}">no board</span>`;
    if (r.status === "error") return `<span class="jobs-badge err" title="${escapeHtml(r.reason || "")}">scrape failed</span>`;
    if (r.count === 0) return `<span class="jobs-badge zero">0 roles</span>`;
    return `<a class="jobs-badge has" href="firm.html?id=${encodeURIComponent(firm.id)}">${r.count} roles →</a>`;
  }

  function cardHtml(firm) {
    const shortBit = firm.short ? ` <span class="short">${escapeHtml(firm.short)}</span>` : "";
    const aumBit = firm.aum ? `<div class="card-aum">${escapeHtml(firm.aum)}</div>` : "";
    const tagBit = firm.inList ? `<span class="card-tag">in your list</span>` : "";
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
      <article class="card" data-name="${escapeHtml(firm.name.toLowerCase())}" data-href="firm.html?id=${encodeURIComponent(firm.id)}" tabindex="0" role="link" aria-label="${escapeHtml(firm.name)} — view roles">
        <div class="card-top">
          <div class="card-name-wrap">
            <p class="card-name">${escapeHtml(firm.name)}${shortBit}</p>
            ${aumBit}
          </div>
          <span class="tier-badge ${firm.tier}">${escapeHtml(TIER_META[firm.tier].short)}</span>
        </div>
        <p class="card-focus">${escapeHtml(firm.focus)}</p>
        <div class="card-signal">${signalDots(firm.signal)}${noteBit}</div>
        ${tagBit}
        <div class="card-footer">${linkBit}${jobsBadge(firm)}</div>
      </article>
    `;
  }

  function filteredFirms() {
    const q = state.query.trim().toLowerCase();
    return VC_FIRMS.filter((f) => {
      if (state.tier !== "all" && f.tier !== state.tier) return false;
      if (state.onlyBoard && (!f.url || f.noBoard)) return false;
      if (state.onlyList && !f.inList) return false;
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
  onlyListEl.addEventListener("change", (e) => {
    state.onlyList = e.target.checked;
    render();
  });
  document.getElementById("only-jobs").addEventListener("change", (e) => {
    state.onlyJobs = e.target.checked;
    render();
  });

  // --- Scraped job results ---
  const refreshBtn = document.getElementById("refresh-btn");
  const refreshStatus = document.getElementById("refresh-status");

  const firmName = (id) => (VC_FIRMS.find((f) => f.id === id) || {}).name || id;

  function totalRoles() {
    return Object.values(state.results).reduce((n, r) => n + (r.status === "ok" ? r.count : 0), 0);
  }

  function updateStatus() {
    if (!state.scrapedAt) {
      refreshStatus.textContent = "No job data yet — hit refresh to scrape all boards.";
      return;
    }
    const when = new Date(state.scrapedAt).toLocaleString();
    refreshStatus.textContent = `${totalRoles()} roles across ${Object.values(state.results).filter((r) => r.status === "ok" && r.count > 0).length} firms · last scraped ${when}`;
  }

  // Scrape trigger + progress bar live in refresh.js, shared with the home page.
  const refresh = RefreshUI.initRefresh({
    firmName,
    onDone: (d) => {
      state.results = d.firms || {};
      state.scrapedAt = d.scrapedAt;
      updateStatus();
      render();
    },
  });

  function loadResults() {
    // Relative and .json — see the note in all.js.
    return fetch("api/results.json")
      .then((r) => r.json())
      .then((data) => {
        // No server to scrape on demand once deployed.
        if (data.static && refresh) refresh.hide("Refreshed automatically every 6 hours");
        state.results = data.firms || {};
        state.scrapedAt = data.scrapedAt;
        updateStatus();
        render();
      })
      .catch(() => {
        refreshStatus.textContent = "No job data — run `node scrape.js` to populate it.";
        refreshBtn.disabled = true;
      });
  }

  buildStats();
  render();
  loadResults();
})();
