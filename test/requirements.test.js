const test = require("node:test");
const assert = require("node:assert/strict");
const { extractRequirements } = require("../shared/requirements");

test("reads sections: requirements, preferences, duties; skips benefits and pay", () => {
  const html = "<h3>What you'll do</h3><ul><li>Design the ingestion pipeline end to end</li></ul>" +
    "<h3>Requirements</h3><ul><li>5+ years of backend experience</li></ul>" +
    "<h3>Preferred qualifications</h3><ul><li>Experience with Kafka in production</li></ul>" +
    "<h3>Benefits</h3><ul><li>Unlimited paid time off policy</li></ul>" +
    "<p>The salary range for this role is $150,000 to $200,000.</p>";
  const r = extractRequirements(html);
  assert.deepEqual(r.items.map((i) => [i.kind, i.text]), [
    ["duty", "Design the ingestion pipeline end to end"],
    ["required", "5+ years of backend experience"],
    ["preferred", "Experience with Kafka in production"],
  ]);
});

test("an item that calls itself optional is a preference even under Requirements", () => {
  const r = extractRequirements("<h3>Requirements</h3><ul><li>Go experience is a plus for this team</li></ul>");
  assert.equal(r.items[0].kind, "preferred");
});

test("joins a lead-in item to the nested items that complete it", () => {
  const r = extractRequirements("<h3>Nice to have</h3><ul><li>Experience with<ul><li>embedded or GPU deployment</li><li>LiDAR sensors</li></ul></li></ul>");
  assert.deepEqual(r.items.map((i) => i.text), ["Experience with: embedded or GPU deployment", "Experience with: LiDAR sensors"]);
});

test("reads prose postings sentence by sentence when there are no lists", () => {
  const r = extractRequirements("<p>You will build our search ranking. You should know Python well. We offer great benefits.</p>");
  assert.deepEqual(r.items.map((i) => i.text), ["You will build our search ranking.", "You should know Python well."]);
});

test("caps the list, keeping required items first", () => {
  const li = (n, p) => Array.from({ length: n }, (_, i) => `<li>${p} item number ${i} for this role</li>`).join("");
  const r = extractRequirements(`<h3>What you'll do</h3><ul>${li(25, "Duty")}</ul><h3>Requirements</h3><ul>${li(10, "Required")}</ul>`, 30);
  assert.equal(r.capped, true);
  assert.equal(r.items.filter((i) => i.kind === "required").length, 10);
  assert.equal(r.items.length, 30);
});
