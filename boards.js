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

  "khosla":              { platform: "getro", host: "jobs.khoslaventures.com", networkId: 257 },
  "general-catalyst":    { platform: "getro", host: "jobs.generalcatalyst.com", networkId: 222 },
  "insight-partners":    { platform: "getro", host: "jobs.insightpartners.com", networkId: 246 },
  "menlo":               { platform: "getro", host: "jobs.menlovc.com", networkId: 767 },
  "redpoint":            { platform: "getro", host: "careers.redpoint.com", networkId: 189 },
  "craft":               { platform: "getro", host: "jobs.craftventures.com", networkId: 340 },
  "notable-capital":     { platform: "getro", host: "jobs.notablecap.com", networkId: 764 },
  "thrive":              { platform: "getro", host: "jobs.thrivecap.com", networkId: 2105 },

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
  "ivp":          { platform: null, host: "ivp.com", reason: "No public portfolio job board" },
  "crv":          { platform: null, host: "crv.com", reason: "No public portfolio job board" },
  "mayfield":     { platform: null, host: "mayfield.com", reason: "No public portfolio job board" },
  "emergence":    { platform: null, host: "emergencecap.com", reason: "No public portfolio job board" },
  "scale-vp":     { platform: null, host: "scalevp.com", reason: "No public portfolio job board" },
  "sapphire":     { platform: null, host: "sapphireventures.com", reason: "No public portfolio job board" },
  "conviction":   { platform: null, host: "conviction.com", reason: "AI-native specialist — publishes no portfolio job board" },
  "radical":      { platform: null, host: "radical.vc", reason: "AI-native specialist — publishes no portfolio job board" },
  "aix":          { platform: null, host: "aix.vc", reason: "AI-native specialist — publishes no portfolio job board" },
  "amplify":      { platform: null, host: "amplifypartners.com", reason: "AI-native specialist — publishes no portfolio job board" },
  "basis-set":    { platform: null, host: "basisset.com", reason: "AI-native specialist — publishes no portfolio job board" },
  "air-street":   { platform: null, host: "airstreet.com", reason: "AI-native specialist — publishes no portfolio job board" },
};

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

const LOCATIONS = {
  consider: METROS.flatMap((m) => m.consider),
  getro: METROS.flatMap((m) => m.getro),
};

const CITY_MATCHERS = METROS.map((m) => ({ city: m.city, re: m.re }));

// A role is kept if its title matches at least one pattern here.
const ROLE_PATTERNS = [
  { key: "ai", label: "AI / ML", re: /\b(a\.?i\.?|artificial intelligence|machine learning|ml|mlops|llms?|genai|gen[-\s]ai|deep learning|nlp|computer vision|applied scientist|research engineer|research scientist|agentic|agents?|foundation models?|inference|rag|fine[-\s]?tuning|perception|robot learning)\b/i },
  { key: "backend", label: "Backend", re: /\b(back[-\s]?end|server[-\s]?side|api engineer|distributed systems)\b/i },
  { key: "infra", label: "Infra / Platform", re: /\b(platform engineer|infrastructure|infra engineer|systems engineer|site reliability|sre|devops|cloud engineer)\b/i },
  { key: "fullstack", label: "Full-stack", re: /\bfull[-\s]?stack\b/i },
  { key: "frontend", label: "Frontend", re: /\b(front[-\s]?end|web engineer|ui engineer)\b/i },
  { key: "swe", label: "Software Eng", re: /\b(software engineer|software development engineer|software developer|sde|swe|member of technical staff|engineering manager|staff engineer|principal engineer)\b/i },
];

// Non-engineering roles that slip through the platform's own function filter.
const EXCLUDE_TITLE = /\b(recruit\w*|sourcer|talent partner|sales|account executive|account manager|marketing|brand|designer|design lead|people ops|human resources|controller|accountant|counsel|legal|paralegal|customer support|customer success|program manager|product manager|product marketing|community|content writer|copywriter|executive assistant|office manager|business development|solutions consultant recruiter)\b/i;

module.exports = { BOARDS, METROS, LOCATIONS, CITY_MATCHERS, ROLE_PATTERNS, EXCLUDE_TITLE };
