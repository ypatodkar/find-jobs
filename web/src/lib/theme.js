// Light or dark: the OS decides unless the visitor says otherwise.
//
// <html data-theme> always holds the theme in effect, "light" or "dark", so the styles
// (app.css, and Tailwind's dark: variant) read one attribute and never a media query.
// Each page's inline script sets it before the first paint; this module keeps it right
// afterwards and owns the toggle.
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
export const effectiveTheme = () => stored() || system();

const paint = () => root.setAttribute("data-theme", effectiveTheme());

function apply(theme) {
  try {
    // Agreeing with the OS is having no opinion, so a later OS change carries the page.
    if (theme === system()) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch { /* private mode: this visit only */ }
  paint();
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

// Re-applied here in case the inline snippet is missing, dropping an override the OS
// has since caught up to.
const saved = stored();
if (saved) apply(saved);
else paint();

// The OS can flip mid-visit (macOS does at sunset); an override may then be redundant.
dark.addEventListener("change", () => {
  const s = stored();
  if (s && s === system()) apply(s);
  else paint();
  emit();
});

export function toggleTheme() {
  apply(effectiveTheme() === "dark" ? "light" : "dark");
  emit();
}

export function useTheme() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, effectiveTheme);
}
