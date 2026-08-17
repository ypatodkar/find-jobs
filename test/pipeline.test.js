const test = require("node:test");
const assert = require("node:assert/strict");
const { BOARDS } = require("../boards");
const { failedPlatforms } = require("../pipeline");

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
