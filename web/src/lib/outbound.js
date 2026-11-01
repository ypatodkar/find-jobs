// Links out of the site say where the visitor came from, the way the VC boards already
// tag theirs (utm_source=jobs.lsvp.com, jobs.sequoiacap.com, …). The ATS behind a
// posting (Ashby, Greenhouse, Lever, Gem) and a company's own analytics read it, so an
// application or a visit sent from here is credited to this site.
//
// Only the link changes, never the job's stored url. The rest of the address is kept
// byte for byte: re-serialising it through URLSearchParams would re-encode parameters
// some boards sign or read literally. A utm_source already there (the scraped VC
// board's) is replaced, since the visitor is now coming from here.
const SOURCE = "jobs.ypatodkar.com";

export function withSource(url) {
  if (typeof url !== "string" || !/^https?:\/\/[^/?#]/i.test(url)) return url;
  const at = url.indexOf("#");
  const base = at < 0 ? url : url.slice(0, at);
  const hash = at < 0 ? "" : url.slice(at);
  const tag = "utm_source=" + SOURCE;
  if (/[?&]utm_source=/.test(base)) return base.replace(/([?&])utm_source=[^&]*/g, "$1" + tag) + hash;
  const joiner = !base.includes("?") ? "?" : /[?&]$/.test(base) ? "" : "&";
  return base + joiner + tag + hash;
}
