// Resume matching's data: the account's resumes, the scores already fetched this
// visit, and today's allowance. One copy per page view, shared by every job opened, so
// moving between jobs never flickers through "loading". Signing in or out changes
// whose resumes these are, so everything is forgotten then (`accountVersion` lets a
// request that started before the change throw its answer away).
import * as Import from "./resume-import.js";
import { visitorId } from "./visitor.js";
import { onAccountChange } from "./auth.js";

export { Import };

const ACTIVE = "find-jobs-active-resume";
const UPLOAD_FILES = "find-jobs-upload-files";
const API = "api";

// A static host answers 404 or 405 for these paths: the endpoints simply are not
// there, which is a different message from the server refusing.
export async function call(path, init, timeoutMs) {
  let res;
  try {
    res = await fetch(API + path, timeoutMs ? { ...init, signal: AbortSignal.timeout(timeoutMs) } : init);
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) throw new Error("The upload took too long and was stopped. Please try again.");
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (res.status === 401) throw Object.assign(new Error((data && data.error) || "Sign in to use resume matching."), { signedOut: true });
  if (!res.ok || !data) {
    if (res.status === 404 && !(data && data.error)) throw new Error("Resume matching isn't available on this version of the site yet.");
    if (res.status === 405) throw new Error("Resume matching isn't available on this version of the site yet.");
    throw Object.assign(new Error((data && data.error) || "Something went wrong. Please try again."), { code: data && data.code, usage: data && data.usage });
  }
  return data;
}
export const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const cache = {
  accountVersion: 0,
  listing: null, // Promise of the resume list, once asked for
  items: [],
  scores: new Map(), // "resumeId|jobId" -> result | null
  stale: new Map(),  // "resumeId|jobId" -> "description" | "rubric": checked before a change
  // `limitHit`: a check was refused because today's checks are used up; the card then
  // asks for feedback, which unlocks more. `lastUsage` comes back with every paid
  // check, for the "N left today" note.
  limitHit: null,
  lastUsage: null,
};
export const key = (r, j) => r + "|" + j;

function forgetAccount() {
  cache.accountVersion++;
  cache.listing = null;
  cache.items = [];
  cache.scores.clear();
  cache.stale.clear();
  // Today's allowance is the account's too: the next account (or nobody) must not
  // see the last one's "N left today" or its limit.
  cache.limitHit = null;
  cache.lastUsage = null;
}
onAccountChange(forgetAccount);

export function activeId() {
  let id = null;
  try { id = localStorage.getItem(ACTIVE); } catch { /* no storage: first resume */ }
  return cache.items.some((r) => r.id === id) ? id : (cache.items[0] && cache.items[0].id) || null;
}
export function setActive(id) {
  try { if (id) localStorage.setItem(ACTIVE, id); else localStorage.removeItem(ACTIVE); } catch { /* fine */ }
}

export function loadList(force) {
  if (!cache.listing || force) {
    const identity = cache.accountVersion;
    cache.listing = call("/resumes")
      .then((d) => {
        if (identity !== cache.accountVersion) throw new Error("The signed-in account changed.");
        cache.items = d.resumes || [];
        return cache.items;
      })
      .catch((err) => { if (identity === cache.accountVersion) cache.listing = null; throw err; });
  }
  return cache.listing;
}

// Sending the original file with the text (the server keeps both, file-store.cjs) is
// on only with ?upload=files, or once that has been visited in this browser, while it
// is tried on the live site. ?upload=text turns it back off.
export function sendsFiles() {
  const flag = new URLSearchParams(location.search).get("upload");
  try {
    if (flag === "files") localStorage.setItem(UPLOAD_FILES, "1");
    if (flag === "text") localStorage.removeItem(UPLOAD_FILES);
    return localStorage.getItem(UPLOAD_FILES) === "1";
  } catch { return flag === "files"; }
}
if (typeof window !== "undefined") sendsFiles(); // read the switch on arrival

