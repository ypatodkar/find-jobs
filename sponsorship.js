// Conservative visa-sponsorship classification from a job description.
// Only explicit offers or refusals become yes/no. Generic work-authorization
// requirements remain unknown because they do not answer the sponsorship question.

const decodeEntities = (value) => String(value || "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

function toPlainText(value) {
  let text = Array.isArray(value) ? value.filter(Boolean).join(". ") : String(value || "");
  // Some Greenhouse boards return HTML whose entities have themselves been encoded.
  text = decodeEntities(decodeEntities(text));
  return text
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|li|div|h[1-6])>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

// "Sponsor" is a common business word, and job descriptions are full of it in senses
// that have nothing to do with immigration: executive sponsors, employer-sponsored
// benefits, sponsoring an internal initiative. These sentences are dropped before any
// pattern runs, so the wording below can be permissive without inventing answers.
const NOISE = /\b(?:executive|exec|technical|engineering|project|program|business|internal|corporate|physician|clinical)\s+sponsors?\b|\bemployer[-\s]sponsored\b|\bsponsors?,\s|\bsponsored\s+(?:program|plan|content|events?|research|conferences?|meetups?)\b|\bgain(?:ing)?\s+sponsorship\s+for\b|\bsponsor(?:ing)?\s+(?:and\s+deploy|internal|enterprise[-\s]wide)\b|\bwork\s+with\s+sponsors\b/i;

function stripNoise(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((s) => !NOISE.test(s))
    .join(" ");
}

// A role restricted to citizens or permanent residents answers the question for
// anyone who needs sponsorship, even though it never uses the word. Common on the
// defence and export-controlled listings these portfolios carry (ITAR, clearances).
// Kept narrow: "citizen" alone also shows up in "good corporate citizen" and
// "citizen developer", so a requirement word has to appear alongside it.
const CITIZENSHIP = [
  /\b(?:u\.?s\.?|united states|american)\s+citizen(?:ship)?\b[^.!?]{0,60}\b(?:required|only|must|necessary)\b/i,
  /\bcitizenship\b[^.!?]{0,80}\b(?:required|is a requirement)\b/i,
  /\b(?:must|need to)\s+be\s+(?:a\s+)?(?:u\.?s\.?|united states)\s+citizen\b/i,
  /\bcitizenship,\s*lawful permanent residency\b/i,
  /\b(?:u\.?s\.?\s+)?citizenship\s+or\s+(?:green card|permanent resident|ability to comply with itar)\b/i,
  /\b(?:itar|export control)\b[^.!?]{0,90}\b(?:citizen|legal status|u\.?s\.? person)\b/i,
  /\b(?:active|current)\s+(?:secret|top secret|ts\/sci|security)\s+clearance\b[^.!?]{0,40}\brequired\b/i,
];

const NEGATIVE = [
  // Up to two words of slack before the verb: "we cannot currently sponsor" and
  // "we do not at this time sponsor" are both common and both missed by \s+sponsor.
  /\b(?:we|the company|the employer)\s+(?:do|does|will|can)(?:not|\s+not|n't)(?:\s+\w+){0,3}\s+sponsor\b/i,
  /\b(?:is\s+)?(?:unable|not able)\s+to\s+sponsor\b/i,
  /\b(?:do|does|will|can)(?:\s+not|n't)\s+(?:provide|offer|support|sponsor)\b[^.!?]{0,90}\b(?:visa|employment|immigration|work authorization|candidates?|applicants?|sponsorship)\b/i,
  /\b(?:unable|not able)\s+to\s+(?:provide|offer|support|sponsor)\b[^.!?]{0,90}\b(?:visa|employment|immigration|work authorization|candidates?|applicants?|sponsorship)\b/i,
  /\bno\s+(?:visa|employment|immigration)?\s*sponsorship\b/i,
  /\b(?:visa|employment|immigration)\s+sponsorship\s+(?:is\s+)?(?:not available|unavailable|not offered|not provided|not supported)\b/i,
  /\b(?:must|should)\s+not\s+(?:now\s+(?:or|and)\s+(?:in\s+the\s+)?future\s+)?require\b[^.!?]{0,80}\bsponsorship\b/i,
  // "without current or future employer sponsorship" is the single most common way of
  // saying no in the corpus; `employer` was missing from the alternation, so the whole
  // phrase fell through.
  /\bwithout\s+(?:current\s+(?:or|and)\s+future\s+)?(?:visa|employment|employer|immigration|company[-\s]sponsored)?\s*(?:sponsorship|visa support)\b/i,
  /\bnot eligible for\b[^.!?]{0,50}\bsponsorship\b/i,
];

const POSITIVE = [
  /\bsponsorship\s+(?:is\s+)?(?:available|provided|offered|supported)\b/i,
  /\b(?:we|the company|the employer)\s+(?:can|will|do)\s+sponsor\b/i,
  /\b(?:visa|employment|immigration)\s+sponsorship\s+(?:is\s+)?(?:available|provided|offered|supported)\b/i,
  /\b(?:we|the company|the employer)\s+(?:can|will|do)\s+(?:provide|offer|support|sponsor)\b[^.!?]{0,90}\b(?:visa|employment|immigration|candidates?|applicants?|sponsorship)\b/i,
  /\bopen to sponsoring\b/i,
  /\b(?:provide|offer)\s+(?:visa|employment|immigration)\s+sponsorship\b/i,
  /\bsponsor(?:ing)?\s+(?:qualified\s+)?(?:candidates?|applicants?)\b/i,
  /\bh[-\s]?1b\s+(?:visa\s+)?(?:sponsorship|transfers?|support)\b/i,
  // Plain present tense with no modal — "Visa sponsorship: We sponsor visas." was the
  // single most common way of saying yes in the corpus, and the modal-only patterns
  // above all missed it.
  /\b(?:we|the company|the employer)\s+(?:also\s+)?sponsors?\s+(?:visas?|h[-\s]?1b|work visas?|employment visas?)\b/i,
  /\bvisa\s+sponsorship\s*:\s*(?:yes|we sponsor|available)\b/i,
  /\b(?:we|the company)\s+(?:can\s+|also\s+)?help\s+with\s+visa\s+(?:transfers?|sponsorship|applications?)\b/i,
  /\b(?:visa|immigration)\s+support\s+(?:is\s+)?(?:available|provided|offered)\b/i,
  /\bwilling\s+to\s+sponsor\b/i,
];

const VISA_TYPES = [
  ["STEM OPT", /\bstem\s+opt\b/i],
  ["H-1B", /\bh[-\s]?1b\b/i],
  ["OPT", /\bopt\b/i],
  ["TN", /\btn\s+visa\b/i],
  ["E-3", /\be[-\s]?3\b/i],
  ["O-1", /\bo[-\s]?1\b/i],
  ["Green card", /\b(?:green card|permanent residence)\b/i],
];

function excerpt(text, match) {
  const start = Math.max(0, text.lastIndexOf(". ", match.index) + 2);
  let end = text.indexOf(". ", match.index + match[0].length);
  if (end < 0) end = text.length;
  let sentence = text.slice(start, end + (end < text.length ? 1 : 0)).trim();
  if (sentence.length > 240) {
    const from = Math.max(0, match.index - start - 75);
    sentence = `${from ? "…" : ""}${sentence.slice(from, from + 225).trim()}…`;
  }
  return sentence || null;
}

function classifySponsorship(value) {
  const text = stripNoise(toPlainText(value));
  const types = VISA_TYPES.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  if (types.includes("STEM OPT")) {
    const genericOpt = types.indexOf("OPT");
    if (genericOpt >= 0) types.splice(genericOpt, 1);
  }
  for (const pattern of NEGATIVE) {
    const match = pattern.exec(text);
    if (match) return { status: "no", evidence: excerpt(text, match), types };
  }
  for (const pattern of POSITIVE) {
    const match = pattern.exec(text);
    if (match) return { status: "yes", evidence: excerpt(text, match), types };
  }
  // Ranked below an explicit statement: a posting that says it sponsors *and* mentions
  // a cleared programme elsewhere should read as sponsoring.
  for (const pattern of CITIZENSHIP) {
    const match = pattern.exec(text);
    if (match) return { status: "no", evidence: excerpt(text, match), types, reason: "citizenship" };
  }
  return { status: "unknown", evidence: null, types };
}

module.exports = { classifySponsorship, toPlainText };
