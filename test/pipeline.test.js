const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS } = require("../boards");
const { failedPlatforms, failedBoards } = require("../pipeline");

function resultWith(statusFor) {
  const firms = {};
  for (const [id, cfg] of Object.entries(BOARDS)) {
    firms[id] = { status: cfg.platform ? statusFor(cfg.platform, id) : "unsupported" };
  }
  return { firms };
}

test("rejects a scrape when an entire platform failed", () => {
  const results = resultWith((platform) => platform === "consider" ? "error" : "ok");
  assert.deepEqual(failedPlatforms(results), ["consider"]);
});

test("accepts partial board failures when each platform still returned data", () => {
  let failedOne = false;
  const results = resultWith((platform) => {
    if (platform === "consider" && !failedOne) {
      failedOne = true;
      return "error";
    }
    return "ok";
  });
  assert.deepEqual(failedPlatforms(results), []);
});

// The failure that actually cost us data: a16z and Greylock stopped returning, twenty
// other Consider boards kept going, failedPlatforms saw nothing wrong, and the deploy
// shipped without 86 companies no other portfolio lists. Partial loss has to be
// nameable even though it is correctly not fatal.
test("names individual boards that failed, where failedPlatforms stays quiet", () => {
  const results = resultWith(() => "ok");
  results.firms.lightspeed = { status: "error", reason: "fetch failed" };
  results.firms.nea = { status: "error", reason: "HTTP 503" };

  assert.deepEqual(failedPlatforms(results), [], "one platform still has working boards");

  const lost = failedBoards(results);
  assert.equal(lost.length, 2);
  // Sorted so the assertion does not depend on the order boards happen to sit in
  // BOARDS, which is editorial and reshuffled whenever a firm is added.
  assert.deepEqual(lost.map(([id]) => id).sort(), ["lightspeed", "nea"]);
  assert.deepEqual(
    Object.fromEntries(lost),
    { lightspeed: "fetch failed", nea: "HTTP 503" },
    "carries each board's own reason, not a generic one"
  );
});

// A board we have deliberately marked unsupported is a decision, not an outage, and
// must not show up as something to go and fix every single run.
test("does not report boards that are configured as unsupported", () => {
  const results = resultWith(() => "ok");
  const unsupported = Object.keys(BOARDS).filter((id) => !BOARDS[id].platform);
  assert.ok(unsupported.length > 0, "fixture needs at least one unsupported board");
  assert.deepEqual(failedBoards(results), []);
});
