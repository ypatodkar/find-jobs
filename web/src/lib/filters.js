// What the filters are and how they narrow the list: the dimensions, filtering, the
// counts beside each option, and the URL parameters a filtered view is shared with.
import { ROLE_LABELS } from "./jobs.js";

const DAY_MS = 86400000;
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const ageInDays = (iso) => (iso ? Math.floor((startOfDay(Date.now()) - startOfDay(new Date(iso))) / DAY_MS) : null);

export const DATE_RANGES = [
  { k: "all", label: "Any time", days: null },
  { k: "7", label: "Last 7 days", days: 7 },
  { k: "30", label: "Last 30 days", days: 30 },
  { k: "90", label: "Last 90 days", days: 90 },
];
export const SALARY_FLOORS = [
  { k: "all", label: "Any", min: 0 },
  { k: "150", label: "$150k+", min: 150000 },
  { k: "200", label: "$200k+", min: 200000 },
  { k: "250", label: "$250k+", min: 250000 },
  { k: "300", label: "$300k+", min: 300000 },
];
const SENIORITY_LABELS = { intern: "Intern", junior: "Junior", mid: "Mid", senior: "Senior", staff: "Staff / Principal", manager: "Manager", exec: "Director+" };
const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "manager", "exec"];
const CAREER_LABELS = { early: "Early career", experienced: "Experienced", unclear: "Not stated" };
const CAREER_ORDER = ["early", "experienced", "unclear"];
const SIZE_LABELS = { "1-10": "1–10", "11-50": "11–50", "51-200": "51–200", "201-1000": "201–1,000", "1000+": "1,000+" };
const SIZE_ORDER = ["1-10", "11-50", "51-200", "201-1000", "1000+"];

/**
 * Every multi-select filter: a key (also its URL parameter), how to read its values
 * off a job, and how to label them. AND across filters, OR within one. `group` picks
 * the main row or the Advanced panel; `exclude` removes what it matches.
 */
export function dimensions({ showFirms = false, firmLabel = (id) => id } = {}) {
  return [
    { key: "role", label: "Role", pluralLabel: "Roles", group: "primary", values: (j) => j.roles || [], labelFor: (v) => ROLE_LABELS[v] || v },
    { key: "city", label: "Location", pluralLabel: "Locations", group: "primary", values: (j) => [j.city] },
    { key: "seniority", label: "Experience", pluralLabel: "Experience levels", group: "primary", values: (j) => (j.seniority ? [j.seniority] : []), labelFor: (v) => SENIORITY_LABELS[v] || v, order: SENIORITY_ORDER },
    { key: "career", label: "Career stage", pluralLabel: "Career stages", group: "primary", values: (j) => [j.career || "unclear"], labelFor: (v) => CAREER_LABELS[v] || v, order: CAREER_ORDER },
    { key: "company", label: "Company", pluralLabel: "Companies", group: "advanced", values: (j) => [j.company] },
    { key: "notcompany", label: "Exclude company", pluralLabel: "Excluded companies", group: "advanced", values: (j) => [j.company], exclude: true },
    { key: "industry", label: "Industry", pluralLabel: "Industries", group: "advanced", values: (j) => j.markets || [] },
    { key: "size", label: "Company size", pluralLabel: "Company sizes", group: "advanced", values: (j) => (j.size ? [j.size] : []), labelFor: (v) => SIZE_LABELS[v] || v, order: SIZE_ORDER },
    { key: "stage", label: "Funding", pluralLabel: "Funding stages", group: "advanced", values: (j) => (j.stage ? [j.stage] : []) },
    { key: "firm", label: "Investor", pluralLabel: "Investors", group: "advanced", values: (j) => j.firms || [], labelFor: firmLabel, onlyWhenFirms: true },
  ].filter((d) => !d.onlyWhenFirms || showFirms).map((d) => ({ labelFor: (v) => v, ...d }));
}

/** The filter state as plain JSON: what the URL, undo and saved filters all hold. */
export const emptyFilters = () => ({ selected: {}, query: "", range: "all", salary: "all", sort: "newest", hideOpened: false, hideOpenedCompanies: false });

/** Same shape, in a stable form, so two states can be compared. */
export function normalize(f) {
  const selected = {};
  for (const k of Object.keys(f.selected || {}).sort()) if (f.selected[k] && f.selected[k].length) selected[k] = [...f.selected[k]];
  return { ...emptyFilters(), ...f, selected };
}
export const sameFilters = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

