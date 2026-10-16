// Saved filters: the React side of presets.js, with the same storage key, link format
// (?f=) and events, so filters saved on the current page appear here and a signed-in
// account's copy (auth.js listens for "presets-change") keeps working.
import { useSyncExternalStore } from "react";
import "../../../api-config.js"; // window.API_ENDPOINT
import { visitorId, visitorName } from "./visitor.js";

const KEY = "vc-directory-filters";
const MAX = 50;
export const MAX_NAME = 80;

const valid = (p) => p && typeof p === "object" && typeof p.id === "string" && p.filters && typeof p.filters === "object";

function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(raw) ? raw.filter(valid) : [];
  } catch {
    return [];
  }
}

let items = read();
let persistent = true;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

// `fromSync` marks a write that came from a signed-in account; every other write is
// announced as "presets-change" for auth.js to copy to the account.
function write(fromSync) {
  if (persistent) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { persistent = false; }
  }
  try { dispatchEvent(new CustomEvent(fromSync ? "presets-sync" : "presets-change")); } catch { /* no DOM */ }
  emit();
}

if (typeof window !== "undefined") {
  addEventListener("storage", (e) => { if (e.key === KEY) { items = read(); emit(); } });
}

// Which slices get saved, for the site owner: no identifier beyond the browser's id.
function report(action, name, filters) {
  const endpoint = window.API_ENDPOINT;
  if (!endpoint || !navigator.sendBeacon) return;
  try {
    navigator.sendBeacon(endpoint + "/filter", JSON.stringify({
      action, user_id: visitorId(), user_name: visitorName(), name: name || null, filters: filters || {},
      page: location.pathname.split("/").pop() || "index.html", firm: new URLSearchParams(location.search).get("id"),
    }));
  } catch { /* never blocks saving */ }
}

const uid = () => "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clip = (s) => { s = String(s || ""); return s.length > MAX_NAME ? s.slice(0, MAX_NAME - 1) + "…" : s; };

export const presets = {
  all: () => items,
  get: (id) => items.find((p) => p.id === id) || null,
  save(name, filters) {
    const p = { id: uid(), name: String(name || "").slice(0, MAX_NAME) || "Saved filter", filters, createdAt: Date.now() };
    items = [...items, p].slice(-MAX);
    write();
    report("save", p.name, filters);
    return p;
  },
  rename(id, name) {
    items = items.map((p) => (p.id === id ? { ...p, name: String(name || "").slice(0, MAX_NAME) || p.name } : p));
    write();
  },
  remove(id) {
    const n = items.length;
    items = items.filter((p) => p.id !== id);
    if (items.length !== n) write();
  },
  replaceAll(list) {
    if (!Array.isArray(list)) return;
    items = list.filter(valid).slice(-MAX);
    write(true);
  },
};

export function usePresets() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => items);
}

// ---- links: base64url of the JSON, via TextEncoder for non-Latin1 names ----
export function encode(filters) {
  const bytes = new TextEncoder().encode(JSON.stringify(filters));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decode(s) {
  try {
    const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
    const out = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return out && typeof out === "object" && out.selected ? out : null;
  } catch {
    return null; // a mangled link loads the normal page
  }
}

/** Whether a saved preset is the view on screen. */
export function same(a, b) {
  if (!a || !b) return false;
  if ((a.query || "").trim() !== (b.query || "").trim()) return false;
  if (a.range !== b.range || a.salary !== b.salary || a.sort !== b.sort) return false;
  const keys = (x) => Object.keys(x.selected || {}).filter((k) => (x.selected[k] || []).length);
  const ka = keys(a), kb = keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => {
    const x = [...(a.selected[k] || [])].sort(), y = [...(b.selected[k] || [])].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

// A suggested name: one thing, most specific first — the search, then company,
// investor, role, level, industry, city, size, stage; then pay, date, order, context.
const NAME_ORDER = ["company", "firm", "role", "seniority", "career", "industry", "city", "size", "stage"];
const SORT_NAMES = { count: "Most roles", company: "Company A–Z", title: "Title A–Z", salary: "Highest salary", oldest: "Oldest roles" };

export function describe(filters, { labelFor, salaryLabel, rangeLabel, contextLabel }) {
  const q = (filters.query || "").trim();
  if (q) return clip(q);
  for (const key of NAME_ORDER) {
    const vals = (filters.selected || {})[key];
    if (!vals || !vals.length) continue;
    const first = labelFor(key, vals[0]);
    return clip(vals.length > 1 ? `${first} +${vals.length - 1}` : first);
  }
  if (filters.salary && filters.salary !== "all") return clip(salaryLabel(filters.salary));
  if (filters.range && filters.range !== "all") return clip(rangeLabel(filters.range));
  const mode = SORT_NAMES[filters.sort] || "";
  const context = contextLabel ? String(contextLabel).trim() : "";
  if (context && mode) return clip(`${context} · ${mode}`);
  if (context) return clip(`${context} roles`);
  return mode || "All roles";
}
