// The opened-jobs history (web/src/lib/seen.js): what the clicked stamp, the Hide
// filters, "Companies you've opened" and account sync all read.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const MODULE = pathToFileURL(path.join(__dirname, "..", "web", "src", "lib", "seen.js")).href;
let fresh = 0;

// A new copy of the store over a fake localStorage, as a fresh page load would get.
async function load(history = {}, { failWrites = false } = {}) {
  let stored = JSON.stringify(history);
  globalThis.localStorage = {
    getItem: () => stored,
    setItem: (_, value) => {
      if (failWrites) throw new Error("Storage unavailable");
      stored = value;
    },
  };
  const { seenStore } = await import(`${MODULE}?copy=${++fresh}`);
  return { seenStore, stored: () => JSON.parse(stored) };
}

test("an opening is recorded once, and stored", async () => {
  const { seenStore, stored } = await load();
  assert.equal(seenStore.mark("job_1"), true);
  assert.equal(seenStore.mark("job_1"), false);
  assert.deepEqual(Object.keys(stored()), ["job_1"]);
  assert.ok(seenStore.all().job_1 > 0);
});

test("history is capped at 5,000, dropping the oldest", async () => {
  const history = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ["job_" + i, i + 1]));
  const { seenStore, stored } = await load(history);
  seenStore.mark("newest");
  const kept = stored();
  assert.equal(Object.keys(kept).length, 5000);
  assert.equal(kept.job_0, undefined, "the oldest is dropped");
  assert.ok(kept.newest > 0, "the new one is kept");
});

test("an account's history merges in, keeping the earliest time for each job", async () => {
  const { seenStore } = await load({ a: 500, b: 100 });
  seenStore.merge({ a: 200, b: 900, c: 300, bad: "x", zero: 0 });
  assert.deepEqual(seenStore.all(), { a: 200, b: 100, c: 300 });
});

test("history keeps working in memory when storage writes fail", async () => {
  const { seenStore } = await load({}, { failWrites: true });
  assert.equal(seenStore.mark("job_1"), true);
  assert.equal(seenStore.mark("job_1"), false);
  assert.ok(seenStore.all().job_1 > 0);
});
