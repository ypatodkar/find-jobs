// What the list shows above its rows, chosen in the View menu (localStorage
// "find-jobs-view-prefs"). Both off by default: the owner moved them out of the way.
//   count  "Showing 1–45 of 15,194 matching roles"
//   keys   "↑ ↓ to move between jobs" (only beside the pane, with a keyboard)
// A browser preference, not a filter: it stays out of the address bar and saved filters.
import { useSyncExternalStore } from "react";

const KEY = "find-jobs-view-prefs";
const DEFAULTS = { count: false, keys: false };
let snapshot = read();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === "object" ? { ...DEFAULTS, count: raw.count === true, keys: raw.keys === true } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export function setViewPref(key, value) {
  snapshot = { ...snapshot, [key]: value === true };
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* private mode: this tab only */ }
  emit();
}

function subscribe(fn) {
  listeners.add(fn);
  const onStorage = (e) => { if (e.key === KEY) { snapshot = read(); emit(); } };
  addEventListener("storage", onStorage);
  return () => { listeners.delete(fn); removeEventListener("storage", onStorage); };
}

export function useViewPrefs() {
  return useSyncExternalStore(subscribe, () => snapshot, () => DEFAULTS);
}
