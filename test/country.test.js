// Which country's list a visitor gets: index.html's start-up script, run as written,
// and the notes and saved choice in web/src/lib/country.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "web", "index.html"), "utf8");
const SCRIPT = [...INDEX.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("vc-directory-country"));

function storage(initial = {}, { broken = false } = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => { if (broken) throw new Error("SecurityError"); return k in data ? data[k] : null; },
    setItem: (k, v) => { if (broken) throw new Error("SecurityError"); data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
  };
}

// Open the home page in a browser with this storage and clock, and report where it went.
function openHome({ local = {}, zone = "America/Los_Angeles", search = "", hash = "", broken = false } = {}) {
  const localStorage = storage(local, { broken });
  const sessionStorage = storage();
  let went = null;
  const Intl = { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: zone }) }) };
  vm.runInNewContext(SCRIPT, { localStorage, sessionStorage, Intl, location: { search, hash, replace: (u) => { went = u; } } });
  return { went, local: localStorage.data, session: sessionStorage.data };
}

test("the start-up script is in index.html", () => {
  assert.ok(SCRIPT, "no inline script mentions vc-directory-country");
});

test("a first visit on India's clock opens the India list, and remembers it", () => {
  const r = openHome({ zone: "Asia/Kolkata" });
  assert.equal(r.went, "in.html");
  assert.equal(r.local["vc-directory-country"], "IN");
  assert.equal(r.session["vc-directory-country-auto"], "1", "so the India page can say why");
  assert.equal(openHome({ zone: "Asia/Calcutta" }).went, "in.html", "the zone's old name too");
});

test("a first visit anywhere else stays on the US list and saves nothing", () => {
  const r = openHome({ zone: "America/New_York" });
  assert.equal(r.went, null);
  assert.deepEqual(r.local, {});
  assert.deepEqual(r.session, {});
  assert.equal(openHome({ zone: "Asia/Dhaka" }).went, null);
});

test("a browser that has used the site before stays on the US list", () => {
  for (const key of ["vc-directory-visitor", "vc-directory-seen", "vc-directory-filters", "find-jobs-saved", "vc-directory-theme"]) {
    const r = openHome({ zone: "Asia/Kolkata", local: { [key]: "x" } });
    assert.equal(r.went, null, key);
    assert.equal(r.local["vc-directory-country"], undefined, `${key}: not decided for them`);
  }
});

test("a choice made with the switch wins over the clock", () => {
  assert.equal(openHome({ zone: "America/Chicago", local: { "vc-directory-country": "IN" } }).went, "in.html");
  const r = openHome({ zone: "America/Chicago", local: { "vc-directory-country": "IN" } });
  assert.equal(r.session["vc-directory-country-auto"], undefined, "they chose it: nothing to explain");
  assert.equal(openHome({ zone: "Asia/Kolkata", local: { "vc-directory-country": "US" } }).went, null);
});

test("a shared link with filters or an anchor opens as it is", () => {
  assert.equal(openHome({ zone: "Asia/Kolkata", search: "?roles=backend" }).went, null);
  assert.equal(openHome({ zone: "Asia/Kolkata", hash: "#main-content" }).went, null);
  assert.equal(openHome({ local: { "vc-directory-country": "IN" }, search: "?q=rust" }).went, null);
  assert.deepEqual(openHome({ zone: "Asia/Kolkata", search: "?roles=backend" }).local, {}, "nor is a choice saved");
});

test("no storage at all leaves the US list, without an error", () => {
  assert.equal(openHome({ zone: "Asia/Kolkata", broken: true }).went, null);
});

// ---- web/src/lib/country.js ----
const MODULE = pathToFileURL(path.join(__dirname, "..", "web", "src", "lib", "country.js")).href;
let copy = 0;
async function country(local = {}, session = {}) {
  globalThis.localStorage = storage(local);
  globalThis.sessionStorage = storage(session);
  return import(`${MODULE}?copy=${++copy}`);
}

test("the India list explains itself only when the start-up script sent the visitor", async () => {
  const { countryNote } = await country();
  assert.equal(countryNote("IN", { sent: true }), "sent");
  assert.equal(countryNote("IN", { sent: false, chosen: null, indiaClock: true }), null);
});

test("the US list tells a visitor on India's clock about India until they choose", async () => {
  const { countryNote } = await country();
  assert.equal(countryNote("US", { chosen: null, indiaClock: true }), "also");
  assert.equal(countryNote("US", { chosen: "US", indiaClock: true }), null);
  assert.equal(countryNote("US", { chosen: null, indiaClock: false }), null);
});

test("choosing saves the country and ends the 'sent here' note", async () => {
  const { chooseCountry, chosenCountry, wasSent } = await country({}, { "vc-directory-country-auto": "1" });
  assert.equal(wasSent(), true);
  chooseCountry("US");
  assert.equal(chosenCountry(), "US");
  assert.equal(wasSent(), false);
});

test("an unknown saved value counts as no choice", async () => {
  const { chosenCountry } = await country({ "vc-directory-country": "FR" });
  assert.equal(chosenCountry(), null);
});

test("opening the India list from a link saves India only for a visitor on India's clock", async () => {
  const { settleCountry } = await country();
  assert.equal(settleCountry("IN", { chosen: null, indiaClock: true }), true);
  assert.equal(globalThis.localStorage.data["vc-directory-country"], "IN");

  const other = await country();
  assert.equal(other.settleCountry("IN", { chosen: null, indiaClock: false }), false, "a US visitor is just looking");
  assert.equal(other.settleCountry("IN", { chosen: "US", indiaClock: true }), false, "a choice stands");
  assert.equal(other.settleCountry("US", { chosen: null, indiaClock: true }), false);
  assert.deepEqual(globalThis.localStorage.data, {});
});
