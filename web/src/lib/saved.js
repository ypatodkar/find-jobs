// Saved jobs, as saved.js keeps them (localStorage "find-jobs-saved"), with the same
// events: "saved-change" for auth.js to copy to the account, "saved-sync" when the
// account's list arrives. Each entry keeps a small copy of the job.
import { useSyncExternalStore } from "react";

const KEY = "find-jobs-saved";
const MAX = 500;
const valid = (s) => s && typeof s.id === "string" && s.id && typeof s.at === "number" && s.job && typeof s.job.title === "string";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw.filter(valid) : [];
  } catch {
    return [];
  }
}

let items = read();
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

function write(fromSync) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* memory only */ }
  try { dispatchEvent(new CustomEvent(fromSync ? "saved-sync" : "saved-change")); } catch { /* no DOM */ }
  emit();
}

if (typeof window !== "undefined") {
  addEventListener("storage", (e) => { if (e.key === KEY) { items = read(); emit(); } });
}

const snapshot = (j) => ({
  title: String(j.title || "").slice(0, 300),
  company: String(j.company || "").slice(0, 200),
  city: j.city ? String(j.city).slice(0, 120) : null,
  url: typeof j.url === "string" && /^https?:\/\//.test(j.url) ? j.url.slice(0, 1000) : null,
  posted: j.posted || null,
});

export const savedItems = () => items;

export const saved = {
  has: (id) => items.some((s) => s.id === id),
  toggle(job) {
    if (!job || !job.job_id) return;
    items = items.some((s) => s.id === job.job_id)
      ? items.filter((s) => s.id !== job.job_id)
      : [{ id: job.job_id, at: Date.now(), job: snapshot(job) }, ...items].slice(0, MAX);
    write();
  },
  replaceAll(list) {
    if (!Array.isArray(list)) return;
    items = list.filter(valid).slice(0, MAX);
    write(true);
  },
};

export function useSaved() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => items);
}
