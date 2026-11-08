// Indian investors' portfolios, company by company (sources in india.js).
//
//   1. Each firm's portfolio, weekly: the companies and their websites, from the
//      portfolio page's links out, its links to the firm's own page for each company,
//      and the sitemap's list of those pages. Those pages are then opened for the
//      company's website.
//   2. Each new website's careers system (careers.js), and every unresolved one again
//      after a month, a bounded number per run.
//   3. A company found on a supported system (ats.js) joins the registry, credited to
//      every firm that lists it, and is refreshed with the rest from then on.
//
// What is learnt is kept in state.portfolio beside the registry, so a website that has
// no readable careers system is not re-crawled every run.

const { INDIA_PORTFOLIOS } = require("./india");
const { resolveCareers } = require("./careers");
const { isSupported } = require("./ats");
const { DAY, due, domainOf, observeCompany } = require("./registry");

const PORTFOLIO_INTERVAL = 7 * DAY;
const RESOLVE_INTERVAL = 30 * DAY;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

// Hosts that are never a portfolio company: social networks, news sites, site builders,
// CDNs and the like, by their registrable name.
const NOT_COMPANIES = new Set((
  "linkedin twitter x facebook fb instagram youtube youtu medium crunchbase tracxn apple google goo gl gstatic googleapis " +
  "googletagmanager whatsapp wa telegram github wordpress wp wix wixsite webflow squarespace cloudflare jsdelivr unpkg cdnjs " +
  "typekit gravatar vimeo spotify soundcloud substack bit tinyurl calendly hubspot mailchimp typeform notion airtable zoho " +
  "amazonaws cloudfront framer framerusercontent vercel netlify figma canva slideshare scribd issuu bloomberg reuters " +
  "economictimes indiatimes livemint moneycontrol inc42 yourstory techcrunch forbes vccircle entrackr thehindu " +
  "thehindubusinessline business-standard financialexpress hindustantimes ndtv cnbc cnbctv18 wsj nytimes ft businessinsider " +
  "the-ken w3 schema ogp gmpg creativecommons adobe microsoft office live outlook gmail yahoo bing recaptcha jquery " +
  "bootstrapcdn fontawesome cookiebot onetrust termly iubenda elfsight lottiefiles unsplash pexels giphy imgur flickr " +
  "pinterest reddit quora tiktok snapchat threads discord slack zoom eventbrite luma lu meetup angel wellfound f6s " +
  "startupindia gov nic sebi rbi itunes wsimg godaddy elementor wpengine sentry hotjar clarity segment intercom crisp tawk " +
  "freshchat zendesk doubleclick bootstrap cookieyes cookielaw usercentrics feedburner disqus addtoany sharethis addthis " +
  "pinimg twimg fbcdn licdn ytimg akamaized imagekit cloudinary sanity contentful prismic storyblok strapi ghost " +
  "wikipedia wikimedia pitchbook dealroom businesswire prnewswire globenewswire"
).split(/\s+/));
const NEWS = /(times|news|post|herald|journal|express|standard|tribune|mint|today|wire|daily|magazine|insider|gazette|chronicle)\b/i;
// A firm's own page for one company: /portfolio/{slug}, /companies/{slug} and kin.
const DETAIL = /^\/(?:[a-z-]+\/)?(portfolio|portfolios|companies|company|investments|investment|portfolio-companies|startups|our-portfolio|founders|family|bets)\/([^/?#]+)\/?$/i;

const label = (host) => {
  const parts = host.split(".");
  return (parts.length > 2 && /^(co|com|org|net|ac|gov)$/.test(parts.at(-2)) ? parts.at(-3) : parts.at(-2)) || host;
};
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; } };
const notCompany = (h) => !h || NOT_COMPANIES.has(label(h)) || NOT_COMPANIES.has(h.split(".")[0]) || NEWS.test(h);
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
  .replace(/&#8211;|&ndash;/g, "–").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const tokens = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length >= 4);

async function get(url, accept = "text/html,application/xhtml+xml") {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": UA, accept } });
  const body = res.ok ? (await res.text()).slice(0, 3_000_000) : (await res.body?.cancel(), "");
  return { status: res.status, url: res.url, body };
}

function anchors(html, base) {
  const out = [];
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1]);
    if (!href) continue;
    try { out.push({ url: new URL(href[1].replace(/&amp;/g, "&"), base).href, text: decode(m[2]).slice(0, 80) }); } catch { /* malformed */ }
  }
  return out;
}

