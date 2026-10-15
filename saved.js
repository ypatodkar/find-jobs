// Saved jobs: a shortlist, kept in this browser and, when signed in, on the account.
//
// Each entry keeps a small copy of the job (title, company, place, link, date), so a
// saved role that later drops off the boards still shows in the Saved list — marked
// as no longer listed — instead of quietly disappearing.
//
// Changes are announced as "saved-change" (auth.js copies them to the account). An
// account's list arriving is applied with replaceAll() and announced as "saved-sync",
// which auth.js does not send back.
(function (global) {
  "use strict";

  const KEY = "find-jobs-saved";
  const MAX = 500;
  let items = read(); // [{ id, at, job: { title, company, city, url, posted } }]

  function read() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(raw) ? raw.filter(valid) : [];
    } catch {
      return [];
    }
  }
  function valid(s) {
    return s && typeof s.id === "string" && s.id && typeof s.at === "number" && s.job && typeof s.job.title === "string";
  }
  function write(fromSync) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* memory only */ }
    try { global.dispatchEvent(new CustomEvent(fromSync ? "saved-sync" : "saved-change")); } catch { /* no DOM */ }
  }
  const snapshot = (j) => ({
    title: String(j.title || "").slice(0, 300),
    company: String(j.company || "").slice(0, 200),
    city: j.city ? String(j.city).slice(0, 120) : null,
    url: typeof j.url === "string" && /^https?:\/\//.test(j.url) ? j.url.slice(0, 1000) : null,
    posted: j.posted || null,
  });

  global.Saved = {
    has: (id) => items.some((s) => s.id === id),
    count: () => items.length,
    /** Newest saved first. */
    all: () => items.slice().sort((a, b) => b.at - a.at),
    toggle(job) {
      if (!job || !job.job_id) return false;
      const was = items.some((s) => s.id === job.job_id);
      if (was) items = items.filter((s) => s.id !== job.job_id);
      else items = [{ id: job.job_id, at: Date.now(), job: snapshot(job) }, ...items].slice(0, MAX);
      write();
      return !was;
    },
    /** Replace the list with a signed-in account's copy. */
    replaceAll(list) {
      if (!Array.isArray(list)) return;
      items = list.filter(valid).slice(0, MAX);
      write(true);
    },
  };
})(window);
