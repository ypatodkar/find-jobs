// Scrape configuration per firm. Consumed by scraper.js (server-side).
// platform: 'consider' | 'getro' | null  (null = no scrapeable portfolio board)
//
// Consider boards expose POST https://<host>/api-boards/search-jobs
// Getro boards expose POST https://api.getro.com/api/v2/collections/<networkId>/search/jobs

const BOARDS = {
  "andreessen-horowitz": { platform: "consider", host: "jobs.a16z.com", boardId: "andreessen-horowitz" },
  "sequoia-capital":     { platform: "consider", host: "jobs.sequoiacap.com", boardId: "sequoia-capital" },
  "lightspeed":          { platform: "consider", host: "jobs.lsvp.com", boardId: "lightspeed" },
  "nea":                 { platform: "consider", host: "careers.nea.com", boardId: "nea" },
  "norwest":             { platform: "consider", host: "careers.nvp.com", boardId: "norwest-venture-partners" },
  "bessemer":            { platform: "consider", host: "jobs.bvp.com", boardId: "bessemer-ventures" },
  "kleiner-perkins":     { platform: "consider", host: "jobs.kleinerperkins.com", boardId: "kleiner-perkins" },
  "greylock":            { platform: "consider", host: "jobs.greylock.com", boardId: "greylock-partners" },
  "ivp":                 { platform: "consider", host: "careers.ivp.com", boardId: "ivp" },
  "felicis":             { platform: "consider", host: "jobs.felicis.com", boardId: "felicis" },
  "point72-ventures":    { platform: "consider", host: "jobs.p72.vc", boardId: "point72-ventures" },
  "bain-capital-ventures": { platform: "consider", host: "jobs.baincapitalventures.com", boardId: "bain-ventures" },
  "forerunner":          { platform: "consider", host: "jobs.forerunnerventures.com", boardId: "forerunner-ventures" },
  "first-round":         { platform: "consider", host: "jobs.firstround.com", boardId: "first-round-capital" },
  "crv":                 { platform: "consider", host: "jobs.crv.com", boardId: "crv" },
  "initialized":         { platform: "consider", host: "jobs.initialized.com", boardId: "initialized" },
  "amplify":             { platform: "consider", host: "talent.amplifypartners.com", boardId: "amplify-partners" },
  "costanoa":            { platform: "consider", host: "jobs.costanoavc.com", boardId: "costanoa-ventures" },
  "gradient":            { platform: "consider", host: "careers.gradient.com", boardId: "gradient-ventures" },
  "playground-global":   { platform: "consider", host: "careers.playground.global", boardId: "playground-global" },
  "qed":                 { platform: "consider", host: "careers.qedinvestors.com", boardId: "qed-investors" },
  "zetta":               { platform: "consider", host: "careers.zettavp.com", boardId: "zetta-venture-partners" },

  "khosla":              { platform: "getro", host: "jobs.khoslaventures.com", networkId: 257 },
  "general-catalyst":    { platform: "getro", host: "jobs.generalcatalyst.com", networkId: 222 },
  "insight-partners":    { platform: "getro", host: "jobs.insightpartners.com", networkId: 246 },
  "menlo":               { platform: "getro", host: "jobs.menlovc.com", networkId: 767 },
  "redpoint":            { platform: "getro", host: "careers.redpoint.com", networkId: 189 },
  "craft":               { platform: "getro", host: "jobs.craftventures.com", networkId: 340 },
  "notable-capital":     { platform: "getro", host: "jobs.notablecap.com", networkId: 764 },
  "thrive":              { platform: "getro", host: "jobs.thrivecap.com", networkId: 2105 },
  "8vc":                 { platform: "getro", host: "jobs.8vc.com", networkId: 1005 },
  "lux-capital":         { platform: "getro", host: "jobs.luxcapital.com", networkId: 103 },
  "sapphire":            { platform: "getro", host: "jobs.sapphireventures.com", networkId: 199 },
  "dcvc":                { platform: "getro", host: "jobs.dcvc.com", networkId: 514 },
  "wing":                { platform: "getro", host: "careers.wing.vc", networkId: 43520 },
  "canaan":              { platform: "getro", host: "careers.canaan.com", networkId: 1419 },
  "homebrew":            { platform: "getro", host: "careers.homebrew.co", networkId: 440 },
  "signalfire":          { platform: "getro", host: "jobs.signalfire.com", networkId: 135 },
  "true-ventures":       { platform: "getro", host: "jobs.trueventures.com", networkId: 646 },
  "greycroft":           { platform: "getro", host: "jobs.greycroft.com", networkId: 616 },
  "madrona":             { platform: "getro", host: "jobs.madrona.com", networkId: 151 },
  "uncork":              { platform: "getro", host: "jobs.uncorkcapital.com", networkId: 247 },
  "basis-set":           { platform: "getro", host: "jobs.basisset.com", networkId: 619 },
  "lerer-hippeau":       { platform: "getro", host: "jobs.lererhippeau.com", networkId: 120 },
  "upfront":             { platform: "getro", host: "jobs.upfront.com", networkId: 184 },
  "innovation-endeavors": { platform: "getro", host: "jobs.innovationendeavors.com", networkId: 156 },
  "primary":             { platform: "getro", host: "jobs.primary.vc", networkId: 1124 },
  "scale-vp":            { platform: "getro", host: "jobs.scalevp.com", networkId: 776 },
  "georgian":            { platform: "getro", host: "careers.georgian.io", networkId: 14282 },
  "obvious":             { platform: "getro", host: "jobs.obvious.com", networkId: 69 },
  "nfx":                 { platform: "getro", host: "jobs.nfx.com", networkId: 307 },
  "sierra-ventures":     { platform: "getro", host: "careers.sierraventures.com", networkId: 825 },
  "freestyle":           { platform: "getro", host: "jobs.freestyle.vc", networkId: 108 },
  "m13":                 { platform: "getro", host: "jobs.m13.co", networkId: 318 },
  "glasswing":           { platform: "getro", host: "jobs.glasswing.vc", networkId: 215 },

  // Boards that exist but can't be scraped, with the reason surfaced in the UI.
  "accel":          { platform: null, host: "jobs.accel.com", reason: "Board is behind Cloudflare bot protection" },
  "index-ventures": { platform: null, host: "www.indexventures.com", reason: "Custom board, no public search API" },
  "iconiq":         { platform: null, host: "www.iconiq.com", reason: "Greenhouse board lists ICONIQ's own roles, not portfolio jobs" },
  "founders-fund":  { platform: null, host: "foundersfund.com", reason: "Portfolio directory only, no job listings" },
  "y-combinator":   { platform: null, host: "www.workatastartup.com", reason: "Requires a logged-in account" },

  // Firms that publish no portfolio job board at all.
  "coatue":       { platform: null, host: "coatue.com", reason: "No public portfolio job board" },
  "tiger-global": { platform: null, host: "tigerglobal.com", reason: "No public portfolio job board" },
  "battery":      { platform: null, host: "batteryventures.com", reason: "No public portfolio job board" },
  "benchmark":    { platform: null, host: "benchmark.com", reason: "No public portfolio job board" },
  "mayfield":     { platform: null, host: "mayfield.com", reason: "No public portfolio job board" },
  "emergence":    { platform: null, host: "emergencecap.com", reason: "No public portfolio job board" },
  "conviction":   { platform: null, host: "conviction.com", reason: "AI-native specialist — publishes no portfolio job board" },
  "radical":      { platform: null, host: "radical.vc", reason: "AI-native specialist — publishes no portfolio job board" },
  "aix":          { platform: null, host: "aix.vc", reason: "AI-native specialist — publishes no portfolio job board" },
  "air-street":   { platform: null, host: "airstreet.com", reason: "AI-native specialist — publishes no portfolio job board" },
};

