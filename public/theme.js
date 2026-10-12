// Light or dark, decided by the visitor's laptop unless they say otherwise.
//
// The default lives in styles.css, not here: a `prefers-color-scheme` media query
// paints the right theme before this file has even been fetched, so there is no flash
// of the wrong one. This file owns only the *override* — the toggle in the masthead —
// and the small amount of state that goes with it.
//
// The override is stored only while it disagrees with the OS. Toggling back into
// agreement clears it rather than pinning the same value, so a visitor who tries dark
// and then returns to light is following their system again, not stuck on a decision
// they made once. Without that, the first press of the button would opt them out of
// their own OS setting permanently.
//
// index.html, firm.html and firms.html each carry a two-line copy of the read in
// <head>, which is what applies a stored override before first paint. Everything else
// — the toggle, its labels, reacting to the OS flipping mid-visit — is here.
(function (global) {
  "use strict";

  var KEY = "vc-directory-theme";
  var root = document.documentElement;
  // matchMedia is absent in no browser we care about, but a stub keeps the rest of the
  // file free of guards if it ever is.
  var dark = global.matchMedia
    ? global.matchMedia("(prefers-color-scheme: dark)")
    : { matches: false, addEventListener: null, addListener: null };

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "dark" || v === "light" ? v : null;
    } catch (_) {
      return null; // private mode; the OS default still applies
    }
  }

  function system() {
    return dark.matches ? "dark" : "light";
  }

  // What the visitor is actually looking at, override or not.
  function effective() {
    return root.getAttribute("data-theme") || system();
  }

  function apply(theme) {
    if (theme === system()) {
      // Agreeing with the OS is expressed by having no opinion, so that a later change
      // to the OS setting carries the page with it.
      root.removeAttribute("data-theme");
      try { localStorage.removeItem(KEY); } catch (_) {}
    } else {
      root.setAttribute("data-theme", theme);
      try { localStorage.setItem(KEY, theme); } catch (_) {}
    }
  }

  var toggle = document.getElementById("theme-toggle");

  function paintToggle() {
    if (!toggle) return;
    var isDark = effective() === "dark";
    var label = "Switch to " + (isDark ? "light" : "dark") + " mode";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-pressed", String(isDark));
  }

  // The <head> snippet has already applied any stored override by now; this re-runs it
  // for the case where it is missing, and drops one that the OS has since caught up to.
  var saved = stored();
  if (saved) apply(saved);

  paintToggle();

  if (toggle) {
    toggle.addEventListener("click", function () {
      apply(effective() === "dark" ? "light" : "dark");
      paintToggle();
    });
  }

  // The OS can flip mid-visit — macOS does it at sunset on a schedule. With no override
  // the CSS reacts on its own and only the button's label needs correcting; with one,
  // this is the moment it may have become redundant.
  function onSystemChange() {
    var s = stored();
    if (s && s === system()) apply(s);
    paintToggle();
  }
  if (dark.addEventListener) dark.addEventListener("change", onSystemChange);
  else if (dark.addListener) dark.addListener(onSystemChange); // Safari < 14

  global.Theme = {
    current: effective,
    system: system,
    // null when following the OS, which is the default and the state the toggle
    // returns to rather than a value it can be set to.
    override: stored,
    set: function (theme) {
      if (theme !== "dark" && theme !== "light") return;
      apply(theme);
      paintToggle();
    },
    follow: function () {
      root.removeAttribute("data-theme");
      try { localStorage.removeItem(KEY); } catch (_) {}
      paintToggle();
    },
  };
})(window);
