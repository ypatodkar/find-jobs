// The roles this browser has opened, as track.js records them (localStorage
// "vc-directory-seen", { job_id: timestamp }). Read by the Hide-opened filters and the
// "N opened" notes; merged into by sign-in, when the account's history arrives. Updates
// from other tabs arrive as storage events.
import { useSyncExternalStore } from "react";

const KEY = "vc-directory-seen";
let snapshot = read();

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    snapshot = read();
    emit();
  });
}

export const seenStore = {
  all: () => snapshot,
  /** Add an account's history, keeping the earliest time each role was opened. */
  merge(other) {
    if (!other || typeof other !== "object") return;
    const next = { ...snapshot };
    for (const [id, ts] of Object.entries(other)) if (typeof ts === "number" && (!next[id] || ts < next[id])) next[id] = ts;
    snapshot = next;
    try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* memory only */ }
    emit();
  },
};

/** The opened set as a plain object; a new object whenever it changes. */
export function useSeen() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
}