// `onStage` hears "uploading" once the file is read, so the card can say which step
// it is on; a stall then names its step.
export async function addResume(file, onStage) {
  const identity = cache.accountVersion;
  const text = await Import.extract(file);
  if (identity !== cache.accountVersion) throw new Error("The signed-in account changed. Please try again.");
  if (!text || text.length < 100) throw new Error("Too little text could be read. Try a text-based PDF or .docx.");
  const original = sendsFiles() ? await Import.encode(file) : undefined;
  if (onStage) onStage("uploading");
  const d = await call("/resumes", json("POST", { visitor: visitorId(), label: (file.name || "Resume").replace(/\.[^.]+$/, ""), fileName: file.name || null, text, file: original }), 60000);
  if (identity !== cache.accountVersion) return null;
  cache.items = [d.resume, ...cache.items];
  cache.listing = Promise.resolve(cache.items);
  setActive(d.resume.id);
  return d.resume;
}

export async function deleteResume(id) {
  const identity = cache.accountVersion, wasActive = activeId() === id;
  await call(`/resumes/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (identity !== cache.accountVersion) return;
  cache.items = cache.items.filter((r) => r.id !== id);
  cache.listing = Promise.resolve(cache.items);
  [...cache.scores.keys()].forEach((k) => { if (k.startsWith(id + "|")) { cache.scores.delete(k); cache.stale.delete(k); } });
  if (wasActive) setActive((cache.items[0] && cache.items[0].id) || null);
}

/** The stored result for a resume and job, read from the database once per visit. */
export async function fetchStored(id, jobId) {
  if (!id || cache.scores.has(key(id, jobId))) return true;
  const identity = cache.accountVersion;
  const d = await call(`/match?resume=${encodeURIComponent(id)}&job=${encodeURIComponent(jobId)}`);
  if (identity !== cache.accountVersion) return false;
  cache.scores.set(key(id, jobId), d.match || null);
  if (d.stale) cache.stale.set(key(id, jobId), d.stale.reason);
  return true;
}

// ---- the findings ----
export const STATUS_LABEL = { shown: "Demonstrated", partial: "Partial", unclear: "Not evidenced" };
export const MARK = { shown: "✓", partial: "◐", unclear: "?" };
export const squash = (t) => String(t).toLowerCase().replace(/\s+/g, "");
export const findings = (r) => (r && Array.isArray(r.findings) ? r.findings.filter((f) => STATUS_LABEL[f.status] && typeof f.text === "string") : []);
export const ranked = (rows) => {
  const kind = { required: 0, preferred: 1, duty: 2, other: 2 };
  const status = { unclear: 0, partial: 1, shown: 2 };
  return rows.slice().sort((a, b) => (kind[a.kind] ?? 2) - (kind[b.kind] ?? 2) ||
    (b.weight || 0) - (a.weight || 0) || status[a.status] - status[b.status] || (b.confidence || 0) - (a.confidence || 0));
};

export function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const d = Math.round(h / 24);
  return d + (d === 1 ? " day ago" : " days ago");
}

export const untilReset = (ts) => {
  const h = Math.max(0, Math.round((ts - Date.now()) / 3600000));
  return h <= 1 ? "within the hour" : `in about ${h} hours`;
};

// Presentation only: remove wordy lead-ins, then use a bounded excerpt. The employer's
// full text is kept for passage matching and the requirement breakdown.
export function insightSummary(text) {
  let summary = text.replace(/\s+/g, " ").trim()
    .replace(/^(?:the (?:successful|ideal) candidate (?:will|should|must) (?:have|be able to)|you(?:'ll| will) be responsible for)\s+/i, "")
    .replace(/^(?:demonstrate(?:d)? (?:practical )?experience (?:with|in)|(?:proven |hands-on |relevant |professional )?experience (?:with|in)|ability to|responsible for|you (?:will|should)|you'll)\s+/i, "");
  if (/^[a-z][a-z]/.test(summary)) summary = summary[0].toUpperCase() + summary.slice(1);
  if (summary.length > 112) summary = summary.slice(0, 112).replace(/\s+\S*$/, "").replace(/[,:;\s]+$/, "") + "…";
  return summary;
}
