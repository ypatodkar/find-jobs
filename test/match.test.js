const test = require("node:test");
const assert = require("node:assert/strict");
const { isBlockedCompany, keep } = require("../match");

test("blocks SignalFire talent-network records through every source identifier", () => {
  assert.equal(isBlockedCompany({ company: "SignalFire" }), true);
  assert.equal(isBlockedCompany({ company: "Signal Fire" }), true);
  assert.equal(isBlockedCompany({ domain: "https://www.signalfire.com/careers" }), true);
  assert.equal(isBlockedCompany({ slug: "SignalFire" }), true);
});

test("does not block SignalFire portfolio companies", () => {
  assert.equal(isBlockedCompany({ company: "Horizon3.ai", domain: "horizon3.ai", slug: "horizon3ai" }), false);
});

// The AI-lab annotation gigs. "AI Tutor" matched the AI/ML role pattern on the word
// "AI", so 43 of them were reaching the list as engineering roles.
test("drops AI tutor listings, whatever they are suffixed with", () => {
  const loc = ["Remote, US"];
  assert.equal(keep("AI Tutor - Catalan", loc), null);
  assert.equal(keep("AI Tutor - Software Engineering Specialist", loc), null);
  assert.equal(keep("Data Science Tutor", loc), null);
  assert.equal(keep("AI Tutor, Physics Specialist (contract)", loc), null);
});

test("keeps xAI's actual engineering roles", () => {
  const loc = ["San Francisco, CA"];
  for (const title of [
    "Member of Technical Staff - Post-Training and RL",
    "Application Security Engineer",
    "ML Infrastructure Engineer",
    "Software Engineer - Data Platform",
  ]) {
    assert.notEqual(keep(title, loc), null, `${title} should survive`);
  }
});

test("classifies robotics roles without admitting generic hardware jobs", () => {
  const loc = ["San Francisco, CA"];
  const expected = [
    ["Research Engineer - Robot Learning", ["ai", "robotics"]],
    ["Robot Research Scientist", ["ai", "robotics"]],
    ["Reinforcement Learning", ["ai"]],
    ["Research Scientist - Reinforcement Learning, Robotics", ["ai", "robotics"]],
    ["Mechatronics Engineer", ["robotics"]],
    ["Robot FDE", ["robotics"]],
    ["Forward Deployed Robotics Engineer", ["robotics", "solutions"]],
  ];

  for (const [title, roles] of expected) {
    assert.deepEqual(keep(title, loc)?.roles, roles, title);
  }
  assert.equal(keep("Mechanical Engineer", loc), null);
  assert.equal(keep("Robotics Product Manager", loc), null);
});
