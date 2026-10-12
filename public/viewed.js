// "Companies you've opened" — a roll-up of your own click history.
//
// Reads the same localStorage store track.js writes (job ids you've opened) and joins
// it against the job list the page already loaded, so it needs no network call and
// works signed-out. Nothing here is sent anywhere; this is your history shown back
// to you.
(function (global) {
  "use strict";

  var MOUNT_ID = "viewed-slot";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // [{company, roles:[{title, city, ts}], last}] sorted by most recently opened.
  function opened() {
    var jobs = (global.JobsData && global.JobsData.all()) || [];
    var seen = global.Seen;
    if (!seen || !jobs.length) return [];

    var byCompany = {};
    jobs.forEach(function (j) {
      if (!j.job_id || !seen.has(j.job_id)) return;
      var c = j.company || "Unknown";
      if (!byCompany[c]) byCompany[c] = { company: c, roles: [], last: 0 };
      var ts = seen.at ? seen.at(j.job_id) : 0;
      byCompany[c].roles.push({ title: j.title, city: j.city, url: j.url, ts: ts });
      if (ts > byCompany[c].last) byCompany[c].last = ts;
    });

    return Object.keys(byCompany)
      .map(function (k) { return byCompany[k]; })
      .sort(function (a, b) { return b.last - a.last || b.roles.length - a.roles.length; });
  }

  function when(ts) {
    if (!ts) return "";
    var d = Math.floor((Date.now() - ts) / 86400000);
    if (d <= 0) return "today";
    if (d === 1) return "yesterday";
    if (d < 30) return d + " days ago";
    var m = Math.floor(d / 30);
    return m === 1 ? "1 month ago" : m + " months ago";
  }

  /**
   * A role in the panel, linked straight back to the posting.
   *
   * Deliberately not `a.job-title[data-job-id]`, which is what track.js listens for:
   * every role in here has been opened already, so re-counting it would inflate the
   * click total with a visit to your own history, and the "clicked" stamp styling is
   * written for the job rows, not for this panel.
   *
   * A role with no url — a board listing that never carried one — stays plain text
   * rather than becoming a link to nowhere.
   */
  function role(r) {
    if (!r.url) return esc(r.title);
    return '<a class="viewed-link" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' +
      esc(r.title) + "</a>";
  }

  var open = false;

  function render() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;

    var list = opened();
    var roles = list.reduce(function (n, c) { return n + c.roles.length; }, 0);

    if (!list.length) {
      // Nothing opened yet — no button, rather than a button that opens an empty box.
      mount.innerHTML = "";
      return;
    }

    mount.innerHTML =
      '<button type="button" class="viewed-btn" aria-expanded="' + open + '">' +
      "Companies you've opened" +
      '<span class="viewed-n">' + list.length + "</span>" +
      '<svg class="viewed-chev" width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">' +
      '<path d="M3 4.5 L6 7.5 L9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      (open
        ? '<div class="viewed-panel">' +
          '<p class="viewed-sum">' + roles + " role" + (roles === 1 ? "" : "s") +
          " across " + list.length + " compan" + (list.length === 1 ? "y" : "ies") + "</p>" +
          list
            .map(function (c) {
              return (
                '<div class="viewed-row">' +
                '<span class="viewed-co">' + esc(c.company) + "</span>" +
                '<span class="viewed-roles">' +
                c.roles.slice(0, 4).map(role).join(" · ") +
                (c.roles.length > 4 ? " · +" + (c.roles.length - 4) + " more" : "") +
                "</span>" +
                '<span class="viewed-when">' + esc(when(c.last)) + "</span>" +
                "</div>"
              );
            })
            .join("") +
          "</div>"
        : "");

    mount.querySelector(".viewed-btn").addEventListener("click", function () {
      open = !open;
      render();
      if (open) {
        var p = mount.querySelector(".viewed-panel");
        if (p) p.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  }

  // The list re-renders whenever the page marks a new row seen, so the count stays
  // honest without this file knowing anything about the render path.
  function schedule() {
    if (document.getElementById(MOUNT_ID)) render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", schedule);
  else schedule();

  global.Viewed = { refresh: schedule };
})(window);
