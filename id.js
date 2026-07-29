// Stable per-posting identity.
//
// Click counts are stored against a job id, so that id has to survive a re-scrape.
// The dedupe key used elsewhere (company|title|city) does not: a company editing
// "Software Engineer" to "Software Engineer, Backend" would silently reset the
// count, and two genuinely different openings with the same title in the same city
// would collide into one.
//
// An ATS's own posting id has neither problem, and we can always recover it —
// either from the API record or from the apply URL. Roles that only ever appear on
// a VC board have no such id and fall back to a hash: weaker, but stable for as
// long as the title and city hold.

const crypto = require("crypto");

const slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const hash8 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 8);

/**
 * `{company}_{ats}_{posting id}` where we know the ATS posting, else
 * `{company}_vc_{hash}`. Note that a company migrating between ATSes restarts its
 * ids — rare enough to accept, and the alternative (dropping the ats segment)
 * risks a numeric Greenhouse id colliding with something else.
 */
function jobId({ company, ats, atsId, title, city }) {
  const co = slug(company) || "unknown";
  if (ats && atsId) return `${co}_${ats}_${slug(atsId)}`;
  return `${co}_vc_${hash8(`${title || ""}|${city || ""}`.toLowerCase())}`;
}

module.exports = { jobId, slug };