// The readable form of a domain: "eka.care" → "Eka", "bolt-earth.com" → "Bolt Earth".
const domainName = (website) => label(hostOf(`https://${website}`) || website || "").replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// One candidate as a name, or null: the part before a tagline, never a link, a call to
// action, the firm's own page furniture or a sentence.
function asName(raw) {
  let n = decode(String(raw || "")).split(/\s*:\s+|\s+[|–—-]\s+|\s*[|–—]\s*/)[0].replace(/[*®™]+/g, "").replace(/^.*\bis now\s+/i, "")
    // A homepage served to a US visitor can name its US arm ("Razorpay USA").
    .replace(/\s+(usa|us|india|inc\.?|pvt\.? ltd\.?|private limited|limited|ltd\.?)$/i, "").trim();
  if (!n || /https?:|www\.|^[\w-]+(\.[\w-]+)+\/?$/i.test(n)) return null;
  if (/\b(visit|website|know more|learn more|read more|click here|explore|portfolio|newsletter|subscribe|home ?page|welcome)\b/i.test(n)) return null;
  if (n.length > 40 || n.split(/\s+/).length > 4) return null;
  return n;
}
// Whether a name and a website are the same company's: a word of one is in the other.
const sharesDomain = (name, website) => {
  const site = label(website || "").replace(/[^a-z0-9]/g, "");
  return String(name || "").toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 3 && (site.includes(w) || w.includes(site)));
};

/**
 * The name to list a company under, from candidates in order of preference. One that
 * matches its domain wins, cut back to the words up to the match ("Druva Resilience
 * Cloud" → "Druva"); then a short one; else the domain itself, because a confident
 * wrong name ("Razorpay POS Machine" for Ezetap) is worse than a plain right one.
 */
function cleanName(candidates, website) {
  const names = [].concat(candidates).map(asName).filter(Boolean);
  for (const n of names) {
    if (!sharesDomain(n, website)) continue;
    const words = n.split(/\s+/);
    const at = words.findIndex((w) => sharesDomain(w, website));
    return words.length > 2 ? words.slice(0, Math.max(at + 1, 1)).join(" ") : n;
  }
  const short = names.find((n) => n.split(/\s+/).length <= 2);
  return short || domainName(website);
}

// The name a domain gives on its own ("getlokalapp.com" → "Getlokalapp"): what
// cleanName falls back to, and the sign that a better name is worth looking for.
const fromDomain = (name, website) => !sharesDomain(name, website) || name === domainName(website);

/**
 * A company's own name for itself, from its homepage: og:site_name, else the first
 * part of the title. For companies whose portfolio entry was a bare logo link.
 */
async function brandName(website, read = get) {
  const { body } = await read(`https://${website}`);
  const site = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(body) ||
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i.exec(body);
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body);
  for (const raw of [site && site[1], title && title[1].split(/\s+[|–—:-]\s+|\s*[|–—]\s*/)[0]]) {
    const n = decode(raw || "");
    if (n && n.length <= 40 && !/^(home|homepage|welcome|index|untitled|404|access denied|just a moment)/i.test(n)) return n;
  }
  return null;
}

async function sitemapPages(host) {
  const seen = new Set(), pages = [];
  const queue = [`https://${host}/sitemap.xml`, `https://${host}/sitemap_index.xml`, `https://${host}/wp-sitemap.xml`];
  try {
    for (const m of (await get(`https://${host}/robots.txt`, "text/plain")).body.matchAll(/^sitemap:\s*(\S+)/gim)) queue.unshift(m[1]);
  } catch { /* no robots.txt */ }
  while (queue.length && seen.size < 25) {
    const u = queue.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    try {
      const r = await get(u, "application/xml,text/xml");
      if (!/<(urlset|sitemapindex)/i.test(r.body)) continue;
      for (const m of r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
        const loc = decode(m[1]);
        if (!/\.xml(\?|$)/i.test(loc)) pages.push(loc);
        // Nested sitemaps: skip the blog's and the tags', keep any that names companies.
        else if (!/post-sitemap|page-sitemap|category|tag|author|blog|news|insight/i.test(loc) || /portfolio|compan|invest/i.test(loc)) queue.push(loc);
      }
    } catch { /* unreachable sitemap */ }
  }
  return pages;
}

