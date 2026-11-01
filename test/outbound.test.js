// Links out of the site carry utm_source=jobs.ypatodkar.com (web/src/lib/outbound.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "web", "src", "lib", "outbound.js")).href);

test("outbound links say they came from this site, and nothing else about them changes", async () => {
  const { withSource } = await load();
  const tag = "utm_source=jobs.ypatodkar.com";
  assert.equal(withSource("https://jobs.ashbyhq.com/acme/123"), `https://jobs.ashbyhq.com/acme/123?${tag}`);
  assert.equal(withSource("https://job-boards.greenhouse.io/acme/jobs/1?gh_jid=1"), `https://job-boards.greenhouse.io/acme/jobs/1?gh_jid=1&${tag}`);
  assert.equal(withSource("https://jobs.lever.co/acme/1?"), `https://jobs.lever.co/acme/1?${tag}`);
  assert.equal(withSource("https://jobs.gem.com/acme/1?utm_source=jobs.lsvp.com&x=1"), `https://jobs.gem.com/acme/1?${tag}&x=1`, "a VC board's tag is replaced");
  assert.equal(withSource("https://a.io/careers#:~:text=Flight%20Software"), `https://a.io/careers?${tag}#:~:text=Flight%20Software`, "the fragment stays last");
  assert.equal(withSource("https://a.io/x?q=a%2Fb+c&lever-source[]=x"), `https://a.io/x?q=a%2Fb+c&lever-source[]=x&${tag}`, "existing parameters are kept byte for byte");
  for (const url of [null, undefined, "", "index.html?company=Acme", "mailto:jobs@acme.com", "javascript:alert(1)", "https://"]) {
    assert.equal(withSource(url), url, `left alone: ${url}`);
  }
});
