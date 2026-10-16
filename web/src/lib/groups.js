// The Companies tab: the same filtered roles, one card per company. Ported from
// buildGroups and monogram in jobs-ui.js.

export const COMPANIES_PER_PAGE = 40;
const MONOGRAM_TINTS = 6;

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
// Groups seed `newest` at 0 and `oldest` at Infinity; startOfDay(Infinity) would be NaN.
const dayOfTs = (ts) => (ts && isFinite(ts) ? startOfDay(ts) : 0);

// Companies whose newest role landed on the same day are ordered at random, drawn once
// per company per page load, so the first few do not take every visit's attention.
const shuffle = new Map();
function shuffleOf(name) {
  let v = shuffle.get(name);
  if (v === undefined) shuffle.set(name, (v = Math.random()));
  return v;
}

/** Initials and a tint derived from the name, standing in for a missing logo. */
export function monogram(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 100000;
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const initials = (words.length === 0 ? "?" : words.length === 1 ? words[0].slice(0, 2) : words.slice(0, 2).map((w) => w[0]).join("")).toUpperCase();
  return { initials, tint: h % MONOGRAM_TINTS };
}

export function buildGroups(jobs, sort) {
  const map = new Map();
  for (const j of jobs) {
    let g = map.get(j.company);
    if (!g) {
      g = { company: j.company, jobs: [], cities: new Map(), newest: 0, oldest: Infinity, titleFirst: j.title, payMax: 0, size: j.size, stage: j.stage, logo: j.logo || null };
      map.set(j.company, g);
    }
    g.jobs.push(j);
    g.cities.set(j.city, (g.cities.get(j.city) || 0) + 1);
    const t = j.posted ? new Date(j.posted).getTime() : 0;
    if (t > g.newest) g.newest = t;
    if (t && t < g.oldest) g.oldest = t;
    if (j.title.localeCompare(g.titleFirst) < 0) g.titleFirst = j.title;
    const pay = j.salaryMax || j.salaryMin || 0;
    if (pay > g.payMax) g.payMax = pay;
    if (!g.size && j.size) g.size = j.size;
    if (!g.stage && j.stage) g.stage = j.stage;
    if (!g.logo && j.logo) g.logo = j.logo;
  }
  const groups = [...map.values()];
  const byName = (a, b) => a.company.localeCompare(b.company);
  if (sort === "company") groups.sort(byName);
  else if (sort === "title") groups.sort((a, b) => a.titleFirst.localeCompare(b.titleFirst) || byName(a, b));
  else if (sort === "salary") groups.sort((a, b) => b.payMax - a.payMax || b.jobs.length - a.jobs.length || byName(a, b));
  else if (sort === "count") groups.sort((a, b) => b.jobs.length - a.jobs.length || byName(a, b));
  else if (sort === "oldest") groups.sort((a, b) => dayOfTs(a.oldest) - dayOfTs(b.oldest) || shuffleOf(a.company) - shuffleOf(b.company));
  else groups.sort((a, b) => dayOfTs(b.newest) - dayOfTs(a.newest) || shuffleOf(a.company) - shuffleOf(b.company));
  return groups;
}

/** "Opened", not "applied": the site knows you looked, not what you did next. */
export const openedLabel = (n) => (n ? `${n} role${n === 1 ? "" : "s"} opened at this company` : "");
