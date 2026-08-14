// The featured startup at the top of the list.
//
// One small company a day, picked and written up by hand through the /feature slash
// command and stored in featured.json. This file only renders what it finds there.
//
// Deliberately quiet about failure, like counter.js: no featured.json, no `current`,
// or a stale one, and the block simply never appears. An empty highlight box is worse
// than no highlight box.
(function (global) {
  "use strict";

  var MOUNT_ID = "featured-slot";
  var DAY = 86400000;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * True once the feature is older than staleAfterDays.
   *
   * The point is the failure mode when the daily command stops being run: a month-old
   * "featured today" is a worse look than an empty masthead, so it expires itself
   * rather than sitting there going quietly out of date.
   */
  function stale(data) {
    var limit = Number(data.staleAfterDays || 0);
    if (!limit || !data.current || !data.current.featuredOn) return false;
    var when = new Date(data.current.featuredOn + "T00:00:00").getTime();
    if (!when) return false;
    return Date.now() - when > limit * DAY;
  }

  // Links into the list with the company filter already applied, so "see the roles"
  // lands on that company's openings rather than the top of an unfiltered list.
  function rolesHref(company) {
    return "index.html?company=" + encodeURIComponent(company);
  }

  function render(f) {
    var el = document.getElementById(MOUNT_ID);
    if (!el) return;

    var staff = f.staffCount ? esc(String(f.staffCount)) + " people" : null;
    var facts = [staff, f.stage ? esc(f.stage) : null, f.city ? esc(f.city) : null]
      .filter(Boolean)
      .join(" · ");

    var site = f.domain
      ? '<a class="featured-site" href="' + esc(/^https?:/.test(f.domain) ? f.domain : "https://" + f.domain) +
        '" target="_blank" rel="noopener noreferrer">' + esc(String(f.domain).replace(/^https?:\/\//, "")) + " ↗</a>"
      : "";

    var roles = f.roles
      ? '<a class="featured-roles" href="' + esc(rolesHref(f.company)) + '">' +
        esc(String(f.roles)) + " open role" + (f.roles === 1 ? "" : "s") + " →</a>"
      : "";

    el.innerHTML =
      '<aside class="featured" aria-labelledby="featured-heading">' +
      '<p class="featured-kicker" id="featured-heading">Startup of the day</p>' +
      '<div class="featured-body">' +
      '<h2 class="featured-name">' + esc(f.company) + "</h2>" +
      (facts ? '<p class="featured-facts">' + facts + "</p>" : "") +
      '<p class="featured-blurb">' + esc(f.blurb) + "</p>" +
      '<p class="featured-links">' + roles + site + "</p>" +
      "</div></aside>";
  }

  function load() {
    fetch("featured.json", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      // Outside the catch on purpose: a missing file is expected and silent, but a
      // rendering bug should reach the console rather than look like a missing file.
      .then(function (data) {
        if (!data || !data.current || !data.current.company || !data.current.blurb) return;
        if (stale(data)) return;
        render(data.current);
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})(window);
