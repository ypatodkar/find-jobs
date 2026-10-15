// A native <select> drawn as one of the filter dropdowns.
//
// The filters are <details> pickers with a panel of options; a plain <select> opens
// the operating system's own menu, in a style that matches nothing else on the page.
// enhance() puts a picker in front of a select and hides the select, but leaves it as
// the source of truth: choosing an option sets its value and fires its change event,
// and code that sets its value directly is reflected in the picker. Nothing that reads
// or writes the select has to know it is no longer what people see.
//
// Selects marked data-select-menu are enhanced on load. Markup rendered later (the
// résumé dropdown in the description pane) calls SelectMenu.enhance() itself.
(function (global) {
  "use strict";

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const GUTTER = 8;

  function enhance(select) {
    if (!select || select.dataset.enhanced) return;
    select.dataset.enhanced = "1";

    const picker = document.createElement("details");
    picker.className = "company-picker select-picker";
    picker.innerHTML = '<summary aria-haspopup="listbox"></summary><div class="company-panel select-panel" role="listbox"></div>';
    const summary = picker.firstElementChild;
    const panel = picker.lastElementChild;
    const name = select.getAttribute("aria-label") || (select.labels && select.labels[0] ? select.labels[0].textContent.trim() : "");
    if (name) panel.setAttribute("aria-label", name);

    select.hidden = true;
    select.tabIndex = -1;
    select.after(picker);

    function sync() {
      const opt = select.options[select.selectedIndex];
      summary.textContent = opt ? opt.textContent : "";
      summary.setAttribute("aria-label", name ? `${name}: ${summary.textContent}` : summary.textContent);
      picker.classList.toggle("is-disabled", select.disabled);
      if (select.disabled) summary.setAttribute("aria-disabled", "true");
      else summary.removeAttribute("aria-disabled");
    }

    function build() {
      panel.innerHTML = [...select.options].map((o, i) =>
        `<button type="button" role="option" class="select-option${o.selected ? " is-selected" : ""}" data-i="${i}"` +
        ` aria-selected="${o.selected}"${o.disabled ? " disabled" : ""}>${esc(o.textContent)}</button>`).join("");
    }

    // The panel hangs from the left edge like the filters' panels, unless that would
    // run it off the right of the window (Sort sits at the far right of its row).
    function place() {
      picker.classList.remove("align-right");
      const r = panel.getBoundingClientRect();
      if (r.right > global.innerWidth - GUTTER) picker.classList.add("align-right");
    }

    const options = () => [...panel.querySelectorAll(".select-option:not(:disabled)")];

    function choose(i) {
      picker.open = false;
      summary.focus();
      if (select.selectedIndex === i) return;
      select.selectedIndex = i;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    summary.addEventListener("click", (e) => { if (select.disabled) e.preventDefault(); });
    picker.addEventListener("toggle", () => {
      if (!picker.open) return;
      build();
      place();
      const current = panel.querySelector(".is-selected") || options()[0];
      if (current) current.focus();
    });
    panel.addEventListener("click", (e) => {
      const b = e.target.closest(".select-option");
      if (b && !b.disabled) choose(Number(b.dataset.i));
    });
    picker.addEventListener("keydown", (e) => {
      if (!picker.open) {
        if (e.target === summary && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          if (!select.disabled) picker.open = true;
        }
        return;
      }
      const list = options();
      const at = list.indexOf(document.activeElement);
      let next = null;
      if (e.key === "ArrowDown") next = list[Math.min(list.length - 1, at + 1)];
      else if (e.key === "ArrowUp") next = list[Math.max(0, at - 1)];
      else if (e.key === "Home") next = list[0];
      else if (e.key === "End") next = list[list.length - 1];
      else if (e.key === "Escape") {
        e.preventDefault();
        // Escape belongs to this menu, not to a panel or drawer it sits in.
        e.stopPropagation();
        picker.open = false;
        summary.focus();
        return;
      } else if (e.key === "Tab") {
        picker.open = false;
        return;
      }
      if (next) { e.preventDefault(); next.focus(); }
    });

    // Code that sets the value directly (restoring a URL, applying a saved filter)
    // fires no change event, so the setters themselves are wrapped to repaint.
    const proto = HTMLSelectElement.prototype;
    ["value", "selectedIndex", "disabled"].forEach((prop) => {
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      Object.defineProperty(select, prop, {
        configurable: true,
        get() { return d.get.call(this); },
        set(v) { d.set.call(this, v); sync(); },
      });
    });

    sync();
  }

  // One listener for every menu, including ones rendered after load.
  document.addEventListener("click", (e) => {
    document.querySelectorAll("details.select-picker[open]").forEach((p) => {
      if (!p.contains(e.target)) p.open = false;
    });
  });

  document.querySelectorAll("select[data-select-menu]").forEach(enhance);

  global.SelectMenu = { enhance };
})(window);
