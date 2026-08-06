const test = require("node:test");
const assert = require("node:assert/strict");
const { isBlockedCompany } = require("../match");

test("blocks SignalFire talent-network records through every source identifier", () => {
  assert.equal(isBlockedCompany({ company: "SignalFire" }), true);
  assert.equal(isBlockedCompany({ company: "Signal Fire" }), true);
  assert.equal(isBlockedCompany({ domain: "https://www.signalfire.com/careers" }), true);
  assert.equal(isBlockedCompany({ slug: "SignalFire" }), true);
});

test("does not block SignalFire portfolio companies", () => {
  assert.equal(isBlockedCompany({ company: "Horizon3.ai", domain: "horizon3.ai", slug: "horizon3ai" }), false);
});
