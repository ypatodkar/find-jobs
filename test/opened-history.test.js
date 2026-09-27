const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function browser(history = {}, jobs = [], failWrites = false) {
  const listeners = {};
  let stored = JSON.stringify(history);
  const document = {
    readyState: "complete",
    head: { appendChild() {} },
    body: {},
    createElement: () => ({ setAttribute() {} }),
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const window = { JobsData: { all: () => jobs } };
  const context = vm.createContext({
    window, document,
    localStorage: {
      getItem: () => stored,
      setItem: (_, value) => {
        if (failWrites) throw new Error("Storage unavailable");
        stored = value;
      },
    },
    navigator: {},
    MutationObserver: class { observe() {} },
    requestAnimationFrame() {},
  });
  for (const file of ["track.js", "jobs-ui.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
  }
  return {
    context, window,
    stored: () => JSON.parse(stored),
    click(id) {
      const anchor = { getAttribute: () => id, parentNode: document };
      listeners.click({ target: { closest: () => anchor } });
    },
    badge(company) {
      const element = { textContent: "", getAttribute: () => company };
      window.JobsUI.refreshOpenedCounts({ querySelectorAll: () => [element] });
      return element.textContent;
    },
  };
}

test("history count does not enumerate saved openings on repeated reads", () => {
  const history = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ["job_" + i, i + 1]));
  const b = browser(history);
  vm.runInContext(`
    globalThis.enumerations = 0;
    const originalKeys = Object.keys;
    Object.keys = function (value) { enumerations++; return originalKeys(value); };
  `, b.context);
  for (let i = 0; i < 12521; i++) assert.equal(b.window.Seen.count(), 5000);
  assert.equal(b.context.enumerations, 0);
});

test("new clicks persist once and repeated clicks do not increase the count", () => {
  const b = browser();
  b.click("new");
  const revision = b.window.Seen.revision();
  b.click("new");
  assert.equal(b.window.Seen.count(), 1);
  assert.equal(b.window.Seen.revision(), revision);
  assert.equal(b.stored().new, b.window.Seen.at("new"));
});

test("company badges update when a click evicts history at the entry limit", () => {
  const history = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ["job_" + i, i + 1]));
  const b = browser(history, [
    { job_id: "job_0", company: "Old company" },
    { job_id: "new", company: "New company" },
  ]);
  assert.equal(b.badge("Old company"), "1 role opened at this company");
  b.click("new");
  assert.equal(b.window.Seen.count(), 5000);
  assert.equal(b.window.Seen.has("job_0"), false);
  assert.equal(b.badge("Old company"), "");
  assert.equal(b.badge("New company"), "1 role opened at this company");
  assert.equal(Object.keys(b.stored()).length, 5000);
});

test("clear and reopen with the same count invalidates company history", () => {
  const b = browser({ old: 1 }, [
    { job_id: "old", company: "Old company" },
    { job_id: "new", company: "New company" },
  ]);
  assert.equal(b.badge("Old company"), "1 role opened at this company");
  b.window.Seen.clear();
  assert.equal(b.window.Seen.count(), 0);
  b.click("new");
  assert.equal(b.badge("Old company"), "");
  assert.equal(b.badge("New company"), "1 role opened at this company");
});

test("company counts refresh when job data arrives after history", () => {
  const b = browser({ saved: 1 });
  assert.equal(b.badge("Company"), "");
  const jobs = [{ job_id: "saved", company: "Company" }];
  b.window.JobsData = { all: () => jobs };
  assert.equal(b.badge("Company"), "1 role opened at this company");
});

test("history remains accurate when storage writes fail", () => {
  const b = browser({}, [], true);
  b.click("new");
  assert.equal(b.window.Seen.count(), 1);
  assert.equal(b.window.Seen.has("new"), true);
  b.window.Seen.clear();
  assert.equal(b.window.Seen.count(), 0);
  assert.equal(b.window.Seen.has("new"), false);
});
