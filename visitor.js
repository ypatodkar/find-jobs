// Who's looking, in the lightest way possible.
//
// A UUID the browser mints for itself, plus an optional first name typed on the first
// visit. No email, no password, no IP — enough to group one browser's clicks together
// and say hello, and nothing more. Skipping is a first-class outcome: the id still
// works, the greeting just stays generic.
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

  // ---- ui ---------------------------------------------------------------------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function slot() {
    var el = document.getElementById("visitor-slot");
    if (el) return el;
    // Fall back to creating one, so a page that forgot the div still works.
    var top = document.querySelector(".masthead-top");
    if (!top) return null;
    el = document.createElement("div");
    el.id = "visitor-slot";
    top.insertBefore(el, top.firstChild);
    return el;
  }

  function renderGreeting() {
    var el = slot();
    if (!el) return;
    var label = me && me.name ? "Hello, " + esc(me.name) : "Your profile";
    el.innerHTML =
      '<span class="visitor-greet">' +
      label +
      ' <button type="button" class="visitor-edit" aria-label="Change your name">' +
      (me && me.name ? "Edit name" : "Add name") +
      "</button></span>";
    el.querySelector(".visitor-edit").addEventListener("click", function () {
      renderPrompt(true);
    });
  }

  function homeFor(isPrompt) {
    // On the jobs page the profile editor belongs inside settings. Older catalogue
    // pages retain their existing first-visit prompt until they use the same shell.
    var el = document.getElementById("visitor-slot");
    var onboard = document.getElementById("onboard-slot");
    if (isPrompt && !document.getElementById("settings-popover") && onboard && el && el.parentNode !== onboard) onboard.appendChild(el);
    return el;
  }

  function renderPrompt(isEdit) {
    homeFor(true);
    var el = slot();
    if (!el) return;
    el.innerHTML =
      '<form class="visitor-ask" novalidate>' +
      '<label class="visitor-ask-label" for="visitor-name">' +
      (isEdit ? "What should we call you?" : "Hi, what should we call you?") +
      "</label>" +
      '<input id="visitor-name" class="visitor-input" type="text" maxlength="' + MAX_NAME +
      '" autocomplete="given-name" placeholder="Your name" value="' + esc((me && me.name) || "") + '" />' +
      '<button type="submit" class="visitor-save">Save name</button>' +
      '<button type="button" class="visitor-skip">' + (isEdit ? "Cancel" : "Skip") + "</button>" +
      "</form>";

    var form = el.querySelector(".visitor-ask");
    var input = el.querySelector(".visitor-input");
    input.focus();

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = clean(input.value);
      me.name = v || null;
      me.asked = true;
      write();
      renderGreeting();
    });
    el.querySelector(".visitor-skip").addEventListener("click", function () {
      me.asked = true;
      write();
      renderGreeting();
    });
  }

  function init() {
    ensure();
    // The job browser offers optional naming in settings, without interrupting a
    // first visit or forcing an input into the primary navigation.
    if (!me.asked && !document.getElementById("settings-popover")) renderPrompt(false);
    else renderGreeting();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ---- api, read by track.js and presets.js -----------------------------------
  global.Visitor = {
    id: function () { return ensure().id; },
    name: function () { return (me && me.name) || null; },
    forget: function () {
      try { localStorage.removeItem(KEY); } catch (_) {}
      me = null;
      ensure();
      renderGreeting();
    },
  };
})(window);
