// The India list's sources beyond the job boards: Indian investors' portfolios, read
// company by company (scraper/portfolio.js). Most Indian firms publish no portfolio
// job board, so their portfolio page is where the companies are; each company's own
// careers system then gives its openings.
//
// `portfolio` is the page listing the companies. Most firms also list every company's
// own page in their sitemap, which is read too and covers pages that are built in the
// browser. Two firms here also run a board (BOARDS in boards.js, same id): Peak XV and
// 3one4.
//
// Checked in November 2026 against each site. Left out: firms whose portfolio could
// not be read (Blume and Mumbai Angels refuse automated requests, Venture Catalysts
// loads its portfolio from a database the page calls, Z47's company pages do not link
// to the companies) and the global firms' India arms (Accel, Lightspeed, Bessemer),
// whose Indian roles come through their boards already.
const INDIA_PORTFOLIOS = {
  "peak-xv":        { name: "Peak XV Partners", portfolio: "https://www.peakxv.com/companies" },
  "surge":          { name: "Surge (Peak XV)", portfolio: "https://surge.peakxv.com/companies" },
  "titan":          { name: "Titan Capital", portfolio: "https://titancapital.vc/portfolio" },
  "better":         { name: "Better Capital", portfolio: "https://www.bettercapital.vc/portfolio" },
  "ian":            { name: "Indian Angel Network", portfolio: "https://iangroup.vc/portfolio/" },
  "nexus":          { name: "Nexus Venture Partners", portfolio: "https://www.nexusvp.com/companies" },
  "elevation":      { name: "Elevation Capital", portfolio: "https://www.elevationcapital.com/portfolio" },
  "india-quotient": { name: "India Quotient", portfolio: "https://indiaquotient.in/portfolio" },
  "chiratae":       { name: "Chiratae Ventures", portfolio: "https://chiratae.com/companies/" },
  "kalaari":        { name: "Kalaari Capital", portfolio: "https://kalaari.com/portfolio" },
  "jungle":         { name: "Jungle Ventures", portfolio: "https://www.jungle.vc/portfolio" },
  "point-one":      { name: "Point One Capital", portfolio: "https://pointone.capital/portfolio.html" },
  "3one4":          { name: "3one4 Capital", portfolio: "https://www.3one4capital.com/portfolio" },
  "axilor":         { name: "Axilor Ventures", portfolio: "https://www.axilor.com/portfolio/" },
  "prime":          { name: "Prime Venture Partners", portfolio: "https://www.primevp.in/portfolio" },
  "sauce":          { name: "Sauce.vc", portfolio: "https://sauce.vc/" },
  "unicorn-india":  { name: "Unicorn India Ventures", portfolio: "https://www.unicornivc.com/deep-tech-venture-capital-portfolio" },
  "letsventure":    { name: "LetsVenture", portfolio: "https://lvxventures.com/portfolio" },
  "growx":          { name: "GrowX Ventures", portfolio: "https://www.growx.vc/portfolio" },
  "stellaris":      { name: "Stellaris Venture Partners", portfolio: "https://www.stellarisvp.com/portfolio" },
  "atoms":          { name: "Accel Atoms", portfolio: "https://atoms.accel.com/portfolio" },
  "together":       { name: "Together Fund", portfolio: "https://www.together.fund/portfolio" },
  "rainmatter":     { name: "Rainmatter", portfolio: "https://rainmatter.com/portfolio/" },
  "speciale":       { name: "Speciale Invest", portfolio: "https://www.specialeinvest.com/portfolio" },
  "endiya":         { name: "Endiya Partners", portfolio: "https://www.endiya.com/portfolio" },
  "9unicorns":      { name: "9Unicorns", portfolio: "https://www.100unicorns.in/portfolio" },
  "huddle":         { name: "Huddle Ventures", portfolio: "https://huddle.work/portfolio/" },
  "orios":          { name: "Orios Venture Partners", portfolio: "https://oriosvp.com/portfolio" },
  "ankur":          { name: "Ankur Capital", portfolio: "https://www.ankurcapital.com/portfolio" },
  "ideaspring":     { name: "Ideaspring Capital", portfolio: "https://www.ideaspringcap.com/portfolio" },
  "exfinity":       { name: "Exfinity Venture Partners", portfolio: "https://www.exfinityventures.com/portfolio" },
  "alteria":        { name: "Alteria Capital", portfolio: "https://alteriacapital.com/portfolio/" },
  "eximius":        { name: "Eximius Ventures", portfolio: "https://eximiusvc.com/portfolio" },
  "info-edge":      { name: "Info Edge Ventures", portfolio: "https://www.infoedgeventures.in/companies" },
  "lumikai":        { name: "Lumikai", portfolio: "https://www.lumikai.com/portfolio" },
  "caspian":        { name: "Caspian", portfolio: "https://caspian.in/portfolio" },
  "seafund":        { name: "Seafund", portfolio: "https://seafund.in/portfolio/" },
  "trifecta":       { name: "Trifecta Capital", portfolio: "https://www.trifectacapital.in/portfolio" },
  "waterbridge":    { name: "WaterBridge Ventures", portfolio: "https://waterbridge.vc/" },
  "beenext":        { name: "Beenext", portfolio: "https://www.beenext.com/portfolio" },
  "ipv":            { name: "Inflection Point Ventures", portfolio: "https://ipventures.in/" },
};

/**
 * Whether a firm id is an Indian source: a portfolio above, or a board that is asked
 * for Indian roles only. A company only Indian sources list is read for the India
 * list alone, so nothing they bring changes the US one.
 */
function isIndianFirm(id, boards = require("./boards").BOARDS) {
  if (INDIA_PORTFOLIOS[id]) return true;
  const countries = boards[id]?.countries;
  return Array.isArray(countries) && countries.length > 0 && countries.every((c) => c === "IN");
}

module.exports = { INDIA_PORTFOLIOS, isIndianFirm };
