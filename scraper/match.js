// Shared role/city matching, used by both the VC-board scraper and the ATS adapters
// so a job is judged identically no matter which source it came from.

const { CITY_MATCHERS, INDIA_METROS, ROLE_PATTERNS, EXCLUDE_TITLE, BLOCKED_COMPANIES } = require("./boards");

// Punctuation and case carry no meaning in a company name here: "TENEX.AI", "Tenex.ai"
// and "Tenex AI" are the same employer, and boards disagree about which to publish.
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const hostKey = (s) => String(s || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];

const BLOCKED_NAMES = new Set(BLOCKED_COMPANIES.flatMap((b) => (b.names || []).map(nameKey)));
const BLOCKED_DOMAINS = BLOCKED_COMPANIES.map((b) => b.domain).filter(Boolean).map(hostKey);
const BLOCKED_SLUGS = new Set(BLOCKED_COMPANIES.flatMap((b) => (b.slugs || []).map((s) => String(s).toLowerCase())));

/**
 * True for a company we never list, matched on any of the three identifiers a source
 * might give us. Checked at both scrape phases so a blocked company is dropped from
 * board results and never has its own ATS board fetched at all.
 */
function isBlockedCompany({ company, domain, slug } = {}) {
  if (company && BLOCKED_NAMES.has(nameKey(company))) return true;
  if (slug && BLOCKED_SLUGS.has(String(slug).toLowerCase())) return true;
  if (domain) {
    const host = hostKey(domain);
    // endsWith covers a subdomain like careers.tenex.ai without matching nottenex.ai.
    if (BLOCKED_DOMAINS.some((d) => host === d || host.endsWith("." + d))) return true;
  }
  return false;
}

/**
 * Whether an apply link belongs to the company itself: its name is in the link's host
 * (altruist.com) or ATS slug (jobs.lever.co/zoox). A board that keeps a company after
 * selling it lists the buyer's openings under the old name, and those links name the
 * buyer instead (OfferFit's go to greenhouse.io/braze, Instana's to careers.ibm.com).
 */
function isOwnLink({ company, url, slug } = {}) {
  const key = nameKey(company);
  if (!key) return false;
  return nameKey(hostKey(url)).includes(key) || (!!slug && nameKey(slug).includes(key));
}

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

// India, by name or by state. Never by "IN": that is also Indiana's code, and
// "Indianapolis, IN" is a US posting.
const INDIA_RE = /\b(india|karnataka|maharashtra|telangana|tamil nadu|haryana|uttar pradesh|gujarat|kerala|west bengal|rajasthan|andhra pradesh|madhya pradesh|odisha|punjab|chandigarh|goa)\b/i;

/**
 * The India list's bucket for a posting: one of INDIA_METROS, "Remote (India)", or
 * "Other India" for an Indian city outside them. Null when no location is in India.
 * A named metro wins over remote, for the same reason as in matchCity.
 */
function matchIndiaCity(locations) {
  for (const raw of locations) {
    if (!raw) continue;
    for (const m of INDIA_METROS) if (m.re.test(raw)) return m.city;
  }
  if (!locations.some((l) => l && INDIA_RE.test(l))) return null;
  return locations.some((l) => l && REMOTE_RE.test(l)) ? "Remote (India)" : "Other India";
}

const COUNTRY_MATCHERS = { US: matchCity, IN: matchIndiaCity };

/**
 * Every tracked country a posting is in, as [{ city, country }], US first. A role
 * listed in San Francisco and Bengaluru is both a US and an Indian opening, so it gets
 * a row in each list. `countries` limits which are looked for.
 */
function matchPlaces(locations, countries = ["US"]) {
  const out = [];
  for (const country of countries) {
    const city = COUNTRY_MATCHERS[country] && COUNTRY_MATCHERS[country](locations);
    if (city) out.push({ city, country });
  }
  return out;
}

function matchRoles(title) {
  return ROLE_PATTERNS.filter((p) => p.re.test(title)).map((p) => p.key);
}

// Returns { roles, city, country, places } for an engineering role in a tracked city,
// else null. `city` and `country` are the first place found (US before India);
// `places` is all of them. By default only US cities count, as before India existed.
function keep(title, locations, countries = ["US"]) {
  if (!title) return null;
  if (EXCLUDE_TITLE.test(title)) return null;
  const roles = matchRoles(title);
  if (roles.length === 0) return null;
  const places = matchPlaces(locations, countries);
  if (!places.length) return null;
  return { roles, city: places[0].city, country: places[0].country, places };
}

/**
 * One row per place a kept posting is in. The first row is `row` itself, unchanged,
 * so a US role keeps the job id it had before India was tracked; each further place
 * gets a copy with that place's city and its own id from `idFor(city)`.
 */
function placeRows(row, hit, idFor) {
  const rows = [inCountry({ ...row, country: hit.places[0].country })];
  for (const p of hit.places.slice(1)) rows.push(inCountry({ ...row, city: p.city, country: p.country, job_id: idFor(p.city) }));
  return rows;
}

// A dollar figure on an Indian row is the US range of a posting open in both
// countries, or a board's guess ($5k–$30k a year for a Databricks engineer), never an
// Indian salary; those are published in rupees. So an Indian row keeps INR pay only.
function inCountry(row) {
  if (row.country !== "IN" || (!row.salary && !row.salaryMin) || /\bINR\b|₹/.test(row.salary || "")) return row;
  return { ...row, salaryMin: null, salaryMax: null, salary: null };
}

// Where a posting is, by country, for telling where a company is based: "US", "IN",
// "other" for another named country, or null when it doesn't say (bare "Remote").
const US_RE = /\b(united states|usa|u\.s\.a?\.?|[a-z .]+,\s*(al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc))\b/i;
function countryOf(locations) {
  const places = (locations || []).filter(Boolean);
  if (!places.length) return null;
  // A US metro first: a role listed in New York and Bengaluru is most often a US
  // company's, hiring in both.
  const us = matchCity(places);
  if (us && us !== "Remote") return "US";
  if (matchIndiaCity(places)) return "IN";
  if (places.some((l) => US_RE.test(l))) return "US";
  if (places.some((l) => NON_US_RE.test(l))) return "other";
  return null;
}

/**
 * Where a company is based, from the postings it publishes: the country most of its
 * located openings are in. `mix` is a { US, IN, other } count. A ".in" website settles
 * it outright; with no evidence at all, `fallback` (the country of the investor that
 * listed it) is used. Ties go to the US, then India.
 */
function companyCountry({ domain, mix, fallback = "US" } = {}) {
  if (/\.(in|co\.in)$/i.test(hostKey(domain))) return "IN";
  const m = mix || {};
  const total = (m.US || 0) + (m.IN || 0) + (m.other || 0);
  if (!total) return fallback;
  if ((m.US || 0) >= (m.IN || 0) && (m.US || 0) >= (m.other || 0)) return "US";
  if ((m.IN || 0) >= (m.other || 0)) return "IN";
  return "other";
}

/** Tally countryOf over a list of postings' location arrays. */
function countryMix(locationLists) {
  const mix = { US: 0, IN: 0, other: 0 };
  for (const locs of locationLists) {
    const c = countryOf(locs);
    if (c) mix[c]++;
  }
  return mix;
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
  matchCity, matchIndiaCity, matchPlaces, matchRoles, keep, placeRows, inCountry, countryOf, countryMix, companyCountry,
  dedupe, isBlockedCompany, isOwnLink,
  deriveSeniority, sizeBucket,
  SENIORITY_LABELS, SIZE_BUCKETS,
};
