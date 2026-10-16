// Match highlights in the job description: a small
// ✓ / ◐ / ? button after each requirement the analysis found in the text, which opens
// the resume evidence beneath it; and "Find in JD", which scrolls to a requirement and
// flashes it.
//
// The description itself is React's (DetailPane). These buttons and notes are added
// beside React's nodes, never inside its text, and the text nodes are left whole, so
// React can still update or remove everything it rendered.
import { MARK, STATUS_LABEL, findings, squash } from "./match.js";

const MARKS_KEY = "find-jobs-jd-marks";
let marksOn = true;
try { marksOn = localStorage.getItem(MARKS_KEY) !== "off"; } catch { /* default on */ }
export const marksEnabled = () => marksOn;
export function setMarksEnabled(on) {
  marksOn = on;
  try { localStorage.setItem(MARKS_KEY, on ? "on" : "off"); } catch { /* fine */ }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Require a unique exact match in a single employer paragraph or bullet. Only an
// explicitly clipped requirement may use its long, unique prefix. Synthesized lead-ins,
// ambiguous repeats and short approximations stay in the audit.
export function locate(root, passage) {
  if (!root || !passage) return null;
  const wanted = squash(passage.replace(/^[-•]\s*/, "").replace(/…$/, ""));
  if (wanted.length < 15 || (passage.endsWith("…") && wanted.length < 80)) return null;
  const candidates = [];
  for (const block of root.querySelectorAll("p:not(.desc-label), li")) {
    const chars = [];
    let flat = "";
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const parent = n.parentElement;
      if (parent.closest(".jd-mark, .jd-note") || parent.closest("p, li") !== block) continue;
      for (let i = 0; i < n.nodeValue.length; i++) {
        if (/\s/.test(n.nodeValue[i])) continue;
        flat += n.nodeValue[i].toLowerCase();
        chars.push([n, i]);
      }
    }
    const at = flat.indexOf(wanted);
    if (at < 0) continue;
    if (flat.indexOf(wanted, at + 1) >= 0) return null;
    const range = document.createRange();
    const [sn, so] = chars[at];
    const [en, eo] = chars[at + wanted.length - 1];
    range.setStart(sn, so); range.setEnd(en, eo + 1);
    candidates.push(range);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function revealInPane(el) {
  const pane = el.closest(".job-detail");
  if (!pane) return;
  const covered = pane.querySelector(".detail-head")?.offsetHeight || 0;
  const target = pane.scrollTop + el.getBoundingClientRect().top - pane.getBoundingClientRect().top - covered - 24;
  pane.scrollTo({ top: Math.max(0, target), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

let flashTimer;
export function jumpTo(passage) {
  const body = document.getElementById("detail-body");
  const range = locate(body, passage);
  if (!range) return;
  const block = range.startContainer.parentElement.closest("li, p");
  block.setAttribute("tabindex", "-1");
  block.focus({ preventScroll: true });
  revealInPane(block);
  if (window.CSS?.highlights && window.Highlight) {
    CSS.highlights.set("match-passage", new Highlight(range));
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => CSS.highlights.delete("match-passage"), 2400);
  }
  block.classList.add("desc-hit");
  setTimeout(() => block.classList.remove("desc-hit"), 2400);
}

function evidenceHtml(f) {
  const explanation = typeof f.explanation === "string" && f.explanation ? f.explanation : {
    shown: "The analysis linked this requirement to supporting resume evidence.",
    partial: "The analysis classified the resume evidence as partial rather than complete coverage of this requirement.",
    unclear: "The analysis did not find enough resume evidence to establish this requirement.",
  }[f.status];
  return `<p class="requirement-status is-${esc(f.status)}">${MARK[f.status]} ${STATUS_LABEL[f.status]}</p>
    <p class="requirement-label">Job requires</p><p>${esc(f.text)}</p>
    <p class="requirement-label">Resume evidence</p>
    ${f.evidence ? `<blockquote>${esc(f.evidence)}</blockquote>` : `<p>No supporting excerpt was found in this resume. This does not establish that you lack the skill.</p>`}
    <p class="requirement-label">Explanation</p><p>${esc(explanation)}</p>`;
}

export function clearMarks(body) {
  if (window.CSS?.highlights) ["jd-shown", "jd-partial", "jd-unclear", "match-passage"].forEach((k) => CSS.highlights.delete(k));
  body?.querySelectorAll(".jd-mark, .jd-note").forEach((n) => n.remove());
}

/** Mark each requirement found once in the text. Returns how many were placed. */
export function annotate(body, result) {
  clearMarks(body);
  if (!body || !marksOn) return 0;
  const rows = findings(result);
  const repeated = new Map();
  rows.forEach((f) => repeated.set(squash(f.text), (repeated.get(squash(f.text)) || 0) + 1));
  const mapped = rows.filter((f) => repeated.get(squash(f.text)) === 1)
    .map((f) => ({ f, range: locate(body, f.text) })).filter((x) => x.range);
  mapped.forEach(({ f, range }, index) => {
    const mark = document.createElement("button");
    mark.type = "button"; mark.className = `jd-mark is-${f.status}`;
    mark.textContent = MARK[f.status];
    mark.setAttribute("aria-label", `${STATUS_LABEL[f.status]}: ${f.text}. Show evidence`);
    mark.setAttribute("aria-expanded", "false");
    mark.setAttribute("aria-controls", `jd-evidence-${index}`);
    mark.title = `${STATUS_LABEL[f.status]} · Show evidence`;
    mark._finding = f; mark._noteId = `jd-evidence-${index}`;
    // After the complete paragraph or bullet, rather than inside its sentences. A
    // parent bullet's marker stays before any nested list.
    const block = range.startContainer.parentElement.closest("li, p");
    const nested = [...block.children].find((child) => ["UL", "OL"].includes(child.tagName));
    if (nested) block.insertBefore(mark, nested); else block.append(mark);
  });
  return mapped.length;
}

// Keep the reading position when something above an already-scrolled description
// changes height: anchor on the first block still in view.
export function preservePosition(pane, body, fn) {
  if (!pane || !body) { fn(); return; }
  const top = pane.scrollTop;
  const old = body.offsetTop;
  const covered = pane.querySelector(".detail-head")?.offsetHeight || 0;
  const reading = top >= old - covered;
  const visibleTop = pane.getBoundingClientRect().top + covered;
  const anchor = reading ? [...body.querySelectorAll("h3, h4, p, li")]
    .find((node) => !node.closest(".jd-note") && node.getBoundingClientRect().bottom > visibleTop) : null;
  const anchorTop = anchor?.getBoundingClientRect().top;
  fn();
  const delta = anchor?.isConnected ? anchor.getBoundingClientRect().top - anchorTop : reading ? body.offsetTop - old : 0;
  pane.scrollTop = Math.max(0, top + delta);
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const mark = event.target.closest?.(".jd-mark");
    if (!mark) return;
    const open = mark.getAttribute("aria-expanded") === "true";
    mark._note?.remove(); mark._note = null;
    mark.setAttribute("aria-expanded", String(!open));
    if (open) return;
    const block = mark.closest("li, p");
    const note = document.createElement("div");
    note.className = "jd-note"; note.id = mark._noteId;
    note.setAttribute("role", "note");
    note.innerHTML = evidenceHtml(mark._finding);
    if (block.tagName === "LI") block.append(note); else block.after(note);
    mark._note = note;
  });
  document.addEventListener("keydown", (event) => {
    const mark = event.target.closest?.(".jd-mark[aria-expanded='true']");
    if (event.key !== "Escape" || !mark) return;
    mark._note?.remove(); mark._note = null; mark.setAttribute("aria-expanded", "false");
    event.preventDefault(); event.stopImmediatePropagation();
  }, true);
}
