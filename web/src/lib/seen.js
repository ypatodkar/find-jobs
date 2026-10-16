// The roles this browser has opened, as track.js records them (localStorage
// "vc-directory-seen", { job_id: timestamp }). Written by lib/track.js on each open;
// read by the Hide-opened filters, the "N opened" notes, the clicked stamp and
// "Companies you've opened"; merged into by sign-in, when the account's history
// arrives. Updates from other tabs arrive as storage events.
import { useSyncExternalStore } from "react";

const KEY = "vc-directory-seen";
const MAX_ENTRIES = 5000; // ~250 KB of JSON; well inside the localStorage budget
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

// Drops the oldest entries rather than refusing new ones: recent history is the part
// anyone looks at.
function save(next) {
  const ids = Object.keys(next);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => next[a] - next[b]).slice(0, ids.length - MAX_ENTRIES).forEach((id) => delete next[id]);
  }
  snapshot = next;
  try { localStorage.setItem(KEY, JSON.stringify(snapshot)); } catch { /* quota or private mode: memory only */ }
  emit();
}

export const seenStore = {
  all: () => snapshot,
  /** Record that a role was opened. Returns false if it already was. */
  mark(id) {
    if (!id || snapshot[id]) return false;
    const ts = Date.now();
    save({ ...snapshot, [id]: ts });
    // lib/auth.js listens and copies it to a signed-in account.
    try { dispatchEvent(new CustomEvent("seen-change", { detail: { id, ts } })); } catch { /* no DOM */ }
    return true;
  },
  /** Add an account's history, keeping the earliest time each role was opened. */
  merge(other) {
    if (!other || typeof other !== "object") return;
    const next = { ...snapshot };
    let changed = false;
    for (const [id, raw] of Object.entries(other)) {
      const ts = Number(raw);
      if (!id || !(ts > 0)) continue;
      if (!next[id] || ts < next[id]) { next[id] = ts; changed = true; }
    }
    if (changed) save(next);
  },
};

/** The opened set as a plain object; a new object whenever it changes. */
export function useSeen() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => snapshot);
}
