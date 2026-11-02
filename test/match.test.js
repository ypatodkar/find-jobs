const test = require("node:test");
const assert = require("node:assert/strict");
const { isBlockedCompany, keep } = require("../scraper/match");

test("blocks SignalFire talent-network records through every source identifier", () => {
  assert.equal(isBlockedCompany({ company: "SignalFire" }), true);
  assert.equal(isBlockedCompany({ company: "Signal Fire" }), true);
  assert.equal(isBlockedCompany({ domain: "https://www.signalfire.com/careers" }), true);
  assert.equal(isBlockedCompany({ slug: "SignalFire" }), true);
});

test("does not block SignalFire portfolio companies", () => {
  assert.equal(isBlockedCompany({ company: "Horizon3.ai", domain: "horizon3.ai", slug: "horizon3ai" }), false);
});

// Acquired companies on a board: the ones still hiring through their own board stay,
// the ones whose listings are really the buyer's openings go.
test("tells a company's own apply link from its buyer's", () => {
  const { isOwnLink } = require("../scraper/match");
  assert.equal(isOwnLink({ company: "Zoox", url: "https://jobs.lever.co/zoox/51838a63", slug: "zoox" }), true);
  assert.equal(isOwnLink({ company: "Altruist", url: "https://altruist.com/join-altruist/6186198004" }), true);
  assert.equal(isOwnLink({ company: "OfferFit", url: "https://job-boards.greenhouse.io/braze/jobs/8197642", slug: "braze" }), false);
  assert.equal(isOwnLink({ company: "Instana", url: "https://careers.ibm.com/job/123" }), false);
  assert.equal(isOwnLink({ company: "Hpe Simplivity", url: "https://careers.hpe.com/us/en/job/1" }), false);
  assert.equal(isOwnLink({ company: "", url: "https://example.com" }), false);
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

// Suburbs that sit inside a tracked metro but are not the metro's own name. These were
// silently dropped: a Bay Area company posting from its actual address in San Carlos
// looked, to matchCity, exactly like a company in a city we do not cover.
test("places suburbs inside the metro they belong to", () => {
  const { matchCity } = require("../scraper/match");
  assert.equal(matchCity(["San Carlos, California"]), "Bay Area");
  assert.equal(matchCity(["Hayward, California"]), "Bay Area");
  assert.equal(matchCity(["Poway, California"]), "San Diego");
});

// The reason this is a list of suburbs and not a state lookup. Each of these is in a
// state that contains a tracked metro, and none of them is in that metro — a state
// rule would file the first under Miami, 600 miles from where the job is.
test("does not drag a whole state into its nearest tracked metro", () => {
  const { matchCity } = require("../scraper/match");
  for (const place of ["Fort Walton Beach, Florida", "Olympia, Washington", "Trenton, New Jersey"]) {
    assert.equal(matchCity([place]), null, place);
  }
});
