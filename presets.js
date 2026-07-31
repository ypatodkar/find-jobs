// Saved filters.
//
// Stored in localStorage, and encodable into the URL so a saved slice is also a link
// you can send someone. Nothing here knows about accounts; when they arrive, signup
// POSTs Presets.exportAll() and login merges with importAll(), exactly as track.js
// does for click history.
//
// The view owns the filter state, so this file never touches it directly — it goes
// through view.getFilters() / view.applyFilters(), which resync the selects and view
// tabs as well as the results.
(function (global) {
  "use strict";

  var KEY = "vc-directory-filters";
  var MAX = 50;
  // A storage sanity limit, not a display one — the dropdown ellipsizes long names.
  var MAX_NAME = 80;

  // ---- storage ----------------------------------------------------------------
  var items = read();

  // Same convention as track.js: blank ENDPOINT means nothing is ever sent. Reports
  // which slices get saved — no identifier, and it can never block the save itself.
  var ENDPOINT = "https://vcjobs-clicks.ypatodkar.workers.dev";

  function report(action, name, filters) {
    if (!ENDPOINT || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon(
        ENDPOINT + "/filter",
        JSON.stringify({
          action: action,
          visitor_id: window.Visitor ? window.Visitor.id() : null,
          visitor_name: window.Visitor ? window.Visitor.name() : null,
          name: name || null,
          filters: filters || {},
          page: location.pathname.split("/").pop() || "index.html",
          firm: new URLSearchParams(location.search).get("id"),
        })
      );
    } catch (_) {
      /* analytics must never break saving a view */
    }
  }
  var persistent = true;

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(raw) ? raw.filter(valid) : [];
    } catch (_) {
      return [];
    }
  }

  function valid(p) {
    return p && typeof p === "object" && typeof p.id === "string" && p.filters && typeof p.filters === "object";
  }

  function write() {
    if (!persistent) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
    } catch (_) {
      persistent = false; // private mode / quota — keep working in memory
    }
  }

  function uid() {
    return "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---- url encoding -----------------------------------------------------------
  // base64url of the JSON. TextEncoder rather than raw btoa because company and
  // industry values are full of non-Latin1 characters that would throw.
  function encode(filters) {
    var bytes = new TextEncoder().encode(JSON.stringify(filters));
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decode(s) {
    try {
      var b = String(s).replace(/-/g, "+").replace(/_/g, "/");
      var bin = atob(b);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var out = JSON.parse(new TextDecoder().decode(bytes));
      return out && typeof out === "object" && out.selected ? out : null;
    } catch (_) {
      return null; // a mangled link should load the normal page, not an error
    }
  }

  // ---- naming -----------------------------------------------------------------
  // A suggestion only — it lands in a focused, pre-selected input, so typing over it
  // costs nothing and accepting it is one keypress.
  //
  // It names the preset after ONE thing rather than stitching every active filter
  // together. A joined name is both unreadable at chip width and worse at the only
  // job a name has: telling two saved filters apart at a glance.
  //
  // Priority is most-specific-first. What someone typed is the strongest signal of
  // intent, then who they're looking at, then what the role is, then where.
  var NAME_ORDER = ["company", "firm", "role", "seniority", "industry", "city", "size", "stage"];

  function describe(view, filters) {
    var sel = filters.selected || {};

    // 1. Whatever is in the search box wins outright. Read from the filters being
    //    named, so renaming a saved preset uses that preset's search, not whatever
    //    happens to be typed right now.
    var q = (filters.query || (view.state && view.state.query) || "").trim();
    if (q) return clip(q);

    // 2..n. The first dimension that has a selection, in priority order.
    for (var i = 0; i < NAME_ORDER.length; i++) {
      var key = NAME_ORDER[i];
      var vals = sel[key];
      if (!vals || !vals.length) continue;
      var first = view.labelFor(key, vals[0]);
      return clip(vals.length > 1 ? first + " +" + (vals.length - 1) : first);
    }

    // Nothing categorical selected — fall back to the numeric filters, then describe
    // the view/sort and firm context so saved filters do not all become "All roles."
    if (filters.salary && filters.salary !== "all") return clip(view.salaryLabel(filters.salary));
    if (filters.range && filters.range !== "all") return clip(view.rangeLabel(filters.range));
    var mode = "";
    if (filters.view === "grouped" && filters.sort === "count") mode = "Most roles by company";
    else if (filters.view === "grouped") mode = "By company";
    else if (filters.sort === "count") mode = "Most roles";
    else if (filters.sort === "company") mode = "Company A–Z";
    else if (filters.sort === "title") mode = "Title A–Z";
    else if (filters.sort === "salary") mode = "Highest salary";
    else if (filters.sort === "oldest") mode = "Oldest roles";

    var context = view.contextLabel ? String(view.contextLabel).trim() : "";
    if (context && mode) return clip(context + " · " + mode);
    if (context) return clip(context + " roles");
    return mode || "All roles";
  }

  function clip(s) {
    s = String(s || "");
    return s.length > MAX_NAME ? s.slice(0, MAX_NAME - 1) + "…" : s;
  }

  // Deep-ish equality, enough to tell whether a saved preset is the one on screen.
  function same(a, b) {
    if (!a || !b) return false;
    if ((a.query || "").trim() !== (b.query || "").trim()) return false;
    if (a.range !== b.range || a.salary !== b.salary || a.sort !== b.sort || a.view !== b.view) return false;
    var ka = Object.keys(a.selected || {}).filter(function (k) { return (a.selected[k] || []).length; });
    var kb = Object.keys(b.selected || {}).filter(function (k) { return (b.selected[k] || []).length; });
    if (ka.length !== kb.length) return false;
    return ka.every(function (k) {
      var x = (a.selected[k] || []).slice().sort();
      var y = (b.selected[k] || []).slice().sort();
      return x.length === y.length && x.every(function (v, i) { return v === y[i]; });
    });
  }

  // ---- api --------------------------------------------------------------------
  var api = {
    all: function () { return items.slice(); },
    count: function () { return items.length; },
    get: function (id) { return items.filter(function (p) { return p.id === id; })[0] || null; },

    save: function (name, filters) {
      var p = { id: uid(), name: String(name || "").slice(0, MAX_NAME) || "Saved filter", filters: filters, createdAt: Date.now() };
      items.push(p);
      if (items.length > MAX) items = items.slice(items.length - MAX);
      write();
      report("save", p.name, filters);
      return p;
    },

    rename: function (id, name) {
      var p = api.get(id);
      if (!p) return false;
      p.name = String(name || "").slice(0, MAX_NAME) || p.name;
      write();
      return true;
    },

    remove: function (id) {
      var n = items.length;
      items = items.filter(function (p) { return p.id !== id; });
      if (items.length !== n) write();
      return items.length !== n;
    },

    linkFor: function (filters) {
      var url = new URL(location.href);
      url.searchParams.set("f", encode(filters));
      url.hash = "";
      return url.toString();
    },

    // --- seams for the database layer, mirroring track.js ---
    exportAll: function () { return JSON.parse(JSON.stringify(items)); },
    importAll: function (list) {
      if (!Array.isArray(list)) return 0;
      var seen = {};
      items.forEach(function (p) { seen[p.id] = true; });
      var added = 0;
      list.filter(valid).forEach(function (p) {
        if (seen[p.id]) return;
        items.push(p);
        seen[p.id] = true;
        added++;
      });
      items.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
      if (items.length > MAX) items = items.slice(items.length - MAX);
      write();
      return added;
    },
    clear: function () { items = []; write(); },

    encode: encode,
    decode: decode,
    describe: describe,
    same: same,
  };

  global.Presets = api;

  // ---- ui ---------------------------------------------------------------------
  // attach() is called by the pages once the view exists. Everything above works
  // without a DOM, which is what the tests exercise.
  api.attach = function (view) {
    var host = document.getElementById("job-controls");
    if (!host || !view || !view.getFilters) return;

    injectCss();

    var bar = document.createElement("div");
    bar.className = "preset-bar";
    bar.id = "preset-bar";
    // Saved filters are a reusable starting point, so keep them above search and
    // the rest of the controls rather than presenting them as an afterthought.
    host.insertBefore(bar, host.firstChild);

    // null = not editing. { id: null } = naming a new one, { id: "f…" } = renaming.
    var editing = null;

    var PENCIL =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';

    var BOOKMARK =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>';

    var menuOpen = false;

    function render() {
      var current = view.getFilters();
      var activeId = null;
      items.forEach(function (p) { if (!activeId && same(p.filters, current)) activeId = p.id; });

      // Naming a brand-new preset takes over the whole bar: there is nothing else to
      // do at that moment, and the saved list is one keypress away again.
      if (editing && editing.id === null) {
        bar.innerHTML = nameForm(describe(view, current));
        focusInput();
        return;
      }

      // The dropdown is used from the very first saved view rather than starting as a
      // chip and switching at two: one control that never changes shape is easier to
      // learn than one that rearranges itself as the list grows.
      var list = items.length
        ? '<span class="preset-label">Saved filters:</span>' + menu(activeId)
        : "";

      bar.innerHTML = list + saveBtn();
      if (editing) focusInput();
    }

    function saveBtn() {
      return (
        '<button type="button" class="preset-save" id="preset-save" title="Save the current filters">' +
        BOOKMARK +
        "<span>Save this filter</span></button>"
      );
    }

    // Mirrors the <details> pattern the dimension pickers already use, so it behaves
    // like the rest of the filter bar rather than inventing a second kind of menu.
    function menu(activeId) {
      var active = activeId ? api.get(activeId) : null;
      var rows = items.map(function (p) {
        if (editing && editing.id === p.id) return '<div class="preset-row is-editing">' + nameForm(p.name) + "</div>";
        var isActive = p.id === activeId;
        return (
          '<div class="preset-row' + (isActive ? " is-active" : "") + '">' +
          '<button type="button" class="preset-apply" data-id="' + esc(p.id) + '" title="Apply these filters">' +
          esc(p.name) + "</button>" +
          '<button type="button" class="preset-edit" data-id="' + esc(p.id) + '" title="Rename" aria-label="Rename ' + esc(p.name) + '">' + PENCIL + "</button>" +
          '<button type="button" class="preset-del" data-id="' + esc(p.id) + '" title="Remove" aria-label="Remove ' + esc(p.name) + '">×</button>' +
          "</div>"
        );
      }).join("");

      // Structured and classed like .company-picker so it reads as one of the filter
      // dropdowns rather than a bespoke control: same caret, same open/selected states.
      return (
        '<details class="preset-picker' + (active ? " has-selection" : "") + '"' +
        (menuOpen ? " open" : "") + ' id="preset-picker">' +
        "<summary>" +
        "<span class=\"preset-current\">" + (active ? esc(active.name) : "Choose one") + "</span>" +
        '<span class="preset-n">' + items.length + "</span>" +
        "</summary>" +
        '<div class="preset-menu">' + rows + "</div>" +
        "</details>"
      );
    }

    function nameForm(value) {
      return (
        '<span class="preset-naming">' +
        '<input type="text" id="preset-name" class="preset-name" maxlength="' + MAX_NAME + '" ' +
        'placeholder="Name this filter" aria-label="Name this filter" value="' + esc(value) + '" />' +
        '<button type="button" class="preset-confirm" id="preset-confirm">Save</button>' +
        '<button type="button" class="preset-cancel" id="preset-cancel" title="Cancel" aria-label="Cancel">×</button>' +
        "</span>"
      );
    }

    // The suggested name arrives focused and selected: one keypress to accept, zero
    // extra clicks to replace.
    function focusInput() {
      var input = document.getElementById("preset-name");
      if (input) { input.focus(); input.select(); }
    }

    function commit() {
      var input = document.getElementById("preset-name");
      var v = input ? input.value.trim() : "";
      if (!v) { if (input) input.focus(); return; } // never save a blank label
      if (editing.id) api.rename(editing.id, v);
      else api.save(v, view.getFilters());
      editing = null;
      render();
    }

    bar.addEventListener("click", function (e) {
      // closest(), not e.target: the save button and the menu summary both contain an
      // SVG, and a click landing on the icon has the <path> as its target.
      var t = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!t) return;

      if (t.id === "preset-save") { editing = { id: null }; render(); return; }
      if (t.id === "preset-confirm") { commit(); return; }
      if (t.id === "preset-cancel") { editing = null; render(); return; }

      var id = t.getAttribute("data-id");
      if (!id) return;
      var p = api.get(id);
      if (!p) return;

      if (t.classList.contains("preset-apply")) {
        menuOpen = false; // a choice was made; get the menu out of the way
        view.applyFilters(p.filters); // fires onChange -> render()
      } else if (t.classList.contains("preset-edit")) {
        editing = { id: id };
        menuOpen = true; // the input replaces this row in place
        render();
      } else if (t.classList.contains("preset-del")) {
        api.remove(id);
        if (editing && editing.id === id) editing = null;
        menuOpen = items.length > 1;
        render();
      }
    });

    // Remember the disclosure state across the re-renders that every filter change
    // triggers, or the menu would snap shut under the cursor.
    bar.addEventListener("toggle", function (e) {
      if (e.target && e.target.id === "preset-picker") menuOpen = e.target.open;
    }, true);

    document.addEventListener("click", function (e) {
      if (!menuOpen || editing) return;
      var picker = document.getElementById("preset-picker");
      if (picker && !picker.contains(e.target)) { menuOpen = false; picker.open = false; }
    });

    bar.addEventListener("keydown", function (e) {
      if (!editing) return;
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      else if (e.key === "Escape") { e.preventDefault(); editing = null; render(); }
    });

    view.onChange(function () { if (!editing) render(); }); // never yank the input away mid-type
    render();

    // A ?f= link wins over whatever the page would otherwise default to.
    var shared = new URLSearchParams(location.search).get("f");
    if (shared) {
      var f = decode(shared);
      if (f) view.applyFilters(f);
    }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function injectCss() {
    if (document.querySelector("[data-preset-styles]")) return;
    var css =
      ".preset-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;width:100%;margin-bottom:12px}" +
      ".preset-label{font:600 11px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}" +

      // Save is a deliberate action rather than another filter, so it is filled.
      ".preset-save{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--accent);" +
      "border-radius:5px;background:var(--accent-fill);color:var(--accent);" +
      "font:600 12px/1 var(--sans);padding:7px 11px;cursor:pointer}" +
      ".preset-save:hover{background:var(--accent);color:var(--bg)}" +
      ".preset-save svg{flex:none}" +

      ".preset-apply:hover{color:var(--accent)}" +
      ".preset-edit,.preset-del{color:var(--ink-faint);padding:7px 6px}" +
      ".preset-edit:hover,.preset-del:hover{color:var(--accent)}" +

      // Deliberately a value-for-value copy of .company-picker's summary, caret
      // included, so this sits in the filter bar as another dropdown rather than as
      // something that merely behaves like one.
      ".preset-picker{position:relative}" +
      ".preset-picker>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:10px;" +
      "font-family:var(--sans);font-size:0.82rem;color:var(--ink);background:var(--surface);" +
      "border:1px solid var(--rule);border-radius:5px;padding:6px 10px;min-width:116px;" +
      "white-space:nowrap;user-select:none}" +
      ".preset-picker>summary::-webkit-details-marker{display:none}" +
      ".preset-picker>summary::after{content:'▾';margin-left:auto;color:var(--ink-faint);font-size:0.85em}" +
      ".preset-picker>summary:hover{border-color:var(--rule-strong)}" +
      ".preset-picker>summary:focus-visible{outline:2px solid var(--accent2);outline-offset:1px}" +
      ".preset-picker[open]>summary{border-color:var(--accent2)}" +
      ".preset-picker.has-selection>summary{background:var(--accent-fill);color:var(--accent);" +
      "border-color:var(--accent);font-weight:500}" +
      ".preset-picker.has-selection>summary::after{color:var(--accent)}" +
      ".preset-current{max-width:20ch;overflow:hidden;text-overflow:ellipsis}" +
      ".preset-n{font-size:0.72rem;color:var(--ink-faint)}" +
      ".preset-picker.has-selection .preset-n{color:var(--accent)}" +

      ".preset-menu{position:absolute;z-index:5;top:calc(100% + 6px);left:0;min-width:250px;max-height:320px;" +
      "overflow:auto;border:1px solid var(--rule);border-radius:8px;background:var(--surface);" +
      "box-shadow:var(--shadow);padding:4px}" +
      ".preset-row{display:flex;align-items:center;gap:2px;border-radius:5px}" +
      ".preset-row:hover{background:var(--chip-bg)}" +
      ".preset-row.is-active{background:var(--accent-fill)}" +
      ".preset-row.is-editing{padding:4px}" +
      ".preset-row button{border:0;background:none;cursor:pointer;color:inherit;font:inherit;padding:7px 8px;line-height:1.2}" +
      ".preset-row .preset-apply{flex:1;text-align:left;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".preset-row.is-active .preset-apply{color:var(--accent);font-weight:500}" +
      ".preset-edit{display:inline-flex;align-items:center}" +

      ".preset-naming{display:inline-flex;gap:6px;align-items:center}" +
      ".preset-name{border:1px solid var(--accent);border-radius:5px;background:var(--surface);" +
      "color:var(--ink);font:400 13px/1 var(--sans);padding:7px 8px;min-width:20ch;flex:1}" +
      ".preset-confirm,.preset-cancel{border:1px solid var(--rule);border-radius:5px;background:var(--chip-bg);" +
      "color:var(--ink-soft);font:600 12px/1 var(--sans);padding:7px 10px;cursor:pointer}" +
      ".preset-confirm:hover{color:var(--accent);border-color:var(--accent)}";
    var el = document.createElement("style");
    el.setAttribute("data-preset-styles", "");
    el.textContent = css;
    document.head.appendChild(el);
  }
})(window);