// Companies excluded everywhere, whatever board they surface on.
//
// Matched on all three of name, domain and ATS slug, because one company arrives under
// all three across our sources: a16z's board calls it "TENEX.AI", the company record
// carries the domain tenex.ai, and the apply URL is jobs.ashbyhq.com/tenex. Blocking
// the slug too means phase 2 never even fetches their board.
//
// Names are compared with punctuation and case stripped, so "TENEX.AI", "Tenex.ai" and
// "tenex ai" all collapse to the same key.
const BLOCKED_COMPANIES = [
  { domain: "tenex.ai", names: ["tenex.ai", "tenex"], slugs: ["tenex"] },
];

// Metro areas we track. Each carries the query values the two VC-board platforms
// accept (their vocabularies differ, and some metros exist on only one) plus the
// pattern that buckets a raw location string — which is what the ATS phase uses,
// since a company's own board is filtered locally rather than by query.
//
// Order matters: the first matching pattern wins, so Seattle sits above Washington
// DC ("Seattle, Washington"). The UI starts with no city selected, which means all
// tracked metros.
const METROS = [
  { city: "San Francisco", re: /san\s*francisco/i,
    consider: ["San Francisco, California"], getro: ["San Francisco, CA, USA"] },
  { city: "New York", re: /new\s*york|\bnyc\b|brooklyn|manhattan/i,
    consider: ["New York, New York", "Brooklyn, New York"], getro: ["New York, NY, USA", "Brooklyn, NY, USA"] },
  { city: "San Diego", re: /san\s*diego/i,
    consider: ["San Diego, California"], getro: ["San Diego, CA, USA"] },

  { city: "Bay Area", re: /palo alto|mountain view|menlo park|sunnyvale|santa clara|redwood city|san jose|oakland|berkeley|cupertino|fremont|foster city|san mateo|burlingame|milpitas/i,
    consider: ["Palo Alto, California", "Mountain View, California", "Menlo Park, California", "Sunnyvale, California", "Santa Clara, California", "Redwood City, California", "San Jose, California", "Oakland, California", "Berkeley, California"],
    getro: ["Palo Alto, CA, USA", "Mountain View, CA, USA", "Menlo Park, CA, USA", "Sunnyvale, CA, USA", "Santa Clara, CA, USA", "Redwood City, CA, USA", "San Jose, CA, USA", "Oakland, CA, USA"] },

  { city: "Seattle", re: /seattle|bellevue|redmond,\s*w|kirkland/i,
    consider: ["Seattle, Washington", "Bellevue, Washington"], getro: ["Seattle, WA, USA", "Bellevue, WA, USA"] },
  { city: "Los Angeles", re: /los angeles|santa monica|pasadena|culver city|el segundo/i,
    consider: ["Los Angeles, California", "Santa Monica, California"], getro: ["Los Angeles, CA, USA", "Santa Monica, CA, USA"] },
  { city: "Austin", re: /austin/i, consider: ["Austin, Texas"], getro: ["Austin, TX, USA"] },
  { city: "Boston", re: /boston|cambridge,\s*(ma|massachusetts)|somerville/i,
    consider: ["Boston, Massachusetts", "Cambridge, Massachusetts"], getro: ["Boston, MA, USA", "Cambridge, MA, USA"] },
  { city: "Chicago", re: /chicago/i, consider: ["Chicago, Illinois"], getro: ["Chicago, IL, USA"] },
  { city: "Denver", re: /denver|boulder/i, consider: ["Denver, Colorado", "Boulder, Colorado"], getro: ["Denver, CO, USA", "Boulder, CO, USA"] },
  { city: "Atlanta", re: /atlanta/i, consider: ["Atlanta, Georgia"], getro: ["Atlanta, GA, USA"] },
  // Consider has no working Washington DC value; Arlington covers the metro there.
  { city: "Washington DC", re: /washington,?\s*(dc|d\.c\.|district)|arlington,\s*v|alexandria,\s*v|bethesda|reston|mclean/i,
    consider: ["Arlington, Virginia"], getro: ["Washington, DC, USA", "Arlington, VA, USA"] },
  { city: "Dallas", re: /dallas|fort worth|plano/i, consider: ["Dallas, Texas"], getro: ["Dallas, TX, USA"] },
  { city: "Philadelphia", re: /philadelphia/i, consider: ["Philadelphia, Pennsylvania"], getro: ["Philadelphia, PA, USA"] },
  { city: "Portland", re: /portland,\s*(or|oregon)/i, consider: ["Portland, Oregon"], getro: ["Portland, OR, USA"] },
  { city: "Salt Lake City", re: /salt lake city|lehi|provo/i, consider: ["Salt Lake City, Utah"], getro: ["Salt Lake City, UT, USA"] },
  { city: "Miami", re: /miami/i, consider: [], getro: ["Miami, FL, USA"] },
  { city: "Raleigh–Durham", re: /raleigh|durham,\s*n|chapel hill/i, consider: ["Raleigh, North Carolina"], getro: ["Raleigh, NC, USA"] },
  { city: "Nashville", re: /nashville/i, consider: ["Nashville, Tennessee"], getro: ["Nashville, TN, USA"] },
];

