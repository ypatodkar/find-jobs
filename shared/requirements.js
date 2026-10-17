// Pulling the individual requirements out of a job description.
//
// Server-side only (jev.js uses it; build.js does not ship it). Input is the HTML
// description.js stores — paragraphs, headings, lists, bold — so the posting's own
// structure is there to read: which section an item sits in says whether it is a
// requirement, a preference, a duty, or company and benefits copy to leave alone.
//
// The model then judges each item on its own (and may still say "this is not a
// requirement"), so this only has to be a good first cut, not a perfect one.

const { toPlainText } = require("./description");

const MAX_ITEMS = 30;
const MIN_LEN = 15;
const MAX_LEN = 260;

// What a section heading says about the items under it. Order matters: the first
// match wins, so "Preferred qualifications" is a preference, not a requirement.
const SECTIONS = [
  ["skip", /benefit|perk|compensation|salary|pay (range|transparency)|equity|total rewards|what we offer|why (join|work)|life at|about (us|the company)|who we are|our (mission|story|values|culture)|equal (employment|opportunity)|\beeo\b|privacy|accommodation|disclaimer|how to apply|interview process/i],
  ["preferred", /prefer|nice to have|nice-to-have|bonus|\ba plus\b|desired|extra credit|stand out|good to have|ideally/i],
  ["required", /require|qualif|must|minimum|basic|what you('ll| will)? (need|bring)|you (have|bring|are|should)|skills|experience|looking for|who you are|about you|ideal candidate/i],
  ["duty", /responsib|what you('ll| will)? (do|work on|build|own)|the role|day[- ]to[- ]day|your impact|in this role|you will|key (duties|tasks)|what you'll be doing/i],
];

// The weight each kind of item carries in the score. Requirements count most;
// a missing preference costs much less than a missing requirement.
const WEIGHT = { required: 1, duty: 0.6, other: 0.5, preferred: 0.4 };

function sectionKind(heading) {
  if (!heading) return "other";
  for (const [kind, re] of SECTIONS) if (re.test(heading)) return kind;
  return "other";
}

// Pay, benefits, legal and recruiting copy, recognised by what it says. A section
// runs until the next heading, and boards put these paragraphs straight after the
// last list with no heading of their own, so the section alone would call a salary
// range a "preferred qualification".
const NOT_A_REQUIREMENT = /\$\s?\d|\bsalary\b|compensation|\bequity\b|\bbenefits?\b|\b401k\b|equal[- ](employment|opportunity)|affirmative action|accommodation|offer package|background check|reference check|recruit(er|ing|ment)|talent acquisition|fraud|verify communications|unsolicited|privacy (notice|policy)|e-verify|\bwe('re| are) (proud|committed)|encourage (all )?(candidates|you|applicants) to apply|love to hear from you|regardless of (race|age)|^(please|note:)/i;

// A single item can say it is optional even inside a "Requirements" list.
function itemKind(text, section) {
  if (section === "skip" || NOT_A_REQUIREMENT.test(text)) return "skip";
  if (/\b(preferred|nice to have|is a plus|a bonus|bonus points|ideally)\b/i.test(text)) return "preferred";
  return section;
}

const clean = (s) => toPlainText(s).replace(/\s+/g, " ").trim();
const clip = (s) => (s.length > MAX_LEN ? s.slice(0, MAX_LEN - 1).replace(/\s+\S*$/, "") + "…" : s);

/** The posting as a list of blocks in order: { tag: "h" | "li" | "p", text }. */
function blocks(html) {
  const out = [];
  const s = String(html || "");
  // Nested lists: a parent item's own text ends where its child list begins.
  const re = /<(h3|h4|p|li)>|<\/(h3|h4|p|li)>|<(ul|ol)>/g;
  const stack = [];
  let last = 0;
  let m;
  const flush = (upTo) => {
    if (stack.length) stack[stack.length - 1].html += s.slice(last, upTo);
    last = upTo;
  };
  const depth = () => stack.filter((x) => x.tag === "li").length;
  const emit = (b) => {
    const text = clean(b.html);
    if (!text) return;
    // A paragraph that is nothing but bold text is how most boards write a heading.
    const boldOnly = b.tag === "p" && /^\s*<strong>[\s\S]*<\/strong>\s*$/.test(b.html) && !/<\/strong>[\s\S]*<strong>/.test(b.html);
    out.push({ tag: b.tag === "h3" || b.tag === "h4" || boldOnly ? "h" : b.tag, text, depth: b.depth || 0 });
  };
  while ((m = re.exec(s))) {
    flush(m.index);
    last = re.lastIndex;
    if (m[1]) stack.push({ tag: m[1], html: "", depth: m[1] === "li" ? depth() : 0 });
    else if (m[2]) { const b = stack.pop(); if (b) emit(b); }
    else if (m[3] && stack.length && stack[stack.length - 1].tag === "li") {
      const parent = stack[stack.length - 1];
      emit(parent);
      parent.html = "";
    }
  }
  flush(s.length);
  return out;
}

const sentences = (text) =>
  (text.match(/[^.!?]+(?:[.!?](?=\s|$)|$)/g) || [text]).map((x) => x.trim()).filter(Boolean);

/**
 * The requirements to ask about, most important first:
 * [{ id, text, kind: "required" | "preferred" | "duty" | "other", weight }].
 * `capped` says there were more than MAX_ITEMS and the least important were left out.
 */
function extractRequirements(html, max = MAX_ITEMS) {
  const items = [];
  const seen = new Set();
  let heading = null;
  let section = "other";
  let order = 0;
  const add = (text, kind) => {
    const t = clip(text);
    const k = t.toLowerCase();
    if (t.length < MIN_LEN || seen.has(k) || kind === "skip") return;
    seen.add(k);
    items.push({ text: t, kind, order: order++ });
  };

  const all = blocks(html);
  const hasLists = all.some((b) => b.tag === "li");
  // "Experience with:" followed by a nested list is one requirement per sub-item,
  // each read with its lead-in; the lead-in alone says nothing.
  const LEAD_IN = /[:–—-]$|\b(with|in|of|following|including|such as|like)$/i;
  let leadIn = null; // { text, depth }
  for (const b of all) {
    if (b.tag === "h") { heading = b.text; section = sectionKind(heading); leadIn = null; continue; }
    if (b.tag === "li") {
      if (leadIn && b.depth > leadIn.depth) {
        add(leadIn.text.replace(/[:–—-]\s*$/, "") + ": " + b.text, itemKind(leadIn.text + " " + b.text, section));
        continue;
      }
      leadIn = null;
      if (LEAD_IN.test(b.text) && b.text.length < 90) { leadIn = { text: b.text, depth: b.depth }; continue; }
      add(b.text, itemKind(b.text, section));
      continue;
    }
    leadIn = null;
    // Paragraphs: sentence by sentence under a requirement, preference or duty
    // heading; in a posting with no lists at all, everywhere but skipped sections,
    // since prose is then the only place the requirements can be.
    if (section === "required" || section === "preferred" || section === "duty" || (!hasLists && section !== "skip")) {
      for (const x of sentences(b.text)) add(x, itemKind(x, section));
    }
  }

  const rank = { required: 0, preferred: 1, duty: 2, other: 3 };
  const chosen = items
    .slice()
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.order - b.order)
    .slice(0, max)
    .sort((a, b) => a.order - b.order)
    .map((it, i) => ({ id: "q" + i, text: it.text, kind: it.kind, weight: WEIGHT[it.kind] }));
  return { items: chosen, capped: items.length > max, found: items.length };
}

module.exports = { extractRequirements, blocks, sectionKind, WEIGHT, MAX_ITEMS };
