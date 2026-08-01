// A heart you can give once.
//
// Hollow until tapped, filled and red forever after. Deliberately one-way: there is
// no unlike, because the point is a small gesture rather than a rating to manage.
//
// Remembered in localStorage so it survives reloads with no account, and reported to
// the worker against the same anonymous visitor id everything else uses — enough to
// count who liked the site, never who they are.
(function (global) {
  "use strict";

  var ENDPOINT = "https://vcjobs-clicks.ypatodkar.workers.dev";
  var KEY = "vc-directory-liked";
  var MOUNT_ID = "heart-slot";

  function liked() {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function remember() {
    try {
      localStorage.setItem(KEY, "1");
    } catch (_) {
      /* private mode — the heart still fills for this session */
    }
  }

  // Same path shape as track.js: fire-and-forget, and never allowed to break the UI.
  function report() {
    if (!ENDPOINT) return;
    var body = JSON.stringify({
      visitor_id: global.Visitor ? global.Visitor.id() : null,
      visitor_name: global.Visitor ? global.Visitor.name() : null,
    });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(ENDPOINT + "/like", body);
      else fetch(ENDPOINT + "/like", { method: "POST", body: body, keepalive: true });
    } catch (_) {
      /* the heart is already filled locally; the count can miss one */
    }
  }

  var HEART =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path d="M12 20.7 3.9 12.6a5.1 5.1 0 0 1 7.2-7.2l.9.9.9-.9a5.1 5.1 0 1 1 7.2 7.2z"/></svg>';

  function mount() {
    var el = document.getElementById(MOUNT_ID);
    if (el) return el;
    // Sits immediately before the name prompt, so the two small personal touches in
    // the header read as one group. Anchor must be a real child of its parent.
    var slot = document.getElementById("visitor-slot");
    if (!slot || !slot.parentNode) return null;
    el = document.createElement("div");
    el.id = MOUNT_ID;
    slot.parentNode.insertBefore(el, slot);
    return el;
  }

  function render() {
    var el = mount();
    if (!el) return;
    var on = liked();
    el.innerHTML =
      '<button type="button" class="heart' + (on ? " is-liked" : "") + '"' +
      (on ? ' aria-pressed="true" title="Thanks for the love"' : ' aria-pressed="false" title="Like this site"') +
      ' aria-label="' + (on ? "You liked this site" : "Like this site") + '">' +
      HEART + "</button>";

    if (on) return; // one-way: nothing left to listen for
    el.querySelector(".heart").addEventListener("click", function () {
      remember();
      report();
      render();
      var b = el.querySelector(".heart");
      if (b) b.classList.add("just-liked"); // one-off pop, see styles.css
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render);
  else render();

  global.Heart = { liked: liked };
})(window);
