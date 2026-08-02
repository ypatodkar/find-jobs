// Shared role/city matching, used by both the VC-board scraper and the ATS adapters
// so a job is judged identically no matter which source it came from.

const { CITY_MATCHERS, ROLE_PATTERNS, EXCLUDE_TITLE } = require("./boards");

const REMOTE_RE = /\bremote\b|\bwork from home\b|\banywhere\b|\bdistributed\b/i;
// Remote postings routinely name the region they're open to. We only track US roles,
// so a remote listing scoped to somewhere else is not a match.
const NON_US_RE =
  /\b(emea|apac|latam|europe|european|united kingdom|u\.?k\.?|canada|toronto|vancouver|india|bangalore|bengaluru|hyderabad|germany|berlin|munich|france|paris|spain|barcelona|madrid|poland|warsaw|krakow|portugal|lisbon|netherlands|amsterdam|ireland|dublin|israel|tel aviv|brazil|mexico|argentina|colombia|singapore|australia|sydney|japan|tokyo|china|shanghai|korea|philippines|vietnam|nigeria|kenya|south africa|switzerland|sweden|norway|denmark|finland|italy|romania|ukraine|turkey|uae|dubai)\b/i;

/**
 * Bucket a job's locations into one tracked metro, or "Remote".
 *
 * Two passes on purpose. A posting listed as ["Remote", "San Francisco"] should
 * count as San Francisco — it's a real desk in a metro we track — so every named
 * metro is ruled out across all of its locations before remote is considered.
 * A single loop would return whichever matched the first location string.
 */
function matchCity(locations) {
  for (const raw of locations) {
    if (!raw) continue;
    for (const m of CITY_MATCHERS) {
      if (m.re.test(raw)) return m.city;
    }
  }
  // Tested across the whole set, not per string: a posting listed as
  // ["Remote", "Bangalore, India"] is a remote role for India, and reading only
  // the bare "Remote" would admit it.
  if (locations.some((l) => l && NON_US_RE.test(l))) return null;
  for (const raw of locations) {
    if (!raw) continue;
    if (REMOTE_RE.test(raw)) return "Remote";
  }
  return null;
}

function matchRoles(title) {
  return ROLE_PATTERNS.filter((p) => p.re.test(title)).map((p) => p.key);
}

// Returns { roles, city } for an engineering role in a target city, else null.
function keep(title, locations) {
  if (!title) return null;
  if (EXCLUDE_TITLE.test(title)) return null;
  const roles = matchRoles(title);
  if (roles.length === 0) return null;
  const city = matchCity(locations);
  if (!city) return null;
  return { roles, city };
}

// Seniority is derived from the title rather than taken from a source field, because
// only the Consider boards publish one — deriving it keeps the filter meaningful for
// ATS-sourced roles too. Order matters: the first match wins.
const SENIORITY_RULES = [
  { key: "intern", label: "Intern", re: /\b(intern|internship|co[-\s]?op)\b/i },
  // "Member of Technical Staff" is an IC title at AI labs, not a Staff-level role —
  // it must be caught before the \bstaff\b rule below.
  { key: "mid", label: "Mid", re: /member of (the )?technical staff/i },
  { key: "exec", label: "Director+", re: /\b(vp|svp|evp|head of|chief|cto|cio|director)\b/i },
  { key: "manager", label: "Manager", re: /\b(manager|mgr)\b/i },
  { key: "staff", label: "Staff / Principal", re: /\b(staff|principal|distinguished|fellow|architect)\b/i },
  { key: "senior", label: "Senior", re: /\b(senior|sr\.?|lead)\b/i },
  { key: "junior", label: "Junior", re: /\b(junior|jr\.?|new grad|entry[-\s]level|early career|university grad|associate)\b/i },
];
const SENIORITY_LABELS = SENIORITY_RULES.reduce((o, r) => ((o[r.key] = r.label), o), { mid: "Mid" });

function deriveSeniority(title) {
  if (!title) return "mid";
  for (const r of SENIORITY_RULES) if (r.re.test(title)) return r.key;
  return "mid";
}

const SIZE_BUCKETS = [
  { key: "1-10", label: "1–10", max: 10 },
  { key: "11-50", label: "11–50", max: 50 },
  { key: "51-200", label: "51–200", max: 200 },
  { key: "201-1000", label: "201–1,000", max: 1000 },
  { key: "1000+", label: "1,000+", max: Infinity },
];

function sizeBucket(staffCount) {
  if (!staffCount || staffCount < 1) return null;
  return (SIZE_BUCKETS.find((b) => staffCount <= b.max) || SIZE_BUCKETS[SIZE_BUCKETS.length - 1]).key;
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    const k = (j.company + "|" + j.title + "|" + j.city).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

module.exports = {
  matchCity, matchRoles, keep, dedupe,
  deriveSeniority, sizeBucket,
  SENIORITY_LABELS, SIZE_BUCKETS,
};
