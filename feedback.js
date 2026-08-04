// The feedback widget, sitting in the masthead under the theme toggle.
//
// A small button that nudges once in a while, opening a short form: say the thing,
// optionally tag what it's about, optionally leave an address. Posts to the worker,
// which stores it and emails it on. Only the message is required.
//
// Deliberately quiet about failure in only one direction: a network error is shown,
// because someone who typed a paragraph deserves to know it didn't send. Everything
// else — no endpoint, no JS — simply means no button, never a broken one.
(function (global) {
  "use strict";

  var ENDPOINT = "https://vcjobs-clicks.ypatodkar.workers.dev";
  var MOUNT_ID = "feedback-slot";
  var SENT_KEY = "vc-directory-feedback-sent";
  var MAX = 4000;

  // Values must match TOPICS in worker/index.js; anything else is filed as "other".
  var TOPICS = [
    { k: "jobs", label: "More jobs" },
    { k: "filters", label: "Filters & search" },
    { k: "design", label: "Design" },
    { k: "bug", label: "Something's broken" },
    { k: "other", label: "Something else" },
  ];

  var open = false;
  // Null until they pick one. Choosing a topic is optional: the message is the point,
  // and a pre-ticked chip would quietly file everything under whichever one it was.
  var topic = null;
  var busy = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Nudged before, so the button stops bouncing for anyone who has already written in.
  function hasSent() {
    try { return localStorage.getItem(SENT_KEY) === "1"; } catch (_) { return false; }
  }
  function markSent() {
    try { localStorage.setItem(SENT_KEY, "1"); } catch (_) {}
  }

  // Sits in the masthead directly under the theme toggle, so it stays inside the
  // page's own left and right margins instead of floating over a corner of the
  // viewport. Falls back to the body if a page has no masthead.
  function mount() {
    var el = document.getElementById(MOUNT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = MOUNT_ID;
    var top = document.querySelector(".masthead-top");
    if (top && top.parentNode) top.parentNode.insertBefore(el, top.nextSibling);
    else document.body.appendChild(el);
    return el;
  }

  var ICON =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.6-.7L3 21l1.9-5A8.2 8.2 0 0 1 4 11.5 8.4 8.4 0 0 1 13 3a8.4 8.4 0 0 1 8 8.5z"/></svg>';

  function formHtml() {
    return (
      '<div class="fb-panel" role="dialog" aria-modal="false" aria-labelledby="fb-title">' +
      '<div class="fb-head">' +
      '<span class="fb-title" id="fb-title">Tell me what would make this better</span>' +
      '<button type="button" class="fb-close" aria-label="Close feedback">&times;</button>' +
      "</div>" +
      '<form class="fb-form" novalidate>' +
      '<span class="fb-sub">What\'s it about? <em>(optional)</em></span>' +
      '<div class="fb-topics" role="group" aria-label="What is this about? Optional.">' +
      TOPICS.map(function (t) {
        var on = t.k === topic;
        return '<button type="button" class="fb-chip' + (on ? " is-on" : "") +
          '" data-topic="' + t.k + '" aria-pressed="' + on + '">' + esc(t.label) + "</button>";
      }).join("") +
      "</div>" +
      '<textarea class="fb-text" rows="3" maxlength="' + MAX +
      '" placeholder="Anything at all — a missing company, a filter that confused you…" aria-label="Your feedback"></textarea>' +
      '<input class="fb-contact" type="email" autocomplete="email" placeholder="Email, only if you want a reply" aria-label="Your email, optional" />' +
      '<div class="fb-actions">' +
      '<span class="fb-note">Goes straight to me. Nothing else is attached.</span>' +
      '<button type="submit" class="fb-send">Send</button>' +
      "</div>" +
      "</form></div>"
    );
  }

  function render() {
    var el = mount();
    var nudge = !hasSent() && !open;
    el.innerHTML =
      '<div class="fb-wrap' + (open ? " is-open" : "") + '">' +
      '<button type="button" class="fb-btn' + (nudge ? " is-nudging" : "") +
      '" aria-expanded="' + open + '">' + ICON + "<span>Feedback</span></button>" +
      (open ? formHtml() : "") +
      "</div>";

    el.querySelector(".fb-btn").addEventListener("click", function () {
      open = !open;
      render();
      if (open) {
        var t = el.querySelector(".fb-text");
        if (t) t.focus();
      }
    });
    if (!open) return;

    el.querySelector(".fb-close").addEventListener("click", function () { open = false; render(); });
    el.querySelectorAll(".fb-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        var value = b.getAttribute("data-topic");
        topic = topic === value ? null : value; // tapping the chosen one clears it
        el.querySelectorAll(".fb-chip").forEach(function (x) {
          var on = x.getAttribute("data-topic") === topic;
          x.classList.toggle("is-on", on);
          x.setAttribute("aria-pressed", String(on));
        });
      });
    });
    el.querySelector(".fb-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submit(el);
    });
  }

  function done(el, message, isError) {
    var panel = el.querySelector(".fb-panel");
    if (!panel) return;
    panel.innerHTML =
      '<div class="fb-done' + (isError ? " is-error" : "") + '">' + esc(message) + "</div>";
    if (isError) return;
    setTimeout(function () { open = false; render(); }, 1900);
  }

  function submit(el) {
    if (busy) return;
    var text = (el.querySelector(".fb-text").value || "").trim();
    if (text.length < 2) {
      el.querySelector(".fb-text").focus();
      return;
    }
    var contact = (el.querySelector(".fb-contact").value || "").trim();
    var btn = el.querySelector(".fb-send");
    busy = true;
    btn.disabled = true;
    btn.textContent = "Sending…";

    // Not sendBeacon: unlike a click, the reader is still here and waiting, so the
    // response matters — it decides between "thanks" and "that didn't send".
    fetch(ENDPOINT + "/feedback", {
      method: "POST",
      body: JSON.stringify({
        topic: topic || "other",
        message: text.slice(0, MAX),
        contact: contact || null,
        user_id: global.Visitor ? global.Visitor.id() : null,
        user_name: global.Visitor ? global.Visitor.name() : null,
        page: location.pathname.split("/").pop() || "index.html",
      }),
    })
      .then(function (r) {
        busy = false;
        if (!r.ok) throw new Error("HTTP " + r.status);
        markSent();
        done(el, "Thank you — that's on its way to me.", false);
      })
      .catch(function () {
        busy = false;
        done(el, "That didn't send. Please try again in a moment.", true);
      });
  }

  function init() {
    if (!ENDPOINT) return; // feature off; no button rather than a dead one
    render();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && open) { open = false; render(); }
    });

    // Click anywhere outside to dismiss.
    //
    // Capture phase, and bound once here rather than inside render(). Both matter: the
    // button's own handler re-renders the widget, which detaches the element that was
    // clicked, so a bubbling listener would run afterwards, find the target no longer
    // inside the widget, and immediately close what had just been opened. Binding per
    // render would also stack a new listener on every open.
    document.addEventListener(
      "click",
      function (e) {
        if (!open) return;
        var el = document.getElementById(MOUNT_ID);
        if (el && !el.contains(e.target)) {
          open = false;
          render();
        }
      },
      true
    );
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  global.Feedback = { open: function () { open = true; render(); } };
})(window);
