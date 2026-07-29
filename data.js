// VC directory data. Edit this array to add/update firms — the UI re-renders from it automatically.
// tier: 'ai-mega' | 'generalist' | 'ai-native' | 'accelerator'
// signal: 1 (software-first, AI opportunistic) – 2 (heavy, growing AI allocation) – 3 (AI is the primary thesis)
// url: portfolio job board or firm site; null when no confirmed public link exists
// noBoard: true when url points to the firm's main site rather than a dedicated jobs board

const VC_FIRMS = [
  // --- AI-first & AI-heavy mega funds ---
  { id: "andreessen-horowitz", name: "Andreessen Horowitz", short: "a16z", tier: "ai-mega", aum: "~$90B AUM", focus: "Full-stack generalist with dedicated AI infra & apps funds", signal: 3, note: "OpenAI, World Labs, Databricks", url: "https://jobs.a16z.com", urlLabel: "jobs.a16z.com", inList: true, noBoard: false },
  { id: "sequoia-capital", name: "Sequoia Capital", tier: "ai-mega", aum: "~$56B AUM", focus: "Seed through growth; enterprise software backbone", signal: 3, note: "OpenAI, xAI", url: "https://jobs.sequoiacap.com", urlLabel: "jobs.sequoiacap.com", inList: true, noBoard: false },
  { id: "thrive", name: "Thrive Capital", tier: "ai-mega", aum: null, focus: "Concentrated growth bets, software-first", signal: 3, note: "Lead across multiple OpenAI rounds", url: "https://jobs.thrivecap.com", urlLabel: "jobs.thrivecap.com", inList: true, noBoard: false },
  { id: "founders-fund", name: "Founders Fund", tier: "ai-mega", aum: null, focus: "Contrarian deep tech & software", signal: 3, note: "Anthropic, Safe Superintelligence", url: "https://foundersfund.com/portfolio/", urlLabel: "foundersfund.com/portfolio", inList: true, noBoard: false },
  { id: "khosla", name: "Khosla Ventures", tier: "ai-mega", aum: null, focus: "Early-stage, high-conviction technical bets", signal: 3, note: "OpenAI's earliest major VC backer", url: "https://jobs.khoslaventures.com/jobs", urlLabel: "jobs.khoslaventures.com", inList: false, noBoard: false },
  { id: "general-catalyst", name: "General Catalyst", tier: "ai-mega", aum: null, focus: "Software + health, “global growth investing”", signal: 2, note: "Anthropic, applied-AI health bets", url: "https://jobs.generalcatalyst.com", urlLabel: "jobs.generalcatalyst.com", inList: false, noBoard: false },
  { id: "coatue", name: "Coatue Management", tier: "ai-mega", aum: null, focus: "Crossover hedge fund / VC, tech-concentrated", signal: 3, note: "Heavy in AI mega-rounds", url: "https://coatue.com", urlLabel: "coatue.com", inList: false, noBoard: true },
  { id: "insight-partners", name: "Insight Partners", tier: "ai-mega", aum: "~$90B AUM", focus: "Enterprise software growth equity", signal: 2, note: "Expanding AI infra/apps thesis", url: "https://jobs.insightpartners.com/jobs", urlLabel: "jobs.insightpartners.com", inList: false, noBoard: false },
  { id: "tiger-global", name: "Tiger Global Management", tier: "ai-mega", aum: "~$58.5B AUM", focus: "Cross-stage internet & software", signal: 2, note: "Broad AI mega-round participant", url: "https://tigerglobal.com", urlLabel: "tigerglobal.com", inList: false, noBoard: true },
  { id: "iconiq", name: "ICONIQ Growth", tier: "ai-mega", aum: null, focus: "Growth-stage enterprise SaaS & AI", signal: 2, note: "OpenAI, enterprise AI stack", url: "https://job-boards.greenhouse.io/iconiq", urlLabel: "iconiq careers", inList: false, noBoard: false },

  // --- Software & growth generalists ---
  { id: "accel", name: "Accel", tier: "generalist", aum: null, focus: "Enterprise & consumer software, all stages", signal: 2, note: null, url: "https://jobs.accel.com", urlLabel: "jobs.accel.com", inList: true, noBoard: false },
  { id: "kleiner-perkins", name: "Kleiner Perkins", tier: "generalist", aum: null, focus: "Storied Sand Hill Road generalist", signal: 2, note: null, url: "https://jobs.kleinerperkins.com", urlLabel: "jobs.kleinerperkins.com", inList: true, noBoard: false },
  { id: "nea", name: "New Enterprise Associates", short: "NEA", tier: "generalist", aum: null, focus: "One of the largest multi-stage generalists", signal: 1, note: null, url: "https://careers.nea.com", urlLabel: "careers.nea.com", inList: true, noBoard: false },
  { id: "bessemer", name: "Bessemer Venture Partners", tier: "generalist", aum: null, focus: "Cloud/SaaS pioneer, “roadmap” theses", signal: 2, note: null, url: "https://jobs.bvp.com", urlLabel: "jobs.bvp.com", inList: true, noBoard: false },
  { id: "lightspeed", name: "Lightspeed Venture Partners", tier: "generalist", aum: null, focus: "Enterprise, consumer, fintech", signal: 2, note: null, url: "https://jobs.lsvp.com", urlLabel: "jobs.lsvp.com", inList: true, noBoard: false },
  { id: "norwest", name: "Norwest Venture Partners", tier: "generalist", aum: null, focus: "Growth equity, software & healthcare", signal: 1, note: null, url: "https://careers.nvp.com", urlLabel: "careers.nvp.com", inList: true, noBoard: false },
  { id: "greylock", name: "Greylock Partners", tier: "generalist", aum: null, focus: "Early-stage enterprise & infra specialist", signal: 2, note: null, url: "https://jobs.greylock.com/jobs", urlLabel: "jobs.greylock.com", inList: false, noBoard: false },
  { id: "menlo", name: "Menlo Ventures", tier: "generalist", aum: null, focus: "Enterprise infra; runs an Anthropic SPV", signal: 2, note: null, url: "https://jobs.menlovc.com/jobs", urlLabel: "jobs.menlovc.com", inList: false, noBoard: false },
  { id: "redpoint", name: "Redpoint Ventures", tier: "generalist", aum: null, focus: "Infra & enterprise software, early-stage", signal: 1, note: null, url: "https://careers.redpoint.com", urlLabel: "careers.redpoint.com", inList: false, noBoard: false },
  { id: "index-ventures", name: "Index Ventures", tier: "generalist", aum: null, focus: "Transatlantic, developer tools & SaaS", signal: 2, note: null, url: "https://www.indexventures.com/startup-jobs", urlLabel: "indexventures.com/startup-jobs", inList: false, noBoard: false },
  { id: "craft", name: "Craft Ventures", tier: "generalist", aum: null, focus: "Operator-led, SaaS & marketplaces", signal: 1, note: null, url: "https://jobs.craftventures.com/jobs", urlLabel: "jobs.craftventures.com", inList: false, noBoard: false },
  { id: "notable-capital", name: "Notable Capital", short: "fka GGV", tier: "generalist", aum: null, focus: "Cross-border enterprise & consumer tech", signal: 1, note: null, url: "https://jobs.notablecap.com", urlLabel: "jobs.notablecap.com", inList: false, noBoard: false },
  { id: "battery", name: "Battery Ventures", tier: "generalist", aum: null, focus: "Infra, software, industrial tech", signal: 1, note: null, url: "https://batteryventures.com", urlLabel: "batteryventures.com", inList: false, noBoard: true },
  { id: "benchmark", name: "Benchmark", tier: "generalist", aum: null, focus: "Small-partnership, high-conviction early-stage", signal: 2, note: "Perplexity", url: "https://benchmark.com", urlLabel: "benchmark.com", inList: false, noBoard: true },
  { id: "ivp", name: "IVP", tier: "generalist", aum: null, focus: "Late-stage growth equity", signal: 1, note: null, url: "https://ivp.com", urlLabel: "ivp.com", inList: false, noBoard: true },
  { id: "crv", name: "CRV", tier: "generalist", aum: null, focus: "Early-stage enterprise & fintech", signal: 1, note: null, url: "https://crv.com", urlLabel: "crv.com", inList: false, noBoard: true },
  { id: "mayfield", name: "Mayfield", tier: "generalist", aum: null, focus: "Enterprise & “people-first” AI", signal: 1, note: null, url: "https://mayfield.com", urlLabel: "mayfield.com", inList: false, noBoard: true },
  { id: "emergence", name: "Emergence Capital", tier: "generalist", aum: null, focus: "Enterprise SaaS specialist", signal: 1, note: null, url: "https://emergencecap.com", urlLabel: "emergencecap.com", inList: false, noBoard: true },
  { id: "scale-vp", name: "Scale Venture Partners", tier: "generalist", aum: null, focus: "B2B software growth", signal: 1, note: null, url: "https://scalevp.com", urlLabel: "scalevp.com", inList: false, noBoard: true },
  { id: "sapphire", name: "Sapphire Ventures", tier: "generalist", aum: null, focus: "Growth-stage enterprise software", signal: 1, note: null, url: "https://sapphireventures.com", urlLabel: "sapphireventures.com", inList: false, noBoard: true },

  // --- AI-native specialists ---
  { id: "conviction", name: "Conviction", tier: "ai-native", aum: null, focus: "AI-native SaaS — founded by Sarah Guo (ex-Greylock)", signal: 3, note: "Harvey, Mistral AI, Sierra", url: "https://www.conviction.com", urlLabel: "conviction.com", inList: false, noBoard: false },
  { id: "radical", name: "Radical Ventures", tier: "ai-native", aum: "$1.45B AUM", focus: "AI-only mandate, Toronto/SF", signal: 3, note: "LPs incl. Geoffrey Hinton, Fei-Fei Li", url: null, urlLabel: null, inList: false, noBoard: false },
  { id: "aix", name: "AIX Ventures", tier: "ai-native", aum: "$252M AUM", focus: "Technical AI diligence specialists", signal: 3, note: "Founded by ML researchers", url: null, urlLabel: null, inList: false, noBoard: false },
  { id: "amplify", name: "Amplify Partners", tier: "ai-native", aum: null, focus: "Dev-tools & infra, AI-heavy since seed", signal: 3, note: "“First investor for technical founders”", url: "https://www.amplifypartners.com", urlLabel: "amplifypartners.com", inList: false, noBoard: false },
  { id: "basis-set", name: "Basis Set Ventures", tier: "ai-native", aum: "$850M AUM", focus: "Applied AI & enterprise automation", signal: 3, note: "Founded by Lan Xuezhao", url: "https://www.basisset.com", urlLabel: "basisset.com", inList: false, noBoard: false },
  { id: "air-street", name: "Air Street Capital", tier: "ai-native", aum: null, focus: "AI-first tech & life sciences (London-based, invests in the US)", signal: 3, note: "Run by Nathan Benaich", url: "https://www.airstreet.com", urlLabel: "airstreet.com", inList: false, noBoard: false },

  // --- Accelerator ---
  { id: "y-combinator", name: "Y Combinator", tier: "accelerator", aum: null, focus: "Seed accelerator — highest-volume board for early-stage software/AI roles", signal: 2, note: "Not a check-writing growth VC", url: "https://www.workatastartup.com", urlLabel: "workatastartup.com", inList: true, noBoard: false },
];

const TIER_META = {
  "ai-mega": { label: "AI-First & AI-Heavy Mega Funds", short: "AI-First Mega Funds" },
  "generalist": { label: "Software & Growth Generalists", short: "Generalists" },
  "ai-native": { label: "AI-Native Specialists", short: "AI-Native" },
  "accelerator": { label: "Accelerators", short: "Accelerators" },
};