// Getro accepts "Remote" as a searchable location. Consider has no equivalent — every
// spelling of it returns zero rows — so remote roles from Consider-backed firms reach
// us only through the ATS phase, which filters locations locally.
const LOCATIONS = {
  consider: METROS.flatMap((m) => m.consider),
  getro: [...METROS.flatMap((m) => m.getro), "Remote"],
};

const CITY_MATCHERS = METROS.map((m) => ({ city: m.city, re: m.re }));

// A role is kept if its title matches at least one pattern here.
//
// Deliberately an allow-list of named software disciplines rather than a catch-all
// on /\bengineer\b/. Several portfolios are hardware-heavy (Anduril, Waymo, Nuro),
// and a catch-all pulls in Mechanical, Power Electronics and FPGA Verification
// roles — real engineering, but not what this board is for. Anything that matches
// no pattern is dropped, so hardware titles need no exclusion of their own.
const ROLE_PATTERNS = [
  { key: "ai", label: "AI / ML", re: /\b(a\.?i\.?|artificial intelligence|machine learning|ml|mlops|llms?|genai|gen[-\s]ai|deep learning|nlp|computer vision|applied scientist|research engineer|research scientist|agentic|agents?|foundation models?|inference|rag|fine[-\s]?tuning|perception|robot learning)\b/i },
  { key: "backend", label: "Backend", re: /\b(back[-\s]?end|server[-\s]?side|api engineer|distributed systems)\b/i },
  { key: "infra", label: "Infra / Platform", re: /\b(platform engineer|infrastructure|infra engineer|systems engineer|site reliability|sre|devops|cloud engineer)\b/i },
  { key: "fullstack", label: "Full-stack", re: /\bfull[-\s]?stack\b/i },
  { key: "frontend", label: "Frontend", re: /\b(front[-\s]?end|web engineer|ui engineer)\b/i },
  // "Data Center Engineer" is a facilities role, so the data words are bound to the
  // discipline rather than matched loosely on /\bdata\b/.
  { key: "data", label: "Data", re: /\b(data (engineer\w*|scien\w+|platform|infrastructure|architect)|analytics engineer|database engineer|etl engineer|machine learning data)\b/i },
  { key: "security", label: "Security", re: /\b(security engineer\w*|application security|appsec|infosec|information security|security architect|product security|offensive security|detection engineer|cryptograph\w+)\b/i },
  // Bound to engineer/developer so "Android" or "iOS" inside a product name doesn't
  // sweep in non-engineering roles.
  { key: "mobile", label: "Mobile", re: /\b(ios|android|mobile)\s+(engineer\w*|developer)\b|\breact native\b/i },
  // Forward Deployed Engineer was the single most-dropped title on the VC boards —
  // it is the canonical AI-startup field-engineering role.
  { key: "solutions", label: "Solutions / FDE", re: /\b(forward[-\s]?deployed|solutions?\s+(engineer\w*|architect)|customer engineer|integration engineer|implementation engineer|deployment engineer|technical solutions)\b/i },
  { key: "qa", label: "QA / Test", re: /\b(qa engineer|quality engineer|quality assurance|sdet|test engineer|test automation|automation engineer)\b/i },
  { key: "swe", label: "Software Eng", re: /\b(software engineer|software development engineer|software developer|sde|swe|member of technical staff|founding engineer|engineering manager|staff engineer|principal engineer)\b/i },
];

// Non-engineering roles that slip through the platform's own function filter.
const EXCLUDE_TITLE = /\b(recruit\w*|sourcer|talent partner|sales|account executive|account manager|marketing|brand|designer|design lead|people ops|human resources|controller|accountant|counsel|legal|paralegal|customer support|customer success|program manager|product manager|product marketing|community|content writer|copywriter|executive assistant|office manager|business development|solutions consultant recruiter)\b/i;

module.exports = { BOARDS, METROS, LOCATIONS, CITY_MATCHERS, ROLE_PATTERNS, EXCLUDE_TITLE, BLOCKED_COMPANIES };
