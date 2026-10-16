// Resume match, in the description pane.
//
// A selected resume, an upload option, and an "Analyze resume" button
// that scores the chosen resume against the open job. jobs-ui.js calls
// ResumeMatch.mount() each time it renders a job into the pane.
//
// Resumes and scores belong to a Google account (auth.js), stored on the server
// (server.js, backed by Postgres). Signed out, Upload resume requests sign-in
// before opening the file chooser. An upload sends extracted text once; then only its id
// travels. A job opened again shows the score it already got, read back from the
// database, without calling the model.
//
// The browser keeps the selected resume and the highlight preference.
(function (global) {
  "use strict";

  const ACTIVE = "find-jobs-active-resume";
  const UPLOAD_FILES = "find-jobs-upload-files";
  const API = (global.MATCH_API || "api").replace(/\/$/, "");

  // The "sparkles" mark that has come to mean AI-assisted (Lucide, ISC licence),
  // drawn in currentColor so it takes the accent wherever it sits. Decorative: the
  // words next to it say what the control does.
  const SPARKLE =
    '<svg class="ai-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>' +
    '<path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (paths) => `<svg class="resume-menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
  const CHEVRON = icon('<path d="m6 9 6 6 6-6"/>');
  const PLUS = icon('<path d="M12 5v14M5 12h14"/>');
  const TRASH = icon('<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>');
  const THUMB_UP = icon('<path d="M7 10v12M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8A2 2 0 0 1 17.5 22H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L13 2a3.1 3.1 0 0 1 2 3.9Z"/>');
  const THUMB_DOWN = THUMB_UP.replace('<svg ', '<svg style="transform:rotate(180deg)" ');
  const visitor = () => (global.Visitor ? global.Visitor.id() : null);

  function activeId(items) {
    let id = null;
    try { id = localStorage.getItem(ACTIVE); } catch { /* no storage: first resume */ }
    return items.some((r) => r.id === id) ? id : (items[0] && items[0].id) || null;
  }
  function setActive(id) {
    try { if (id) localStorage.setItem(ACTIVE, id); else localStorage.removeItem(ACTIVE); } catch { /* fine */ }
  }

  // A static host answers 404 or 405 for these paths: the endpoints simply are not
  // there, which is a different message from the server refusing.
  async function call(path, init, timeoutMs) {
    let res;
    try {
      res = await fetch(API + path, timeoutMs ? { ...init, signal: AbortSignal.timeout(timeoutMs) } : init);
    } catch (err) {
      if (err && (err.name === "TimeoutError" || err.name === "AbortError")) throw new Error("The upload took too long and was stopped. Please try again.");
      throw new Error("Could not reach the server. Check your connection and try again.");
    }
    let data = null;
    try { data = await res.json(); } catch { /* handled below */ }
    if (res.status === 401) throw Object.assign(new Error((data && data.error) || "Sign in to use resume matching."), { signedOut: true });
    if (!res.ok || !data) {
      if (res.status === 404 && !(data && data.error)) throw new Error("Resume matching isn't available on this version of the site yet.");
      if (res.status === 405) throw new Error("Resume matching isn't available on this version of the site yet.");
      throw Object.assign(new Error((data && data.error) || "Something went wrong. Please try again."), { code: data && data.code, usage: data && data.usage });
    }
    return data;
  }
  const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // One list per page view, shared by every job opened: the dropdown should not
  // flicker through "loading" on each click.
  let listing = null;
  let items = [];
  function loadList(force) {
    if (!listing || force) {
      const identity = accountVersion;
      listing = call("/resumes")
        .then((d) => {
          if (identity !== accountVersion) throw new Error("The signed-in account changed.");
          items = d.resumes || []; return items;
        })
        .catch((err) => { if (identity === accountVersion) listing = null; throw err; });
    }
    return listing;
  }

  // Scores already fetched this visit, so moving between jobs and back is instant.
  // The database is the record; this only saves the round trip.
  // ---- the daily allowance (server: aws/lambda/usage-store.cjs) ----
  // `limitHit` is set when a check was refused because today's checks are used up; the
  // card then asks for feedback, which unlocks more and re-runs the refused check.
  // `lastUsage` comes back with every paid check, for the "N left today" note.
  let limitHit = null;
  let lastUsage = null;
  const untilReset = (ts) => {
    const h = Math.max(0, Math.round((ts - Date.now()) / 3600000));
    return h <= 1 ? "within the hour" : `in about ${h} hours`;
  };
  function limitHtml(busyUnlock, unlockError) {
    if (!limitHit) return "";
    if (!limitHit.canUnlock) {
      return `<div class="limit-box" role="status"><p><strong>You've used all ${limitHit.limit} resume checks for today.</strong> More open up ${untilReset(limitHit.resetsAt)}. Saved results stay available.</p></div>`;
    }
    return `<form class="limit-box limit-form" data-limit-form novalidate>
      <p><strong>You've used today's ${limitHit.limit} resume checks.</strong> Tell us how resume matching is working for you to unlock ${limitHit.bonus} more today.</p>
      <fieldset class="limit-rating"><legend>How useful has resume matching been?</legend>
        ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="limit-rating" value="${n}" required><span>${n}</span></label>`).join("")}
        <span class="limit-scale" aria-hidden="true">1 not useful · 5 very useful</span>
      </fieldset>
      <label class="limit-message"><span>What's working, and what should be better?</span>
        <textarea name="limit-message" rows="3" minlength="20" maxlength="2000" required placeholder="At least 20 characters"></textarea></label>
      ${unlockError ? `<p class="match-msg error" role="alert">${esc(unlockError)}</p>` : ""}
      <button type="submit" class="match-run analysis-primary"${busyUnlock ? " disabled" : ""}>${busyUnlock ? "Sending…" : `Send feedback and unlock ${limitHit.bonus} check${limitHit.bonus === 1 ? "" : "s"}`}</button>
    </form>`;
  }

  const scores = new Map(); // "resumeId|jobId" -> result | null
  const stale = new Map();  // "resumeId|jobId" -> "description" | "rubric": checked before a change
  const key = (r, j) => r + "|" + j;

  // Sending the original file with the text (the server keeps both, file-store.cjs) is
  // on only with ?upload=files, or once that has been visited in this browser, while
  // it is tried on the live site: the first release of it stalled uploads there.
  // ?upload=text turns it back off.
  function sendsFiles() {
    const flag = new URLSearchParams(global.location.search).get("upload");
    try {
      if (flag === "files") localStorage.setItem(UPLOAD_FILES, "1");
      if (flag === "text") localStorage.removeItem(UPLOAD_FILES);
      return localStorage.getItem(UPLOAD_FILES) === "1";
    } catch { return flag === "files"; }
  }
  sendsFiles(); // read the switch on arrival, so ?upload=text takes effect at once

  // `onStage` hears "uploading" once the file is read, so the card can say which step
  // it is on; a stall then names its step.
  async function addResume(file, onStage) {
    if (!global.ResumeImport) throw new Error('Resume upload could not load. Refresh and try again.');
    const identity = accountVersion;
    const text = await global.ResumeImport.extract(file);
    if (identity !== accountVersion) throw new Error('The signed-in account changed. Please try again.');
    if (!text || text.length < 100) throw new Error('Too little text could be read. Try a text-based PDF or .docx.');
    const original = sendsFiles() && global.ResumeImport.encode ? await global.ResumeImport.encode(file) : undefined;
    if (onStage) onStage("uploading");
    const d = await call('/resumes', json('POST', { visitor: visitor(), label: (file.name || 'Resume').replace(/\.[^.]+$/, ''), fileName: file.name || null, text, file: original }), 60000);
    if (identity !== accountVersion) return null;
    items = [d.resume, ...items]; listing = Promise.resolve(items); setActive(d.resume.id);
    return d.resume;
  }
  async function deleteResume(id) {
    const identity = accountVersion, wasActive = activeId(items) === id;
    await call(`/resumes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (identity !== accountVersion) return;
    items = items.filter((resume) => resume.id !== id); listing = Promise.resolve(items);
    [...scores.keys()].forEach((cacheKey) => { if (cacheKey.startsWith(id + '|')) { scores.delete(cacheKey); stale.delete(cacheKey); } });
    if (wasActive) setActive(items[0]?.id || null);
  }
  // One dropdown for everything about resumes, in the description pane: pick one,
  // delete any of them from its own row, or add another from the foot of the list.
  // Drawn like the select-menu.js pickers, but by hand, since a <select> cannot hold
  // the buttons.
  function pickerHtml(selected, disabled) {
    const act = "data-act";
    const off = disabled ? " disabled" : "";
    const active = items.find((r) => r.id === selected);
    const label = active ? active.label : items.length ? "Select resume" : "No resumes yet";
    return `<details class="company-picker select-picker resume-picker${disabled ? " is-disabled" : ""}"><summary aria-haspopup="true" aria-label="Resume: ${esc(label)}" title="${esc(label)}"${disabled ? ' aria-disabled="true"' : ""}>${esc(label)}</summary>
      <div class="company-panel select-panel resume-picker-panel" role="group" aria-label="Your resumes">
        ${items.map((r) => `<div class="resume-picker-row"><button type="button" class="select-option${r.id === selected ? " is-selected" : ""}" ${act}="choose" data-resume-id="${esc(r.id)}" aria-pressed="${r.id === selected}" aria-label="${esc(r.label)}" title="${esc(r.label)}"${off}><span>${esc(r.label)}</span></button><button type="button" class="resume-picker-delete" ${act}="remove" data-resume-id="${esc(r.id)}" aria-label="Delete ${esc(r.label)}" title="Delete resume"${off}>${TRASH}</button></div>`).join("")}
        <button type="button" class="resume-picker-add" ${act}="upload"${off}>${PLUS}Add resume</button>
      </div></details>`;
  }
  // Opening the dropdown puts focus on the chosen resume, as select-menu.js does.
  function wirePickers(root) {
    root.querySelectorAll('.resume-picker').forEach((picker) => picker.addEventListener('toggle', () => {
      if (!picker.open) return;
      if (picker.classList.contains('is-disabled')) { picker.open = false; return; }
      (picker.querySelector('.select-option.is-selected') || picker.querySelector('.select-option, .resume-picker-add'))?.focus({ preventScroll: true });
    }));
  }
  // Arrow keys open the dropdown, then walk its rows, delete buttons included; Escape
  // closes it. Returns whether the key was the dropdown's.
  function pickerKeydown(event) {
    const picker = event.target.closest(".resume-picker");
    if (!picker) return false;
    const summary = picker.firstElementChild;
    if (!picker.open) {
      if (event.target !== summary || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return false;
      event.preventDefault();
      if (!picker.classList.contains("is-disabled")) picker.open = true;
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      picker.open = false; summary.focus({ preventScroll: true });
      return true;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
    const list = [...picker.querySelectorAll(".resume-picker-panel button:not(:disabled)")];
    const at = list.indexOf(document.activeElement);
    const next = event.key === "Home" ? list[0] : event.key === "End" ? list[list.length - 1]
      : list[Math.max(0, Math.min(list.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    event.preventDefault(); next?.focus();
    return true;
  }

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    const d = Math.round(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }

  const STATUS_LABEL = { shown: "Demonstrated", partial: "Partial", unclear: "Not evidenced" };
  const MARK = { shown: "✓", partial: "◐", unclear: "?" };
  const KIND_LABEL = { required: "Required qualifications", duty: "Responsibilities", preferred: "Preferred qualifications", other: "Other requirements" };
  const MARKS_KEY = "find-jobs-jd-marks";
  let marksOn = true;
  try { marksOn = localStorage.getItem(MARKS_KEY) !== "off"; } catch { /* default on */ }
  let accountVersion = 0;
  const squash = (t) => String(t).toLowerCase().replace(/\s+/g, "");
  const findings = (r) => Array.isArray(r?.findings) ? r.findings.filter((f) => STATUS_LABEL[f.status] && typeof f.text === "string") : [];
  const INSIGHT_LIMIT = 2;
  const ranked = (rows) => {
    const kind = { required: 0, preferred: 1, duty: 2, other: 2 };
    const status = { unclear: 0, partial: 1, shown: 2 };
    return rows.slice().sort((a, b) => (kind[a.kind] ?? 2) - (kind[b.kind] ?? 2) ||
      (b.weight || 0) - (a.weight || 0) || status[a.status] - status[b.status] || (b.confidence || 0) - (a.confidence || 0));
  };

  // Require a unique exact match in a single employer paragraph or bullet. Only an
  // explicitly clipped requirement may use its long, unique prefix. Synthesized
  // lead-ins, ambiguous repeats and short approximations stay in the audit.
  function locate(root, passage) {
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
  function jumpTo(passage) {
    const body = document.getElementById("detail-body");
    const range = locate(body, passage);
    if (!range) return;
    const block = range.startContainer.parentElement.closest("li, p");
    block.setAttribute("tabindex", "-1");
    block.focus({ preventScroll: true });
    revealInPane(block);
    if (global.CSS?.highlights && global.Highlight) {
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

  function clearMarks(body) {
    if (global.CSS?.highlights) ["jd-shown", "jd-partial", "jd-unclear", "match-passage"].forEach((k) => CSS.highlights.delete(k));
    body?.querySelectorAll(".jd-mark, .jd-note").forEach((n) => n.remove());
    body?.normalize();
  }

  function annotate(body, result) {
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
      // Keep indicators after the complete paragraph or bullet, rather than inside
      // its sentences. A parent bullet's marker stays before any nested list.
      const block = range.startContainer.parentElement.closest('li, p');
      const nested = [...block.children].find((child) => ['UL', 'OL'].includes(child.tagName));
      if (nested) block.insertBefore(mark, nested); else block.append(mark);
    });
    return mapped.length;
  }

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

  // Presentation only: remove wordy lead-ins, then use a bounded excerpt. Keep
  // the employer's full text for passage matching and the requirement breakdown.
  function insightSummary(text) {
    let summary = text.replace(/\s+/g, ' ').trim()
      .replace(/^(?:the (?:successful|ideal) candidate (?:will|should|must) (?:have|be able to)|you(?:'ll| will) be responsible for)\s+/i, '')
      .replace(/^(?:demonstrate(?:d)? (?:practical )?experience (?:with|in)|(?:proven |hands-on |relevant |professional )?experience (?:with|in)|ability to|responsible for|you (?:will|should)|you'll)\s+/i, '');
    if (/^[a-z][a-z]/.test(summary)) summary = summary[0].toUpperCase() + summary.slice(1);
    if (summary.length > 112) summary = summary.slice(0, 112).replace(/\s+\S*$/, '').replace(/[,:;\s]+$/, '') + '…';
    return summary;
  }

  function insightsHtml(rows) {
    const chosen = rows.slice(0, 1);
    const second = rows.find((f) => f !== chosen[0] && f.status === 'shown') ||
      rows.find((f) => f !== chosen[0] && f.status === 'partial') || rows[1];
    if (second) chosen.push(second);
    return `<section class="analysis-insights-section" aria-labelledby="analysis-insights-title"><h3 id="analysis-insights-title">Key things to review</h3><ul class="analysis-insights" aria-label="Prioritized insights">${chosen.slice(0, INSIGHT_LIMIT).map((f) => {
      const text = insightSummary(f.text);
      const lead = { shown: 'Supported', partial: 'Clarify evidence', unclear: 'Review evidence' }[f.status];
      return `<li title="${esc(f.text)}"><span class="insight-lead">${lead}</span><div class="insight-copy"><a class="requirement-locate" href="#detail-body" data-passage="${esc(f.text)}" aria-label="Find in job description: ${esc(f.text)}" hidden>${esc(text)}</a><span>${esc(text)}</span></div></li>`;
    }).join('')}</ul></section>`;
  }

  function requirementHtml(f, index, expanded) {
    const status = { shown: 'Demonstrated', partial: 'Partial', unclear: 'Not found' }[f.status];
    return `<li data-status="${f.status}"><details class="requirement-row" data-index="${index}"${expanded.has(index) ? ' open' : ''}>
      <summary><span class="requirement-dot is-${f.status}" aria-hidden="true"></span><span class="requirement-row-text">${esc(f.text)}</span><span class="requirement-row-status is-${f.status}" title="${STATUS_LABEL[f.status]}">${status}</span>${CHEVRON}</summary>
      <div class="requirement-evidence">${f.evidence ? `<blockquote aria-label="Resume evidence">${esc(f.evidence)}</blockquote>` : ''}${f.explanation ? `<p>${esc(f.explanation)}</p>` : ''}<p class="requirement-navigation"><a class="requirement-locate" href="#detail-body" data-passage="${esc(f.text)}" hidden>Find in JD</a><span>Original wording shown above.</span></p></div>
    </details></li>`;
  }

  function categoryHtml(rows, expanded) {
    return ["required", "preferred", "duty", "other"].map((kind) => {
      const group = rows.filter((f) => kind === "other" ? !["required", "preferred", "duty"].includes(f.kind) : f.kind === kind);
      if (!group.length) return "";
      const heading = { required: 'Required', preferred: 'Preferred', duty: 'Responsibilities', other: 'Other requirements' }[kind];
      return `<section class="requirement-group"><h4>${heading} <span data-group-count>${group.length}</span></h4><ul class="requirement-rows">${group.map((f) => requirementHtml(f, rows.indexOf(f), expanded)).join("")}</ul></section>`;
    }).join("");
  }

  function mount(host, job, description) {
    let unlockError = null; // a problem with the unlock feedback form, shown in it
    if (!host || !job?.job_id) return;
    const Import = global.ResumeImport;
    const pane = host.closest(".job-detail");
    const body = pane.querySelector("#detail-body");
    const descriptionControls = pane.querySelector(".description-controls");
    let busy = "loading", message = null, hasDescription = null, loaded = false, signedOut = false;
    let breakdownOpen = false, revision = 0;
    let breakdownFilter = 'all', breakdownReturnScroll = 0;
    let showResumeToolbar = false;
    const expandedRows = new Set();
    const pendingReviews = new Set();
    const reviewErrors = new Map();
    const input = document.createElement("input");
    input.type = "file"; input.accept = Import ? Import.ACCEPT : ".pdf,.docx,.txt,.md"; input.hidden = true;
    const current = () => activeId(items);
    const stored = () => current() ? scores.get(key(current(), job.job_id)) : undefined;
    const hit = () => !signedOut && (!busy || busy === "checking") ? stored() : null;

    // Anchor the reading position when controls resize above an already-scrolled JD.
    function preservePosition(fn) {
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
    function mapLinks(root) {
      root?.querySelectorAll("[data-passage]").forEach((link) => {
        const mapped = !!locate(body, link.dataset.passage);
        link.hidden = !mapped;
        link.nextElementSibling.hidden = mapped;
      });
    }
    function notes(result) {
      const limits = result?.limits || {};
      return [limits.resumeShortened ? "Only the first part of the resume was assessed." : limits.resumeQuotesCapped ? "The resume was read in full; supporting quotes are limited to its first 100 lines." : "",
        limits.descriptionShortened ? "Only the first part of the description was read in full." : "",
        limits.requirementsCapped ? "Only the 30 most important extracted items were compared." : ""]
        .filter(Boolean).map((n) => `<p class="match-fine">${n}</p>`).join("");
    }
    const reviewKey = (result, id = current()) => key(id, job.job_id) + '|' + result?.checkedAt;
    function feedbackState(result) {
      const id = reviewKey(result);
      return {
        disabled: !!busy || pendingReviews.has(id) || !Number.isSafeInteger(result?.checkedAt),
        rating: result?.feedback?.rating,
        message: pendingReviews.has(id) ? 'Saving…' : reviewErrors.get(id) || (result?.feedback ? 'Feedback saved. Thank you.' : ''),
        error: reviewErrors.has(id),
      };
    }
    function feedbackHtml(result) {
      const state = feedbackState(result);
      return `<div class="analysis-feedback" role="group" aria-label="Review this analysis"><span class="analysis-feedback-label">Was this analysis helpful?</span><div class="analysis-feedback-buttons">${[['up', 'Helpful analysis', THUMB_UP], ['down', 'Not helpful analysis', THUMB_DOWN]].map(([rating, label, svg]) => `<button type="button" data-act="review" data-rating="${rating}" aria-label="${label}" title="${label}" aria-pressed="${state.rating === rating}"${state.disabled ? ' disabled' : ''}>${svg}</button>`).join('')}</div><span class="analysis-feedback-status${state.error ? ' is-error' : ''}" role="status" aria-live="polite">${esc(state.message)}</span></div>`;
    }
    function refreshFeedback() {
      const section = host.querySelector('.analysis-feedback');
      if (!section) return;
      const state = feedbackState(hit());
      section.querySelectorAll('[data-rating]').forEach((button) => {
        button.disabled = state.disabled;
        button.setAttribute('aria-pressed', String(state.rating === button.dataset.rating));
      });
      const status = section.querySelector('.analysis-feedback-status');
      status.textContent = state.message;
      status.classList.toggle('is-error', state.error);
    }
    async function review(rating) {
      const result = hit(), id = current(), identity = accountVersion;
      if (!result || feedbackState(result).disabled || result.feedback?.rating === rating) return;
      const requestKey = reviewKey(result, id);
      pendingReviews.add(requestKey); reviewErrors.delete(requestKey); refreshFeedback();
      try {
        const response = await call('/match/feedback', json('POST', { resume_id: id, job_id: job.job_id, checked_at: result.checkedAt, rating }));
        if (identity !== accountVersion) return;
        const cached = scores.get(key(id, job.job_id));
        if (cached?.checkedAt === result.checkedAt) cached.feedback = response.feedback;
      } catch (err) {
        if (identity === accountVersion) reviewErrors.set(requestKey, err.message || 'Could not save feedback. Please try again.');
      } finally {
        pendingReviews.delete(requestKey);
        if (identity === accountVersion && host.isConnected) refreshFeedback();
      }
    }
    function filterBreakdown(status) {
      const section = host.querySelector('.requirement-breakdown');
      if (!section) return;
      breakdownFilter = status;
      let visible = 0;
      const list = section.querySelectorAll('.requirement-rows > li');
      list.forEach((row) => {
        row.hidden = status !== 'all' && row.dataset.status !== status;
        if (!row.hidden) visible++;
      });
      section.querySelectorAll('.requirement-group').forEach((group) => {
        const rows = [...group.querySelectorAll('.requirement-rows > li')];
        const count = rows.filter((row) => !row.hidden).length;
        group.hidden = count === 0;
        group.querySelector('[data-group-count]').textContent = status === 'all' ? String(count) : `${count} / ${rows.length}`;
      });
      section.querySelectorAll('[data-filter-status]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filterStatus === status)));
      section.querySelector('.breakdown-results').textContent = `${visible} of ${list.length} requirements`;
      section.querySelector('.breakdown-empty').hidden = visible !== 0;
    }
    function setBreakdownOpen(open, restore = true) {
      const section = host.querySelector('.requirement-breakdown');
      if (!section) return;
      if (open) breakdownReturnScroll = pane.scrollTop;
      breakdownOpen = open;
      expandedRows.clear();
      section.querySelectorAll('.requirement-row[open]').forEach((row) => { row.open = false; });
      if (open) {
        filterBreakdown('all');
        section.showModal();
        section.querySelector('[data-act="breakdown-close"]')?.focus({ preventScroll: true });
      } else if (section.open) section.close();
      const trigger = host.querySelector('.breakdown-open');
      trigger?.setAttribute('aria-expanded', String(open));
      if (!open && restore) {
        pane.scrollTop = breakdownReturnScroll;
        trigger?.focus({ preventScroll: true });
      }
    }
    function render(focusAct) {
      if (!host.isConnected) return;
      const result = hit();
      if (result) showResumeToolbar = true;
      const rows = ranked(findings(result));
      const hasBreakdown = Array.isArray(result?.findings);
      const controlsBusy = !!busy;
      const canCheck = loaded && !signedOut && items.length && hasDescription !== false && !controlsBusy;
      const select = pickerHtml(current(), controlsBusy);
      const controls = `<div class="analysis-resume-controls"><div class="analysis-entry-picker">${select}</div></div>`;
      const action = `<button type="button" class="match-run${result ? " analysis-reanalyze" : " analysis-primary"}${busy === "checking" ? " is-busy" : ""}" data-act="run"${canCheck ? "" : " disabled"}>${SPARKLE}<span>${busy === "checking" ? result ? "Updating…" : "Analyzing resume…" : result ? "Reanalyze" : "Analyze resume"}</span></button>`;
      // Analyzed: the dropdown with when it was analyzed, and Reanalyze to the side. Not
      // yet (a resume just switched to): no label, just Analyze under the dropdown.
      const toolbar = result
        ? `<div class="analysis-header-toolbar"><div class="analysis-source"><div class="analysis-header-picker">${select}</div><span class="analysis-timestamp">${result.checkedAt ? `Analyzed ${esc(ago(result.checkedAt))}` : 'Analyzed'}</span></div><div class="analysis-tools">${action}</div></div>`
        : `<div class="analysis-header-toolbar is-pending"><div class="analysis-header-picker">${select}</div>${action}</div>`;
      let content;
      if (result) {
        const score = Number.isFinite(result.score) ? result.score : null;
        const metric = (status) => rows.filter((f) => f.status === status).length;
        content = `<div class="analysis-result">
          ${toolbar}
          <div class="analysis-score-section"><div class="analysis-score-head">
            ${score !== null ? `<span class="analysis-score-number">${score}<small>/100</small></span>` : ''}
            <h3>Resume evidence score</h3></div>
              ${score !== null ? `<progress class="analysis-progress" value="${score}" max="100" aria-label="Resume evidence score">${score}/100</progress>` : ''}
              ${hasBreakdown ? `<ul class="analysis-metrics" aria-label="Requirement classifications"><li><strong>${metric('shown')}</strong> Demonstrated</li><li><strong>${metric('partial')}</strong> Partial</li><li><strong>${metric('unclear')}</strong> Not evidenced</li></ul>` : ''}
              ${score !== null ? feedbackHtml(result) : ''}
          </div>
          ${busy === 'checking' ? `<p class="analysis-loading" role="status"><span class="analysis-spinner" aria-hidden="true"></span>Updating analysis… Previous result shown.</p>` : ''}
          ${rows.length ? insightsHtml(rows) : `<p class="match-msg">${hasBreakdown ? 'No requirement findings were returned.' : 'The stored analysis has no requirement breakdown. Reanalyze for current details.'}</p>`}
          <div class="analysis-links">${rows.length ? `<button type="button" class="breakdown-open" data-act="breakdown" aria-haspopup="dialog" aria-expanded="${breakdownOpen}" aria-controls="requirement-breakdown">Full requirement breakdown (${rows.length})</button>` : ''}
            <details class="scoring-help"><summary>How scoring works</summary><div class="scoring-explanation"><p>The score measures resume evidence coverage of extracted requirements. Required items carry more weight than responsibilities or preferences, and partial evidence contributes to coverage. It is not a prediction of hiring outcomes.</p>${notes(result)}</div></details>
          </div>
          ${rows.length ? `<dialog class="requirement-breakdown" id="requirement-breakdown" aria-labelledby="breakdown-title"><div class="breakdown-head"><h3 id="breakdown-title">Requirement breakdown</h3><button type="button" data-act="breakdown-close" aria-label="Close requirement breakdown" autofocus>Close</button></div><div class="breakdown-filters" role="group" aria-label="Filter requirements by status">${[['all', 'All'], ['shown', 'Demonstrated'], ['partial', 'Partial'], ['unclear', 'Not found']].map(([status, label]) => `<button type="button" data-act="filter-status" data-filter-status="${status}" aria-pressed="${breakdownFilter === status}">${label} <span>${status === 'all' ? rows.length : metric(status)}</span></button>`).join('')}</div><p class="breakdown-results" role="status" aria-live="polite"></p><p class="breakdown-note">Match status describes evidence in this resume. Open a row to explore available evidence.</p><div class="breakdown-content">${categoryHtml(rows, expandedRows)}<p class="breakdown-empty" hidden>No requirements match this status.</p></div><button type="button" class="breakdown-collapse" data-act="breakdown-close">Close breakdown</button></dialog>` : ''}

          </div>`;
      } else if (signedOut) {
        content = `<div class="analysis-entry analysis-entry-upload"><h3>${SPARKLE} Resume match</h3><button type="button" class="match-run analysis-primary" data-act="upload">${SPARKLE}Upload resume</button><p class="match-msg">Add a resume to analyse this job.</p></div>`;
      } else if (!loaded) {
        content = `<div class="analysis-entry"><h3>${SPARKLE} Resume match</h3><p class="analysis-loading" role="status"><span class="analysis-spinner" aria-hidden="true"></span>Loading resume…</p></div>`;
      } else if (message?.kind === 'error' && !listing) {
        content = `<div class="analysis-entry"><h3>${SPARKLE} Resume match</h3><p class="match-msg">Analysis unavailable</p></div>`;
      } else if (!items.length) {
        content = `<div class="analysis-entry analysis-entry-upload"><h3>${SPARKLE} Resume match</h3><button type="button" class="match-run analysis-primary" data-act="upload"${controlsBusy ? ' disabled' : ''}>${SPARKLE}${busy === 'reading' ? 'Reading resume…' : busy === 'uploading' ? 'Uploading resume…' : 'Upload resume'}</button><p class="match-msg">Add a resume to analyse this job.</p></div>`;
      } else if (showResumeToolbar) {
        content = `${toolbar}${busy === 'checking' || busy === 'loading' ? `<p class="analysis-loading" role="status"><span class="analysis-spinner" aria-hidden="true"></span>${busy === 'checking' ? 'Analyzing resume…' : 'Loading saved analysis…'}</p>` : `<p class="match-msg">Analyze this resume against the selected job.</p>`}`;
      } else {
        content = `<div class="analysis-entry analysis-entry-ready"><h3>${SPARKLE} Resume match</h3>${controls}<div class="analysis-entry-actions">${action}</div></div>
          ${busy === 'checking' || busy === 'loading' ? `<p class="analysis-loading" role="status"><span class="analysis-spinner" aria-hidden="true"></span>${busy === 'checking' ? 'Analyzing resume…' : 'Loading analysis…'}</p>` : ''}`;
      }
      const outdated = current() && stale.get(key(current(), job.job_id));
      preservePosition(() => {
        host.classList.toggle('is-analyzed', !!result);
        host.innerHTML = `<div class="analysis-shell" aria-busy="${!!busy}">${content}
          ${limitHtml(busy === "unlocking", unlockError)}
          ${!limitHit && lastUsage && lastUsage.remaining <= 5 ? `<p class="match-fine limit-left">${lastUsage.remaining} resume check${lastUsage.remaining === 1 ? "" : "s"} left today</p>` : ""}
          ${message ? `<p class="match-msg ${message.kind}" role="status">${esc(message.text)}${!items.length && !signedOut && !busy ? `<button type="button" class="analysis-retry" data-act="retry">Retry</button>` : ''}</p>` : ''}
          ${hasDescription === false ? `<p class="match-msg">This job has no description to compare against.</p>` : ''}
          ${outdated && !result ? `<p class="match-msg">${outdated === 'description' ? 'The job description has changed.' : 'The analysis has been updated.'} Analyze your resume for current results.</p>` : ''}
          </div>`;
        host.append(input);
        if (descriptionControls) {
          descriptionControls.hidden = !result || !hasBreakdown || hasDescription !== true;
          descriptionControls.querySelector('input').checked = marksOn;
        }
        wirePickers(host);
        host.querySelectorAll('.requirement-row').forEach((row) => row.addEventListener('toggle', () => {
          if (row.open) expandedRows.add(Number(row.dataset.index));
          else expandedRows.delete(Number(row.dataset.index));
        }));
        filterBreakdown(breakdownFilter);
        mapLinks(host);
        const dialog = host.querySelector('.requirement-breakdown');
        dialog?.addEventListener('cancel', (event) => {
          event.preventDefault();
          setBreakdownOpen(false);
        });
        dialog?.addEventListener('click', (event) => {
          if (event.target !== dialog) return;
          const bounds = dialog.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setBreakdownOpen(false);
        });
        if (dialog && breakdownOpen) dialog.showModal();
      });
      if (focusAct) host.querySelector(`[data-act="${focusAct}"]`)?.focus({ preventScroll: true });
    }
    function remark() {
      if (!host.isConnected || body.dataset.ready !== job.job_id) return;
      preservePosition(() => annotate(body, hit()));
      mapLinks(host);
    }
    async function fetchStored(id, version) {
      if (!id || scores.has(key(id, job.job_id))) return;
      const identity = accountVersion;
      const d = await call(`/match?resume=${encodeURIComponent(id)}&job=${encodeURIComponent(job.job_id)}`);
      if (identity !== accountVersion || version !== revision) return;
      scores.set(key(id, job.job_id), d.match || null);
      if (d.stale) stale.set(key(id, job.job_id), d.stale.reason);
    }
    async function start() {
      const version = ++revision;
      busy = "loading"; message = null; loaded = false; breakdownOpen = false; breakdownFilter = 'all'; expandedRows.clear();
      clearMarks(body); render();
      if (global.Auth) {
        await global.Auth.ready;
        if (version !== revision || !host.isConnected) return;
        signedOut = !global.Auth.account();
        if (signedOut) { busy = null; render(); return; }
      }
      try {
        await loadList();
        if (version !== revision || !host.isConnected) return;
        loaded = true;
        await fetchStored(current(), version);
      } catch (err) {
        if (version !== revision) return;
        loaded = true;
        if (err.signedOut) signedOut = true;
        else message = { kind: "error", text: err.message };
      }
      if (version !== revision || !host.isConnected) return;
      busy = null; render(); remark();
    }
    current_mount = { host, start, chooseResume, refresh: render, isBusy: () => !!busy };

    async function upload(file) {
      if (signedOut || (global.Auth && !global.Auth.account())) { global.Auth?.requestResumeSignIn(); return; }
      if (!Import) { message = { kind: "error", text: "Resume upload could not load. Refresh and try again." }; render(); return; }
      const version = ++revision, identity = accountVersion;
      busy = "reading"; message = null; breakdownOpen = false; breakdownFilter = 'all'; expandedRows.clear(); remark(); render();
      let uploaded = false;
      try {
        const resume = await addResume(file, (stage) => {
          if (version === revision && host.isConnected) { busy = stage; render(); }
        });
        // The account changed mid-upload: start() has already redrawn the card.
        if (identity !== accountVersion || !resume) return;
        scores.set(key(resume.id, job.job_id), null); uploaded = true;
      } catch (err) {
        console.error(`Resume upload failed while ${busy === "uploading" ? "uploading" : "reading"}:`, err);
        if (err.signedOut) signedOut = true;
        message = { kind: "error", text: err.message || "That file could not be read." };
      }
      if (version !== revision || !host.isConnected) return;
      busy = null;
      if (uploaded && hasDescription !== false) run(); else render();
    }
    async function run() {
      const id = current();
      if (!id || busy) return;
      const version = ++revision, identity = accountVersion, again = !!stored();
      const restoreFocus = host.contains(document.activeElement);
      busy = "checking"; message = null; remark(); render();
      try {
        const result = await call("/match", json("POST", { resume_id: id, job_id: job.job_id, title: job.title, force: again }));
        if (identity !== accountVersion) return;
        scores.set(key(id, job.job_id), result); stale.delete(key(id, job.job_id));
        if (result && result.usage) lastUsage = result.usage;
        limitHit = null;
      } catch (err) {
        if (err.signedOut) signedOut = true;
        else if (err.code === "daily_limit" && err.usage) { limitHit = err.usage; unlockError = null; }
        else message = { kind: "error", text: err.message };
      }
      if (version !== revision || !host.isConnected) return;
      busy = null; render(restoreFocus && document.activeElement === document.body ? "run" : null); remark();
      if (limitHit && limitHit.canUnlock) host.querySelector('[data-limit-form] input')?.focus({ preventScroll: true });
    }
    // Feedback that unlocks more checks, then the check that was refused runs.
    async function unlock(form) {
      const rating = form.querySelector('input[name="limit-rating"]:checked')?.value;
      const text = form.querySelector('textarea').value.trim();
      if (!rating) { unlockError = "Choose a rating from 1 to 5."; render(); return; }
      if (text.length < 20) { unlockError = "Please write at least 20 characters, so we know what to improve."; render(); host.querySelector('[data-limit-form] textarea').value = text; return; }
      busy = "unlocking"; unlockError = null; render();
      try {
        const d = await call("/match/unlock", json("POST", { rating: Number(rating), message: text, job_id: job.job_id }));
        lastUsage = d.usage; limitHit = null;
        busy = null;
        run();
      } catch (err) {
        busy = null;
        if (err.code === "no_unlock" && err.usage) { limitHit = { ...err.usage, canUnlock: false }; unlockError = null; }
        else unlockError = err.message;
        render();
      }
    }
    async function remove(id = current()) {
      const r = items.find((x) => x.id === id);
      if (!r || !global.confirm(`Remove “${r.label}”?`)) return;
      const version = ++revision, identity = accountVersion;
      busy = "removing"; message = null; breakdownOpen = false; breakdownFilter = 'all'; expandedRows.clear(); render(); remark();
      try {
        await deleteResume(id);
        if (identity !== accountVersion) return;
        await fetchStored(current(), version);
      } catch (err) { message = { kind: "error", text: err.message }; }
      if (version !== revision || !host.isConnected) return;
      busy = null; render(); remark();
    }
    host.addEventListener("click", (event) => {
      const to = event.target.closest("[data-passage]");
      if (to) {
        event.preventDefault();
        if (breakdownOpen) setBreakdownOpen(false, false);
        jumpTo(to.dataset.passage); return;
      }
      const act = event.target.closest("[data-act]");
      if (!act || act.disabled) return;
      const action = act.dataset.act;
      if (action === 'breakdown') {
        setBreakdownOpen(!breakdownOpen);
      }
      else if (action === 'breakdown-close') setBreakdownOpen(false);
      else if (action === 'filter-status') filterBreakdown(act.dataset.filterStatus);
      else if (action === "retry") start();
      else if (action === "upload") {
        act.closest('.resume-picker')?.removeAttribute('open');
        if (signedOut || (global.Auth && !global.Auth.account())) global.Auth?.requestResumeSignIn();
        else input.click();
      }
      else if (action === "choose") { act.closest('.resume-picker')?.removeAttribute('open'); chooseResume(act.dataset.resumeId); }
      else if (action === "run") run();
      else if (action === "review") review(act.dataset.rating);
      else if (action === "remove") remove(act.dataset.resumeId);
    });
    host.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-limit-form]");
      if (!form) return;
      event.preventDefault();
      if (busy !== "unlocking") unlock(form);
    });
    descriptionControls?.addEventListener("change", (event) => {
      if (event.target.matches('input')) {
        marksOn = event.target.checked;
        try { localStorage.setItem(MARKS_KEY, marksOn ? "on" : "off"); } catch { /* fine */ }
        remark();
      }
    });
    async function chooseResume(id, focusPicker = true) {
      if (busy || !items.some((resume) => resume.id === id)) return;
      const version = ++revision;
      setActive(id); busy = scores.has(key(id, job.job_id)) ? null : "loading"; message = null; breakdownOpen = false; breakdownFilter = 'all'; expandedRows.clear(); remark(); render();
      try { await fetchStored(id, version); } catch (err) { if (version === revision) message = { kind: "error", text: err.message }; }
      if (version !== revision || !host.isConnected) return;
      busy = null; render(); remark();
      if (focusPicker) host.querySelector('.select-picker > summary')?.focus({ preventScroll: true });
    }
    host.addEventListener("keydown", (event) => {
      if (pickerKeydown(event) || event.key !== "Escape") return;
      const menu = event.target.closest("details[open]");
      if (menu) { menu.open = false; menu.querySelector("summary").focus({ preventScroll: true }); }
      else if (breakdownOpen && event.target.closest('.requirement-breakdown')) setBreakdownOpen(false);
      else return;
      event.preventDefault(); event.stopPropagation();
    });
    const onReady = (event) => {
      if (!host.isConnected) { document.removeEventListener("description-ready", onReady); return; }
      if (event.detail?.jobId === job.job_id) { hasDescription = event.detail.hasText; remark(); render(); }
    };
    document.addEventListener("description-ready", onReady);
    input.addEventListener("change", () => { const file = input.files?.[0]; input.value = ""; if (file) upload(file); });
    start();
    description?.then((text) => {
      if (!host.isConnected) return;
      hasDescription = text === null ? false : !!text; render(); remark();
    });
  }

  // Signing in or out changes whose resumes these are: forget everything cached and
  // redraw the card that is on screen.
  let current_mount = null;
  if (global.Auth) {
    global.Auth.onChange(() => {
      accountVersion++;
      listing = null;
      items = [];
      scores.clear();
      stale.clear();
      if (current_mount && current_mount.host.isConnected) current_mount.start();
    });
    global.addEventListener("auth-error", (e) => {
      if (current_mount && current_mount.host.isConnected) {
        const p = current_mount.host.querySelector(".match-signin");
        if (p) p.insertAdjacentHTML("beforebegin", `<p class="match-msg error">${esc(e.detail || "Sign-in failed.")}</p>`);
      }
    });
  }

  global.ResumeMatch = { mount };
})(window);
