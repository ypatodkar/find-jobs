// Stored descriptions often arrive as one line after ingestion. Restore reading
// structure without treating posting text as HTML.
(function (global) {
  'use strict';
  const HEADING = /(^|[.!?]\s+|\n+)(about the company|about the team|about the role|about us|job description|the role|your role|what you['’]ll do|what you will do|what you['’]ll be doing|in this role, you will|key responsibilities|responsibilities|minimum qualifications|basic qualifications|preferred qualifications|qualifications|requirements|nice to have|who you are|benefits|perks|compensation|equal opportunity|why join us)\s*[.:]{0,2}\s+(?=[A-Z0-9•-])/gim;
  const MARK = '\u0001';

  function sentences(text) {
    if (global.Intl?.Segmenter) {
      return [...new global.Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)]
        .map(part => part.segment.trim()).filter(Boolean);
    }
    return text.split(/(?<=[.!?])\s+(?=[A-Z“"'(])/).filter(Boolean);
  }

  function paragraphs(text, out) {
    const parts = sentences(text.trim());
    let current = '';
    for (const part of parts) {
      if (current && (current.length + part.length > 460 || current.length > 330)) {
        out.push({ type: 'paragraph', text: current });
        current = '';
      }
      current += (current ? ' ' : '') + part;
    }
    if (current) out.push({ type: 'paragraph', text: current });
  }

  function addContent(text, out) {
    const markers = [...text.matchAll(/(?:^|\s)(?:[-•]|\d+[.)])\s+(?=[A-Z])/g)];
    if (markers.length < 2) { paragraphs(text, out); return; }
    paragraphs(text.slice(0, markers[0].index), out);
    const items = markers.map((marker, index) =>
      text.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? text.length).trim()
    ).filter(Boolean);
    // Flattened boards sometimes run the prose after a list straight into its last
    // item, without punctuation. Split only at a clear new-sentence lead-in.
    let trailing = '';
    const last = items.at(-1) || '';
    const lead = [...last.matchAll(/\s+(?=(?:You['’]ll|You will|We['’]re|We will|This role|This is|In this role)\b)/g)]
      .find(match => match.index > 25 && last.length - match.index > 80);
    if (lead) {
      items[items.length - 1] = last.slice(0, lead.index).trim();
      trailing = last.slice(lead.index).trim();
    }
    if (items.length) out.push({ type: 'list', items });
    if (trailing) paragraphs(trailing, out);
  }

  function blocks(value) {
    const text = String(value || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
      .replace(/[\t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) return [];
    const marked = text.replace(HEADING, (_, prefix, title) =>
      `${prefix.trimEnd()}\n\n${MARK}${title}\n`
    );
    const out = [], list = [];
    const flushList = () => { if (list.length) out.push({ type: 'list', items: list.splice(0) }); };
    for (const raw of marked.split(/\n+/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith(MARK)) {
        flushList(); out.push({ type: 'heading', text: line.slice(1) });
      } else if (/^#{1,4}\s+\S/.test(line)) {
        flushList(); out.push({ type: 'heading', text: line.replace(/^#{1,4}\s+/, '') });
      } else if (/^(?:[-•]|\d+[.)])\s+/.test(line)) {
        if ([...line.matchAll(/(?:^|\s)(?:[-•]|\d+[.)])\s+(?=[A-Z])/g)].length > 1) {
          flushList(); addContent(line, out);
        } else list.push(line.replace(/^(?:[-•]|\d+[.)])\s+/, ''));
      } else {
        flushList(); addContent(line, out);
      }
    }
    flushList();
    return out;
  }

  function render(container, value) {
    const fragment = document.createDocumentFragment();
    for (const block of blocks(value)) {
      const tag = { heading: 'h3', paragraph: 'p', list: 'ul' }[block.type];
      const element = document.createElement(tag);
      if (block.type === 'list') {
        for (const item of block.items) {
          const li = document.createElement('li'); li.textContent = item; element.append(li);
        }
      } else element.textContent = block.text;
      fragment.append(element);
    }
    container.replaceChildren(fragment);
  }

  const api = { blocks, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (global.window === global) global.DescriptionFormat = api;
})(globalThis);