function detailPages(urls, host) {
  const out = new Map();
  for (const u of urls) {
    const h = hostOf(u);
    if (!h || label(h) !== label(host)) continue;
    let path;
    try { path = new URL(u).pathname; } catch { continue; }
    const m = DETAIL.exec(path);
    if (!m || /^(page|category|tag|all|index|feed)$/i.test(m[2]) || /\.(png|jpe?g|svg|pdf)$/i.test(m[2])) continue;
    out.set(path.replace(/\/$/, "").toLowerCase(), u.split("#")[0]);
  }
  return [...out.values()];
}

async function pool(items, n, work) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await work(items[i++]); }));
}

/**
 * One firm's portfolio as [{ website, name }]. Throws only when nothing at all could
 * be read, so a firm whose site is down keeps what it listed last time.
 */
async function extractPortfolio(cfg, { maxDetails = 700, read = get } = {}) {
  const host = hostOf(cfg.portfolio);
  const companies = new Map();
  const add = (h, name) => {
    if (notCompany(h)) return;
    const key = h.replace(/^(www|app|web|go|get|try|use)\./, "");
    const prior = companies.get(key);
    if (!prior) companies.set(key, { website: key, name: name || null });
    else if (name && !prior.name) prior.name = name;
  };

  let page = { body: "", url: cfg.portfolio };
  try { page = await read(cfg.portfolio); } catch { /* the sitemap may still list the companies */ }
  const sitemap = await sitemapPages(host);
  if (!page.body && !sitemap.length) throw new Error(`Portfolio page and sitemap both unreachable (${cfg.portfolio})`);

  // Links straight out to a company, where the anchor text is usually its name.
  const links = anchors(page.body, page.url);
  for (const a of links) {
    const h = hostOf(a.url);
    if (!h || label(h) === label(host) || new URL(a.url).pathname.length > 40) continue;
    add(h, a.text && a.text.length < 40 && !/visit|website|read|more/i.test(a.text) ? a.text : null);
  }

  // The firm's own page for each company, which links to the company's site. A link
  // every such page carries (a footer partner, the firm's other brand) is not one.
  const details = detailPages([...sitemap, ...links.map((a) => a.url)], host).slice(0, maxDetails);
  const seen = [];
  await pool(details, 6, async (u) => {
    const slug = DETAIL.exec(new URL(u).pathname)?.[2] || "";
    try {
      const r = await read(u);
      const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(r.body) || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(r.body);
      const candidates = [];
      for (const a of anchors(r.body, r.url)) {
        const h = hostOf(a.url);
        if (!h || label(h) === label(host) || notCompany(h)) continue;
        let score = 0;
        if (/website|visit|www\.|\.(com|in|ai|io|co|app|tech)\b|go to|know more|learn more/i.test(a.text)) score += 3;
        if (tokens(slug).some((t) => label(h).includes(t) || t.includes(label(h)))) score += 4;
        if (new URL(a.url).pathname.length > 30) score -= 1; // deep links are usually articles
        candidates.push({ host: h, score });
      }
      seen.push({ slug, name: og && og[1], candidates });
    } catch { /* one unreadable page */ }
  });
  const onPages = new Map();
  for (const s of seen) for (const h of new Set(s.candidates.map((c) => c.host))) onPages.set(h, (onPages.get(h) || 0) + 1);
  const common = (h) => seen.length >= 8 && onPages.get(h) > Math.max(3, seen.length * 0.3);
  for (const s of seen) {
    const c = s.candidates.filter((x) => !common(x.host)).sort((a, b) => b.score - a.score);
    if (c.length && (c[0].score > 0 || new Set(c.map((x) => x.host)).size === 1)) add(c[0].host, s.name);
  }
  return [...companies.values()].map((c) => ({ website: c.website, name: cleanName([c.name], c.website) }));
}

