// Keyboard shortcuts. Only one so far, and the one people reach for first: a search
// box you can get to without the mouse.
//
// The badge says ⌘K on a Mac and Ctrl K everywhere else, decided here rather than
// shipped in the markup, because a page cached on one platform should not tell someone
// on another to press a key their keyboard does not have.
(function (global) {
  "use strict";
  var mac = /Mac|iPhone|iPad/.test(global.navigator.platform || global.navigator.userAgent || "");

  function ready() {
    var badge = document.getElementById("search-key");
    if (badge) badge.textContent = mac ? "⌘K" : "Ctrl K";

    document.addEventListener("keydown", function (event) {
      if (event.key !== "k" && event.key !== "K") return;
      if (!(mac ? event.metaKey : event.ctrlKey) || event.altKey || event.shiftKey) return;
      // Both pages carry a desktop and a mobile search box; whichever is on screen is
      // the one being asked for.
      var boxes = [document.getElementById("job-search"), document.getElementById("mobile-job-search")];
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        if (box && box.offsetParent !== null) {
          event.preventDefault();
          box.focus();
          box.select();
          return;
        }
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})(window);
