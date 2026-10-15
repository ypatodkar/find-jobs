// Who's looking, in the lightest way possible.
//
// A UUID the browser mints for itself, and a first name only if Google sign-in supplies
// one (or one was typed when the site still asked). No email, no password, no IP —
// enough to group one browser's clicks together, and nothing more. The page shows none
// of it: the header greeting and name prompt are gone.
//
// track.js and presets.js read Visitor.id()/name() and attach them to the events they
// already send, so this file owns identity and they own reporting.
(function (global) {
  "use strict";

  var KEY = "vc-directory-visitor";
  var MAX_NAME = 32;

  // { id, name, asked } — `asked` records that we've shown the prompt once, so a
  // skip is remembered and we never nag on the next page load.
  var me = read();

  function read() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && typeof raw === "object" && typeof raw.id === "string") return raw;
    } catch (_) {}
    return null;
  }

  function write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(me));
    } catch (_) {
      /* private mode — the id still works for this session */
    }
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    // Old-Safari fallback; the worker validates the shape either way.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  function ensure() {
    if (!me) {
      me = { id: uuid(), name: null, asked: false };
      write();
    }
    return me;
  }

  function clean(v) {
    return String(v || "").trim().replace(/\s+/g, " ").slice(0, MAX_NAME);
  }

  function init() {
    ensure();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ---- api, read by track.js and presets.js -----------------------------------
  global.Visitor = {
    id: function () { return ensure().id; },
    name: function () { return (me && me.name) || null; },
    // Signing in with Google supplies a first name. One already held is never replaced.
    adopt: function (name) {
      ensure();
      var v = clean(String(name || "").split(/\s+/)[0]);
      if (me.name || !v) return;
      me.name = v;
      me.asked = true;
      write();
    },
    forget: function () {
      try { localStorage.removeItem(KEY); } catch (_) {}
      me = null;
      ensure();
    },
  };
})(window);
