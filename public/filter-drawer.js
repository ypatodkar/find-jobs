// The mobile filter drawer, shared by the all-jobs list and the per-firm pages.
//
// Above 720px this does nothing at all: the filters are an ordinary block in the
// page and every branch below is skipped. Under 720px the same markup becomes a
// modal sheet, which is a different enough thing that it needs real dialog
// behaviour — a focus trap, a scroll lock, and a way out that isn't hunting for a
// close button somewhere off-screen.
//
// all.js and firm.js each grew their own copy of this. They are byte-for-byte the
// same problem, so they now share one implementation and the pages only say which
// elements to wire together.
(function (global) {
  "use strict";

  var MOBILE = "(max-width: 720px)";

  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
    "summary, textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

  /** Visible focusable descendants, in tab order. */
  function tabbable(root) {
    var out = [];
    var all = root.querySelectorAll(FOCUSABLE);
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // offsetParent is null for anything display:none — including controls inside a
      // collapsed <details>, which must not be tab stops while they're folded away.
      if (el.offsetParent !== null) out.push(el);
    }
    return out;
  }

  function create(opts) {
    var controls = opts.controls;
    var toggle = opts.toggle;
    var backdrop = opts.backdrop;
    var closeBtn = opts.closeBtn || null;
    var applyBtn = opts.applyBtn || null;
    var countSource = opts.countSource || null;
    var titleId = opts.titleId || null;

    if (!controls || !toggle || !backdrop) return null;

    var mq = global.matchMedia(MOBILE);
    var isOpen = false;
    var savedScroll = 0;

    // ---- scroll lock -----------------------------------------------------------
    // `overflow: hidden` on <body> is ignored by iOS Safari once a touch scroll is
    // already in flight, so the page keeps moving under the drawer. Pinning the body
    // with position:fixed is the one approach that holds there — at the cost of
    // resetting scroll to the top, which is why the offset is saved and restored.
    function lockScroll() {
      savedScroll = global.scrollY || global.pageYOffset || 0;
      document.body.style.position = "fixed";
      document.body.style.top = -savedScroll + "px";
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
      document.body.classList.add("filter-drawer-open");
    }

    function unlockScroll() {
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      document.body.classList.remove("filter-drawer-open");
      // 'instant' so returning from the drawer doesn't animate the page back down.
      global.scrollTo({ top: savedScroll, behavior: "instant" });
    }

    // ---- open / close ----------------------------------------------------------
    function apply(open) {
      isOpen = mq.matches && open;
      var collapsed = mq.matches && !isOpen;

      controls.classList.toggle("mobile-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(isOpen));
      backdrop.hidden = !isOpen;

      if (mq.matches) {
        // Only a modal on mobile. On desktop these would be a lie: the filters are
        // just part of the page, and announcing a dialog would be wrong.
        controls.setAttribute("role", "dialog");
        controls.setAttribute("aria-modal", "true");
        if (titleId) controls.setAttribute("aria-labelledby", titleId);
      } else {
        controls.removeAttribute("role");
        controls.removeAttribute("aria-modal");
        controls.removeAttribute("aria-labelledby");
      }

      var n = activeCount();
      toggle.setAttribute("aria-label", (isOpen ? "Hide" : "Show") + " filters" + (n ? ", " + n + " active" : ""));
      syncCount();
    }

    function activeCount() {
      var m = String(toggle.textContent || "").match(/(\d+) active/);
      return m ? Number(m[1]) : 0;
    }

    function show() {
      if (!mq.matches || isOpen) return;
      lockScroll();
      apply(true);
      // Deliberately NOT the search box. Focusing a text input here summons the
      // keyboard the instant the drawer opens, which covers the filters the drawer
      // exists to show. The close button is a safe, non-typing first stop.
      var first = closeBtn || tabbable(controls)[0];
      if (first) global.requestAnimationFrame(function () { first.focus(); });
    }

    function hide(returnFocus) {
      if (!isOpen) return;
      apply(false);
      unlockScroll();
      if (returnFocus !== false) toggle.focus();
    }

    // ---- live result count -----------------------------------------------------
    // The footer button mirrors the count the results header already renders rather
    // than recomputing it, so the two can never disagree. Without this you filter
    // blind on mobile: the list is behind the drawer, and you only discover you cut
    // it to nothing after closing.
    function syncCount() {
      if (!applyBtn) return;
      var raw = countSource ? String(countSource.textContent || "").trim() : "";
      if (!raw) {
        applyBtn.textContent = "Show results";
        return;
      }
      var n = Number(raw.replace(/[^\d]/g, ""));
      if (raw === "0" || n === 0) applyBtn.textContent = "No matches — adjust filters";
      else applyBtn.textContent = "Show " + raw + (n === 1 ? " role" : " roles");
      applyBtn.classList.toggle("is-empty", n === 0);
    }

    // ---- wiring ----------------------------------------------------------------
    toggle.addEventListener("click", function () {
      if (!mq.matches) return;
      if (isOpen) hide();
      else show();
    });

    backdrop.addEventListener("click", function () { hide(); });
    if (closeBtn) closeBtn.addEventListener("click", function () { hide(); });
    if (applyBtn) applyBtn.addEventListener("click", function () { hide(); });

    document.addEventListener("keydown", function (e) {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }

      if (e.key !== "Tab") return;

      // Focus trap. Without it Tab walks straight out of a drawer that covers the
      // page, leaving the caret somewhere invisible behind the backdrop.
      var items = tabbable(controls);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!controls.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    });

    // Crossing the breakpoint — rotating the phone, or a resized desktop window —
    // must not strand the page with a locked body and no visible drawer.
    mq.addEventListener("change", function (e) {
      if (!e.matches && isOpen) {
        isOpen = false;
        unlockScroll();
      }
      if (!controls.hidden) apply(false);
    });

    return {
      /** Called once the data has landed and the filters are allowed to be shown. */
      reveal: function () {
        toggle.hidden = false;
        apply(false);
      },
      /** Called when the page hides the whole jobs UI (no results, error state). */
      teardown: function () {
        if (isOpen) unlockScroll();
        isOpen = false;
        backdrop.hidden = true;
        toggle.hidden = true;
      },
      syncCount: syncCount,
      close: hide,
      isOpen: function () { return isOpen; },
    };
  }

  global.FilterDrawer = { create: create };
})(window);
