// Light or dark, as theme.js: the OS decides unless the visitor says otherwise. The
// default is CSS (prefers-color-scheme); index.html's inline script applies a stored
// override before first paint. This owns the toggle.
//
// The override is stored only while it disagrees with the OS. Toggling back into
// agreement clears it, so the visitor follows their system again rather than being
// pinned to a choice they made once.
import { useSyncExternalStore } from "react";

const KEY = "vc-directory-theme";
const root = document.documentElement;
const dark = matchMedia("(prefers-color-scheme: dark)");

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : null;
  } catch {
    return null; // private mode; the OS default still applies
  }
}
const system = () => (dark.matches ? "dark" : "light");
export const effectiveTheme = () => root.getAttribute("data-theme") || system();

function apply(theme) {
  if (theme === system()) {
    // Agreeing with the OS is having no opinion, so a later OS change carries the page.
    root.removeAttribute("data-theme");
    try { localStorage.removeItem(KEY); } catch { /* fine */ }
  } else {
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem(KEY, theme); } catch { /* fine */ }
  }
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

// Re-applied here in case the inline snippet is missing, dropping one the OS has
// since caught up to.
const saved = stored();
if (saved) apply(saved);

// The OS can flip mid-visit (macOS does at sunset); an override may then be redundant.
dark.addEventListener("change", () => {
  const s = stored();
  if (s && s === system()) apply(s);
  emit();
});

export function toggleTheme() {
  apply(effectiveTheme() === "dark" ? "light" : "dark");
  emit();
}

export function useTheme() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, effectiveTheme);
}