/**
 * The jobs that pass every filter. `skip` leaves one filter out, so that filter's own
 * dropdown can list what is still reachable under all the others. `seen` is the set
 * of opened job ids, `openedCompanies` the companies with any opened role.
 */
export function filterJobs(jobs, f, dims, { skip = null, seen = null, openedCompanies = null } = {}) {
  const q = f.query.trim().toLowerCase();
  const range = DATE_RANGES.find((r) => r.k === f.range);
  const floor = SALARY_FLOORS.find((s) => s.k === f.salary);
  const active = dims.filter((d) => d.key !== skip && f.selected[d.key] && f.selected[d.key].length)
    .map((d) => ({ d, set: new Set(f.selected[d.key]) }));
  return jobs.filter((j) => {
    for (const { d, set } of active) {
      const hit = d.values(j).some((v) => set.has(v));
      if (d.exclude ? hit : !hit) return false;
    }
    if (range && range.days !== null) {
      const a = ageInDays(j.posted);
      if (a === null || a >= range.days) return false;
    }
    if (floor && floor.min > 0 && (j.salaryMax || j.salaryMin || 0) < floor.min) return false;
    if (q && !j.title.toLowerCase().includes(q) && !j.company.toLowerCase().includes(q)) return false;
    if (f.hideOpened && seen && j.job_id && seen.has(j.job_id)) return false;
    if (f.hideOpenedCompanies && openedCompanies && openedCompanies.has(j.company)) return false;
    return true;
  });
}

/** How many roles each value of `d` would show under every other active filter. */
export function countsFor(jobs, f, d, dims, opts) {
  const m = new Map();
  for (const j of filterJobs(jobs, f, dims, { ...opts, skip: d.key })) for (const v of d.values(j)) if (v) m.set(v, (m.get(v) || 0) + 1);
  return m;
}

export function activeCount(f, dims) {
  let n = dims.reduce((a, d) => a + (f.selected[d.key] && f.selected[d.key].length ? 1 : 0), 0);
  if (f.range !== "all") n++;
  if (f.salary !== "all") n++;
  if (f.query.trim()) n++;
  if (f.hideOpened) n++;
  if (f.hideOpenedCompanies) n++;
  return n;
}

export function advancedCount(f, dims) {
  return dims.filter((d) => d.group === "advanced" && f.selected[d.key] && f.selected[d.key].length).length
    + (f.range !== "all" ? 1 : 0) + (f.salary !== "all" ? 1 : 0);
}

// ---- the URL ----
// Repeated params (?city=A&city=B), since company names and markets contain commas.
// Anything not ours (firm.html's ?id=, ?upload=) passes through untouched.
const OURS = ["q", "posted", "salary", "sort", "view", "sponsorship", "page", "unseen", "unopened"];

export function urlToState(search, dims) {
  const p = new URLSearchParams(search);
  const selected = {};
  for (const d of dims) {
    const vals = p.getAll(d.key).filter(Boolean);
    if (vals.length) selected[d.key] = vals;
  }
  return {
    filters: { selected, query: p.get("q") || "", range: p.get("posted") || "all", salary: p.get("salary") || "all", sort: p.get("sort") || "newest", hideOpened: p.get("unseen") === "1", hideOpenedCompanies: p.get("unopened") === "1" },
    page: Math.max(1, Math.floor(Number(p.get("page"))) || 1),
    view: p.get("view") === "grouped" ? "grouped" : "flat",
  };
}

export function stateToSearch(search, dims, f, page, view) {
  const p = new URLSearchParams();
  new URLSearchParams(search).forEach((v, k) => { if (!OURS.includes(k) && !dims.some((d) => d.key === k)) p.append(k, v); });
  for (const d of dims) for (const v of f.selected[d.key] || []) p.append(d.key, v);
  if (f.query) p.set("q", f.query);
  if (f.range !== "all") p.set("posted", f.range);
  if (f.salary !== "all") p.set("salary", f.salary);
  if (f.sort !== "newest") p.set("sort", f.sort);
  if (f.hideOpened) p.set("unseen", "1");
  if (f.hideOpenedCompanies) p.set("unopened", "1");
  if (view === "grouped") p.set("view", "grouped");
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
  return qs ? "?" + qs : "";
}
