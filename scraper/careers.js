// Follow actual careers links, rather than guessing ATS slugs from company names.
const dns = require("node:dns/promises");
const net = require("node:net");
const { detectAts } = require("./ats");
const { domainOf } = require("./registry");

function privateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  // Public IPv6 unicast; reject loopback, link-local, private and mapped IPv4.
  return !/^[23][0-9a-f]{3}:/i.test(address);
}
async function checkPublicUrl(raw) {
  const url = new URL(raw);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) {
    throw new Error("Careers discovery requires a public HTTP(S) URL");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("Private careers URL rejected");
  return url;
}
async function readPage(raw) {
  let url = raw;
  for (let redirects = 0; redirects < 5; redirects++) {
    await checkPublicUrl(url);
    const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(12000), headers: { "user-agent": "FindJobs-Careers/1.0", accept: "text/html" } });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw new Error("Careers redirect missing location");
      url = new URL(location, url).href;
      // An ATS redirect already identifies the board; no need to download its UI.
      if (detectAts(url)) return { url, html: "" };
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error(`Careers HTTP ${res.status}`); }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) throw new Error("Careers page exceeds 2 MB");
      chunks.push(chunk);
    }
    return { url, html: Buffer.concat(chunks).toString("utf8") };
  }
  throw new Error("Too many careers redirects");
}

function linksFrom(html, base) {
  const links = new Set();
  const decoded = html.replace(/&amp;/g, "&").replace(/\\\//g, "/");
  const patterns = [/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi, /https:\/\/(?:jobs\.ashbyhq\.com|(?:boards|job-boards)\.greenhouse\.io|jobs\.lever\.co)\/[^\s"'<>\\]+/gi];
  for (const re of patterns) for (const match of decoded.matchAll(re)) {
    try {
      const url = new URL(match[1] || match[0], base);
      if (["https:", "http:"].includes(url.protocol)) links.add(url.href);
    } catch { /* malformed link */ }
  }
  return [...links];
}

async function resolveCareers(company, { read = readPage } = {}) {
  const domain = domainOf(company.meta?.domain);
  const queue = [...new Set([company.careersUrl, domain && `https://${domain}`].filter(Boolean))];
  const visited = new Set(), candidates = new Map(), errors = [];
  while (queue.length && visited.size < 5) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    const direct = detectAts(url);
    if (direct) { candidates.set(`${direct.ats}:${direct.slug}`, { ...direct, url }); continue; }
    try {
      const page = await read(url);
      const urls = [page.url, ...linksFrom(page.html, page.url)];
      for (const link of urls) {
        const ats = detectAts(link);
        if (ats) { candidates.set(`${ats.ats}:${ats.slug}`, { ...ats, url: link }); continue; }
        const target = new URL(link), host = domainOf(page.url);
        const related = target.hostname === host || target.hostname.endsWith(`.${host}`) || (domain && (target.hostname === domain || target.hostname.endsWith(`.${domain}`)));
        if (related && /career|\/jobs(?:\/|$)|join[-_/]?us|join[-_/]?the[-_/]?team/i.test(target.href) && !visited.has(link)) queue.push(link);
      }
    } catch (err) { errors.push(err.message); }
  }
  return { candidates: [...candidates.values()], errors };
}
module.exports = { resolveCareers, linksFrom, readPage, checkPublicUrl, privateAddress };
