// Job descriptions: reducing a source's HTML to the structure worth keeping, and deciding
// which shard file a job's description lives in.
//
// Loaded by the scraper (Node) and by the page (a plain <script>), because both have
// to agree on shardOf: the build writes a description into one file and the page has
// to compute the same file name to find it again.
//
// What ships is a small, fixed vocabulary of HTML — paragraphs, headings, lists, bold,
// italic, line breaks and links — with every attribute gone except a link's address.
// That keeps a posting looking the way it does on the employer's own page, points as
// points, without carrying the board's styles or scripts. The page rebuilds it from the
// same allowlist before showing it (see jobs-ui.js), so this file is not the only guard.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.JobDescription = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 4096 files of three or so descriptions each. One file per job would be ~12,800
  // files, close to Cloudflare Pages' 20,000-file limit per deployment and growing
  // with every portfolio added; one big file would be tens of megabytes to read one.
  const SHARDS = 4096;

  // Characters of text, not of markup. Long enough for any real posting; a cap so one
  // malformed board cannot ship a megabyte into a shard.
  const MAX_TEXT = 30000;

  /** FNV-1a, so Node and the browser get the same answer without a crypto library. */
  function shardOf(jobId) {
    let h = 0x811c9dc5;
    const s = String(jobId);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return ((h >>> 0) % SHARDS).toString(16).padStart(3, "0");
  }

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", bull: "•", middot: "·", trade: "™", reg: "®", copy: "©" };

  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }

  const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

  // Source tag -> what it becomes. Anything not listed is dropped and its text kept.
  const PARAGRAPH = new Set(["p", "div", "section", "article", "blockquote", "tr", "dd", "dt", "table", "header", "footer"]);
  const HEADING = { h1: "h3", h2: "h3", h3: "h4", h4: "h4", h5: "h4", h6: "h4" };
  const INLINE = { strong: "strong", b: "strong", em: "em", i: "em", a: "a" };

  function linkHref(attrs) {
    const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || "");
    if (!m) return null;
    const href = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    return /^(https?:|mailto:)/i.test(href) ? href : null;
  }

  /**
   * Source HTML (or plain text) in, clean HTML out; "" when there is nothing to show.
   *
   * Built as a stream rather than by editing the source, because boards nest freely —
   * Ashby wraps every list item in its own <p>, Greenhouse entity-encodes its markup,
   * Lever splits a posting into separate list blocks — and what the page needs is one
   * consistent shape: blocks (p, h3, h4, ul/ol of li) holding inline text.
   */
  function toDisplayHtml(value) {
    let s = String(value || "");
    if (!s.trim()) return "";
    // Greenhouse returns HTML whose markup is itself entity-encoded (&lt;p&gt;), so the
    // tags only become tags after one decode.
    if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
    if (!/<[a-z][^>]*>/i.test(s)) return plainToHtml(decodeEntities(s));
    s = s
      .replace(/<(script|style|head|title|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "");

    let out = "";
    let block = null;      // "p" | "h3" | "h4" while one is open, outside or inside an li
    let inline = [];       // open inline tags, in order, so a block close can close them
    const lists = [];      // [{ tag, liOpen }]
    let textSoFar = 0;
    let liHasContent = false;

    const inLi = () => lists.length && lists[lists.length - 1].liOpen;
    const closeInline = () => { while (inline.length) out += `</${inline.pop()}>`; };
    const closeBlock = () => {
      closeInline();
      if (block) out += `</${block}>`;
      block = null;
    };
    // Text and inline tags need somewhere to live: inside an li they go straight in,
    // anywhere else they open a paragraph.
    const ensureBlock = () => {
      if (block || inLi()) return;
      if (lists.length) {
        // Text loose inside a list, outside any item, is treated as an item of its own.
        out += "<li>";
        lists[lists.length - 1].liOpen = true;
        liHasContent = false;
        return;
      }
      out += "<p>";
      block = "p";
    };
    const closeLi = () => {
      const top = lists[lists.length - 1];
      if (top && top.liOpen) {
        closeBlock();
        out += "</li>";
        top.liOpen = false;
      }
    };

    const TOKEN = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)|(<)/g;
    let m;
    while ((m = TOKEN.exec(s)) && textSoFar < MAX_TEXT) {
      const [, closing, rawTag, attrs, text, stray] = m;
      if (text !== undefined || stray !== undefined) {
        const t = decodeEntities(text ?? stray).replace(/\s+/g, " ");
        if (!t.trim()) {
          // Whitespace only matters between two pieces of inline text.
          if (block || inLi()) out += " ";
          continue;
        }
        ensureBlock();
        out += escapeText(t);
        textSoFar += t.length;
        if (inLi()) liHasContent = true;
        continue;
      }
      const tag = rawTag.toLowerCase();

      if (tag === "br") {
        if (block || inLi()) out += "<br>";
        continue;
      }
      if (tag === "ul" || tag === "ol") {
        if (!closing) {
          if (!inLi()) closeBlock();
          else closeBlock(); // a nested list ends whatever line the li was on
          out += `<${tag}>`;
          lists.push({ tag, liOpen: false });
        } else if (lists.length) {
          closeLi();
          out += `</${lists.pop().tag}>`;
        }
        continue;
      }
      if (tag === "li") {
        if (!closing) {
          if (!lists.length) { closeBlock(); out += "<ul>"; lists.push({ tag: "ul", liOpen: false }); }
          closeLi();
          out += "<li>";
          lists[lists.length - 1].liOpen = true;
          liHasContent = false;
        } else {
          closeLi();
        }
        continue;
      }
      if (HEADING[tag]) {
        if (inLi()) continue; // a heading inside a list item is just its text
        closeBlock();
        if (!closing) { out += `<${HEADING[tag]}>`; block = HEADING[tag]; }
        continue;
      }
      if (PARAGRAPH.has(tag)) {
        if (inLi()) {
          // Ashby's <li><p>…</p></li>: the item is the line. A second paragraph in the
          // same item becomes a line break rather than a new block.
          closeInline();
          if (!closing && liHasContent) out += "<br>";
          continue;
        }
        closeBlock();
        continue;
      }
      if (INLINE[tag]) {
        const name = INLINE[tag];
        if (closing) {
          const i = inline.lastIndexOf(name);
          if (i === -1) continue;
          while (inline.length > i) out += `</${inline.pop()}>`;
        } else {
          let open = name;
          if (name === "a") {
            const href = linkHref(attrs);
            if (!href) continue;
            open = `a href="${escapeAttr(href)}"`;
          }
          ensureBlock();
          out += `<${open}>`;
          inline.push(name);
        }
        continue;
      }
      // Every other tag (span, font, img, table cells…) is dropped; its text stays.
    }
    closeBlock();
    while (lists.length) { closeLi(); out += `</${lists.pop().tag}>`; }

    return tidy(out);
  }

  // Cleanup that is easier on the finished string than during the stream.
  function tidy(html) {
    let prev;
    let s = html;
    do {
      prev = s;
      s = s
        .replace(/<(p|h3|h4|li|strong|em)>\s*(?:<br>\s*)*/g, "<$1>")       // leading space / breaks
        .replace(/\s*(?:<br>\s*)*<\/(p|h3|h4|li|strong|em)>/g, "</$1>")    // trailing space / breaks
        .replace(/<(strong|em)><\/\1>/g, "")
        .replace(/<(p|h3|h4|li)><\/\1>/g, "")
        .replace(/<(ul|ol)><\/\1>/g, "")
        .replace(/(<br>\s*){3,}/g, "<br><br>");
    } while (s !== prev);
    return s.trim();
  }

  // Plain text: blank lines are paragraphs, "•", "-" or "*" lines are list items.
  function plainToHtml(text) {
    const blocks = text.replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    return blocks.map((b) => {
      const lines = b.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return "";
      if (lines.every((l) => /^[•\-*]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${escapeText(l.replace(/^[•\-*]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(escapeText).join("<br>")}</p>`;
    }).join("").slice(0, MAX_TEXT * 2);
  }

  /**
   * The stored HTML back to plain text, for the matching model: paragraphs and list
   * items each on their own line, so the passage splitter in jev.js sees sentences.
   */
  function toPlainText(html) {
    return decodeEntities(String(html || "")
      .replace(/<li>/g, "\n- ")
      .replace(/<br>/g, "\n")
      .replace(/<\/(p|h3|h4|ul|ol)>/g, "\n")
      .replace(/<[^>]+>/g, ""))
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /** { job_id: html } → { shard: { job_id: html } }, for build.js and server.js. */
  function groupByShard(descriptions) {
    const shards = {};
    for (const [id, text] of Object.entries(descriptions || {})) {
      const k = shardOf(id);
      (shards[k] || (shards[k] = {}))[id] = text;
    }
    return shards;
  }

  return { shardOf, toDisplayHtml, toPlainText, groupByShard, SHARDS };
});
