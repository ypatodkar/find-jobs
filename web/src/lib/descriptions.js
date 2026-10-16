// Job descriptions, fetched a shard at a time on first need (shared/description.js
// decides which shard file holds a job, for the build, the API and the page). Shards
// are cached for the visit; a failed fetch is forgotten so a blip can be retried.
import "../../../shared/description.js"; // sets self.JobDescription

const shards = new Map(); // shard -> Promise<{ job_id: html } | null>

/** The job's stored HTML, "" when it has none, or null when it could not be loaded. */
export function loadDescription(id) {
  const D = globalThis.JobDescription;
  if (!D || !id) return Promise.resolve(null);
  const k = D.shardOf(id);
  if (!shards.has(k)) {
    shards.set(k, fetch(`api/desc/${k}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => {
        shards.delete(k);
        return null;
      }));
  }
  return shards.get(k).then((shard) => (shard ? shard[id] || "" : null));
}

// What a description may contain on the page: an allowlist, rebuilt
// from the stored HTML so nothing outside it reaches the DOM.
const TAGS = new Set(["P", "BR", "UL", "OL", "LI", "H3", "H4", "STRONG", "EM", "A"]);

/**
 * The stored HTML as a tree of { tag, props, children } and strings, for React to
 * render. A paragraph that is only bold text is a section heading on most boards, so
 * it gets the heading's class.
 */
export function descriptionTree(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => {
    const out = [];
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.push(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      if (!TAGS.has(n.tagName)) { out.push(...walk(n)); continue; }
      const props = {};
      if (n.tagName === "A") {
        const href = n.getAttribute("href") || "";
        if (/^(https?:|mailto:)/i.test(href)) Object.assign(props, { href, target: "_blank", rel: "noopener noreferrer nofollow" });
      }
      const children = walk(n);
      if (n.tagName === "P") {
        const kids = children.filter((c) => typeof c !== "string" || c.trim());
        if (kids.length === 1 && typeof kids[0] === "object" && kids[0].tag === "strong") props.className = "desc-label";
      }
      out.push({ tag: n.tagName.toLowerCase(), props, children });
    }
    return out;
  };
  return walk(doc.body);
}