/**
 * The portfolio phase of a discovery run: read due portfolios, look for the careers
 * system of new and stale websites, and admit those on a supported system into the
 * registry. Mutates `state`.
 */
async function discoverPortfolios(state, options = {}) {
  const now = options.now || new Date().toISOString();
  const firms = options.portfolios || INDIA_PORTFOLIOS;
  const extract = options.extractPortfolio || extractPortfolio;
  const resolve = options.resolveCareers || resolveCareers;
  const onEvent = options.onEvent || (() => {});
  const p = (state.portfolio ||= { firms: {}, sites: {} });
  const summary = { firms: 0, firmErrors: [], resolved: 0, checked: 0, admitted: 0 };

  const dueFirms = Object.keys(firms).filter((id) => options.forceDiscovery ||
    (due(p.firms[id]?.lastDiscoveryAt, PORTFOLIO_INTERVAL, now) && due(p.firms[id]?.lastAttemptAt, DAY, now)));
  onEvent("phase", { phase: "portfolios", firms: dueFirms.length });
  await pool(dueFirms, 4, async (id) => {
    const prior = p.firms[id] || {};
    try {
      const companies = await extract(firms[id]);
      for (const c of companies) {
        const site = (p.sites[c.website] ||= { website: c.website, name: c.name, firms: [], firstSeenAt: now });
        if (!site.firms.includes(id)) site.firms.push(id);
        if (!site.name && c.name) site.name = c.name;
        site.lastSeenAt = now;
      }
      p.firms[id] = { lastDiscoveryAt: now, lastAttemptAt: now, lastError: null, companies: companies.length };
      summary.firms++;
    } catch (err) {
      p.firms[id] = { ...prior, lastAttemptAt: now, lastError: err.message };
      summary.firmErrors.push({ firmId: id, reason: err.message });
    }
    onEvent("progress", { phase: "portfolios", firmId: id, count: p.firms[id].companies ?? 0, error: p.firms[id].lastError });
  });

  // Never-checked websites first, then the longest unchecked. A known board is left to
  // the registry's own repair, which re-validates it when it starts failing.
  const pending = Object.values(p.sites)
    .filter((s) => !s.key && due(s.lastResolvedAt, RESOLVE_INTERVAL, now))
    .sort((a, b) => (a.lastResolvedAt || "").localeCompare(b.lastResolvedAt || ""))
    .slice(0, options.resolveLimit ?? 60);
  onEvent("phase", { phase: "portfolio-careers", sites: pending.length });
  await pool(pending, 6, async (site) => {
    summary.checked++;
    site.lastResolvedAt = now;
    try {
      const found = await resolve({ company: site.name, careersUrl: null, meta: { domain: site.website } });
      const hit = (found.candidates || []).find((c) => isSupported(c.ats));
      site.key = hit ? `${hit.ats}:${hit.slug}` : null;
      site.careersUrl = hit ? hit.url : null;
      site.error = hit ? null : (found.errors || [])[0] || "No supported careers system found";
      if (hit) summary.resolved++;
      // Only a company about to be listed is worth the extra request.
      if (hit && fromDomain(site.name, site.website)) {
        const brand = await (options.brandName || brandName)(site.website).catch(() => null);
        site.name = cleanName([brand, site.name], site.website);
      }
    } catch (err) { site.error = err.message; }
  });

  // Admit, or credit, every website on a supported system.
  const before = Object.keys(state.companies).length;
  for (const site of Object.values(p.sites)) {
    if (!site.key || !site.careersUrl) continue;
    const exists = Object.values(state.companies).find((co) => co.key === site.key);
    if (exists && site.firms.every((id) => exists.firms.includes(id))) continue;
    for (const firmId of site.firms) {
      const host = domainOf(firms[firmId]?.portfolio);
      observeCompany(state, { company: site.name, url: site.careersUrl, domain: site.website }, { firmId, sourceUrl: host ? `https://${host}` : null, now });
    }
  }
  summary.admitted = Object.keys(state.companies).length - before;
  onEvent("done-portfolios", summary);
  return summary;
}

module.exports = { extractPortfolio, discoverPortfolios, cleanName, brandName, fromDomain, detailPages, PORTFOLIO_INTERVAL, RESOLVE_INTERVAL };
