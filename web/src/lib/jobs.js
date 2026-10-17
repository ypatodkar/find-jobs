// Loading, unpacking, ordering and formatting the job list.

export const JOBS_PER_PAGE = 45;
const DAY_MS = 86400000;

export const ROLE_LABELS = {
  ai: "AI / ML",
  robotics: "Robotics",
  backend: "Backend",
  infra: "Infra / Platform",
  fullstack: "Full-stack",
  frontend: "Frontend",
  data: "Data",
  security: "Security",
  mobile: "Mobile",
  solutions: "Solutions / FDE",
  qa: "QA / Test",
  swe: "Software Eng",
};

// Companies since acquired, whose apply links now lead to the acquirer's board.
// Only acquisitions belong here: a company bought outright, whose roles now sit under
// the buyer's name on some boards.
const ACQUIRED_BY = {
  prepared: "Axon",
  elementai: "ServiceNow",
  offerfit: "Braze",
  verta: "Cloudera",
  habu: "LiveRamp",
  shapesecurity: "F5",
  volterra: "F5",
  lilaccloud: "F5",
  doctorondemand: "Included Health",
  normalyze: "Proofpoint",
  dataai: "Sensor Tower",
  tile: "Life360",
  validately: "UserTesting",
  convex: "ServiceTitan",
  ribbonhealth: "H1",
};
export const acquirerOf = (company) => ACQUIRED_BY[String(company || "").toLowerCase().replace(/[^a-z0-9]/g, "")] || null;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const ageInDays = (iso) => (iso ? Math.floor((startOfDay(Date.now()) - startOfDay(new Date(iso))) / DAY_MS) : null);
const dayOf = (j) => (j.posted ? startOfDay(new Date(j.posted)) : 0);

export function relativeDate(iso) {
  const days = ageInDays(iso);
  if (days === null || Number.isNaN(days)) return null;
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return days + " days ago";
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : months + " months ago";
}

export function compactPay(j) {
  if (!j.salaryMin) return j.salary || null;
  if (j.salary && !/USD|\$/.test(j.salary)) return j.salary; // other currencies as published
  const k = (n) => "$" + Math.round(n / 1000) + "k";
  return j.salaryMax && j.salaryMax !== j.salaryMin ? `${k(j.salaryMin)}–${k(j.salaryMax)}` : `${k(j.salaryMin)}+`;
}

/**
 * Reverse pipeline.js's packCompanies: put each company's facts back on its rows.
 * A payload without a companies table (an older cached shape) passes through.
 */
export function expand(data) {
  const companies = data.companies;
  if (!companies) return data.jobs || [];
  const fields = data.companyFields || [];
  return (data.jobs || []).map((job) => {
    const co = companies[job.c] || {};
    const out = {};
    for (const k in job) if (k !== "c") out[k] = job[k];
    out.company = co.n;
    for (const f of fields) if (co[f] !== undefined) out[f] = co[f];
    return out;
  });
}

async function getJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw Object.assign(new Error(`Job data request failed (${r.status})`), { status: r.status });
  return r.json();
}

/**
 * Every role, from the paths the dev server answers, the build writes and Pages
 * serves. The list comes in two pieces requested together (scraper/pipeline.js
 * splitJobsPayload): the newest tenth, handed to `onRecent` as soon as it lands with
 * the whole list's totals, so the first page can be drawn; then everything. Where the
 * pieces are not published, the whole list is read in one go.
 */
export async function loadJobs(onRecent) {
  const recentReq = getJson("api/jobs-recent.json");
  const restReq = getJson("api/jobs-rest.json");
  // Marked handled at once: if the pieces are missing it can fail before the newest
  // piece's answer is read, and an unhandled failure is reported as a page error.
  // Awaiting it below still raises the error.
  restReq.catch(() => {});
  let recent;
  try {
    recent = await recentReq;
  } catch (err) {
    if (err.status !== 404) throw err;
    return expand(await getJson("api/all-jobs.json"));
  }
  const recentJobs = expand(recent);
  if (onRecent) onRecent({ jobs: recentJobs, total: recent.total, totalCompanies: recent.totalCompanies });
  const rest = await restReq;
  // Pieces from two different deploys (a browser cache can mix them) do not fit
  // together: read the whole list instead, straight from the server.
  if (rest.version !== recent.version) {
    const r = await fetch("api/all-jobs.json", { cache: "no-store" });
    if (!r.ok) throw new Error(`Job data request failed (${r.status})`);
    return expand(await r.json());
  }
  // One company table across both pieces, under shared indexes.
  const companies = { ...recent.companies, ...rest.companies };
  return recentJobs.concat(expand({ ...rest, companies }));
}

/**
 * The list orders. Both date orders group by posting day and,
 * within a day, put roles with a description first; ties keep arrival order.
 */
export function sortJobs(jobs, sort) {
  const arr = jobs.slice();
  const t = (j) => (j.posted ? new Date(j.posted).getTime() : 0);
  const pay = (j) => j.salaryMax || j.salaryMin || 0;
  const byTitle = (a, b) => a.title.localeCompare(b.title) || a.company.localeCompare(b.company);
  const undescribed = (j) => (j.described ? 0 : 1);
  if (sort === "newest") arr.sort((a, b) => dayOf(b) - dayOf(a) || undescribed(a) - undescribed(b) || t(b) - t(a));
  else if (sort === "oldest") arr.sort((a, b) => dayOf(a) - dayOf(b) || undescribed(a) - undescribed(b) || byTitle(a, b));
  else if (sort === "salary") arr.sort((a, b) => pay(b) - pay(a) || t(b) - t(a) || byTitle(a, b));
  else if (sort === "count") {
    const counts = new Map();
    arr.forEach((j) => counts.set(j.company, (counts.get(j.company) || 0) + 1));
    arr.sort((a, b) => (counts.get(b.company) || 0) - (counts.get(a.company) || 0) || t(b) - t(a) || byTitle(a, b));
  } else if (sort === "company") arr.sort((a, b) => a.company.localeCompare(b.company) || a.title.localeCompare(b.title));
  else if (sort === "title") arr.sort(byTitle);
  return arr;
}

/**
 * One investor's page: { status: "ok", jobs, host, totalOnBoard, ... } or
 * { status: "unsupported" | "error", reason }. Rejects when the file cannot be read.
 */
export async function loadFirm(id) {
  const r = await fetch("api/firm/" + encodeURIComponent(id) + ".json");
  const data = await r.json();
  if (!r.ok) throw data;
  return { ...data, jobs: expand(data) };
}
