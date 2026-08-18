// Temporary design switcher for the Startup of the day experiment branch.
(function () {
  "use strict";

  var root = document.documentElement;
  var buttons = document.querySelectorAll(".featured-lab button[data-feature-variant]");

  function select(value) {
    root.setAttribute("data-feature-variant", value);
    buttons.forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.getAttribute("data-feature-variant") === value));
    });
  }

  buttons.forEach(function (button) {
    button.addEventListener("click", function () {
      select(button.getAttribute("data-feature-variant"));
    });
  });
})();
