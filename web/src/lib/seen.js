// The roles this browser has opened, as track.js records them (localStorage
// "vc-directory-seen", { job_id: timestamp }). Read-only here until track.js itself
// moves to React; the Hide-opened filters only need to read it. Updates from other
// tabs arrive as storage events.
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
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    snapshot = read();
    listeners.forEach((fn) => fn());
  });
}

/** The opened set as a plain object; a new object whenever it changes. */
export function useSeen() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
}
