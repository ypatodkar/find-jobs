// Account layer: GitHub/Google sign-in via the Worker in worker/index.js, session held
// in an httpOnly cookie (never touched directly by this file — every call below rides
// on `credentials: "include"` and lets the browser handle it).
//
// Deliberately a thin layer over track.js's Seen store rather than a replacement for
// it: signed out, the site behaves exactly as it did before this file existed. Signed
// in, every page load does a two-way sync — POST the browser's local map, then GET the
// server's and merge it back in (see track.js's exportAll/importAll) — so "opened"
// status follows the account across devices instead of staying per-browser.
//
// Off entirely if ENDPOINT is unset, same convention as track.js. Keep the two in sync
// — they must point at the same Worker.
(function (global) {
  "use strict";

  var ENDPOINT = ""; // e.g. "https://vcjobs-clicks.<subdomain>.workers.dev" or a custom domain

  var MOUNT_ID = "account-slot";
  var user = null;

  function api(path, opts) {
    return fetch(ENDPOINT + path, Object.assign({ credentials: "include" }, opts || {}));
  }

  function currentPath() {
    return location.pathname + location.search;
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text) e.textContent = text;
    return e;
  }

  function signOut() {
    api("/auth/logout", { method: "POST" }).finally(function () {
      user = null;
      render();
    });
  }

  function render() {
    var mount = document.getElementById(MOUNT_ID);
    if (!mount) return;
    mount.innerHTML = "";

    var menu = el("details", { class: "account-menu" });
    var summary = el("summary", {});
    var panel = el("div", { class: "account-panel" });

    if (user) {
      if (user.avatarUrl) summary.appendChild(el("img", { class: "account-avatar", src: user.avatarUrl, alt: "" }));
      summary.appendChild(document.createTextNode(user.name || "Account"));
      var signOutBtn = el("button", { type: "button", class: "linkish" }, "Sign out");
      signOutBtn.addEventListener("click", function (e) {
        e.preventDefault();
        menu.removeAttribute("open");
        signOut();
      });
      panel.appendChild(signOutBtn);
    } else {
      summary.appendChild(document.createTextNode("Sign in"));
      [
        ["github", "Continue with GitHub"],
        ["google", "Continue with Google"],
      ].forEach(function (pair) {
        panel.appendChild(
          el(
            "a",
            { class: "account-provider", href: ENDPOINT + "/auth/" + pair[0] + "/start?return_to=" + encodeURIComponent(currentPath()) },
            pair[1]
          )
        );
      });
    }

    menu.appendChild(summary);
    menu.appendChild(panel);
    mount.appendChild(menu);
  }

  // Bidirectional merge with the server's copy. Both sides use "oldest timestamp
  // wins, never drop an entry", so running this every load — not just at signup — is
  // safe and keeps two open devices converging rather than fighting over one row.
  function syncSeen() {
    if (!global.Seen) return;
    api("/auth/seen", {
      method: "POST",
      headers: { "content-type": "text/plain" }, // CORS-simple: no preflight for the export half
      body: JSON.stringify(global.Seen.exportAll()),
    })
      .then(function () { return api("/auth/seen"); })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (serverMap) { if (serverMap) global.Seen.importAll(serverMap); })
      .catch(function () { /* sync is best-effort — local history still works offline */ });
  }

  function init() {
    if (!ENDPOINT || !document.getElementById(MOUNT_ID)) return;
    api("/auth/me")
      .then(function (res) { return res.ok ? res.json() : { user: null }; })
      .then(function (body) {
        user = body.user;
        render();
        if (user) syncSeen();
      })
      .catch(function () { /* stay signed-out in the UI; nothing else depends on this */ });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window);
