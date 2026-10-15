const test = require("node:test");
const assert = require("node:assert/strict");
const { toDisplayHtml, toPlainText, shardOf, groupByShard } = require("../description");

test("keeps Ashby's paragraph-wrapped list items as list items", () => {
  const html = toDisplayHtml('<p style="x"><strong>We expect you to:</strong></p><ul><li><p>Write Rust</p></li><li><p>Ship it</p></li></ul>');
  assert.equal(html, "<p><strong>We expect you to:</strong></p><ul><li>Write Rust</li><li>Ship it</li></ul>");
});

test("decodes Greenhouse's entity-encoded markup", () => {
  assert.equal(toDisplayHtml("&lt;p&gt;Build &amp;amp; ship&lt;/p&gt;"), "<p>Build &amp; ship</p>");
});

test("drops scripts, attributes, unsafe links and unknown tags but keeps their text", () => {
  const html = toDisplayHtml('<div onclick="x"><script>alert(1)</script><span>Hi</span> <a href="javascript:alert(1)">bad</a> <a href="https://ok.example/">ok</a><img src=x onerror=alert(1)></div>');
  assert.equal(html, '<p>Hi bad <a href="https://ok.example/">ok</a></p>');
});

test("turns plain text into paragraphs and lists", () => {
  assert.equal(toDisplayHtml("About us\n\n- one\n- two"), "<p>About us</p><ul><li>one</li><li>two</li></ul>");
});

test("returns empty for nothing to show", () => {
  assert.equal(toDisplayHtml(""), "");
  assert.equal(toDisplayHtml("<p> </p><ul><li></li></ul>"), "");
});

test("plain text for the model keeps one item per line", () => {
  assert.equal(toPlainText("<p><strong>Skills</strong></p><ul><li>Rust &amp; Go</li><li>SQL</li></ul>"), "Skills\n\n- Rust & Go\n- SQL");
});

test("shards are stable three-digit hex and group by shard", () => {
  assert.match(shardOf("acme_ashby_123"), /^[0-9a-f]{3}$/);
  assert.equal(shardOf("acme_ashby_123"), shardOf("acme_ashby_123"));
  const grouped = groupByShard({ a: "1", b: "2" });
  assert.equal(grouped[shardOf("a")].a, "1");
});
