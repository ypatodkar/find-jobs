// Turn an uploaded resume into plain text, in the browser.
//
// Extraction happens here rather than on the server. The upload then sends both: the
// extracted text, which matching reads, and the original file, which the server keeps
// beside it (aws/lambda/file-store.cjs) so it can be read again later.
//
// Four formats, three strategies:
//
//   .txt .md   the file already is text
//   .docx      a ZIP holding word/document.xml; inflated with DecompressionStream,
//              which every current browser has, so no library is needed
//   .pdf       pdf.js, fetched from a CDN only when a PDF is actually chosen
//   .doc       the pre-2007 binary format. Not supported, and says so plainly rather
//              than returning the mojibake that reading it as text would produce.
(function (global) {
  "use strict";

  var PDFJS_VERSION = "4.6.82";
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.min.mjs";
  var PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VERSION + "/pdf.worker.min.mjs";

  // Resumes are short. Anything larger than this is not a CV, and reading it would
  // mean holding tens of megabytes in memory to produce text we would then truncate.
  var MAX_BYTES = 4 * 1024 * 1024; // also the most the server keeps (file-store.cjs)

  function tidy(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/ /g, " ")        // PDFs and Word both emit non-breaking spaces
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // ---- .docx ----------------------------------------------------------------
  //
  // A ZIP read backwards: find the end-of-central-directory marker, walk the entries
  // it points at, and inflate the one member we want. Only word/document.xml is read —
  // a .docx also carries styles, images and metadata that are of no interest here.

  function findEOCD(view) {
    // The record is 22 bytes plus an optional comment of up to 65,535.
    for (var i = view.byteLength - 22; i >= 0 && i > view.byteLength - 65557; i--) {
      if (view.getUint32(i, true) === 0x06054b50) return i;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function docxText(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    var eocd = findEOCD(view);
    if (eocd < 0) throw new Error("That .docx file looks damaged — no ZIP directory in it.");

    var count = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var decoder = new TextDecoder();

    for (var n = 0; n < count; n++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      var method = view.getUint16(offset + 10, true);
      var compressedSize = view.getUint32(offset + 20, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      offset += 46 + nameLen + extraLen + commentLen;
      if (name !== "word/document.xml") continue;

      // The local header repeats the name and extra fields, and its own lengths are
      // the authoritative ones — writers disagree about the central directory's copy.
      var localNameLen = view.getUint16(localOffset + 26, true);
      var localExtraLen = view.getUint16(localOffset + 28, true);
      var start = localOffset + 30 + localNameLen + localExtraLen;
      var data = bytes.subarray(start, start + compressedSize);
      var xml = decoder.decode(method === 0 ? data : await inflateRaw(data));

      return tidy(xml
        // Paragraph and line breaks carry the structure a resume depends on; without
        // them every bullet runs into the next and the passage splitter sees one
        // enormous sentence.
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:br\s*\/?>/g, "\n")
        .replace(/<w:tab\s*\/?>/g, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&"));
    }
    throw new Error("That .docx file has no readable document body.");
  }

  // ---- .pdf -----------------------------------------------------------------

  var pdfjs = null;
  async function loadPdfjs() {
    if (!pdfjs) {
      pdfjs = await import(/* webpackIgnore: true */ PDFJS);
      pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
    return pdfjs;
  }

  async function pdfText(buffer) {
    var lib = await loadPdfjs();
    var doc = await lib.getDocument({ data: buffer, isEvalSupported: false }).promise;
    var out = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var content = await (await doc.getPage(p)).getTextContent();
      // pdf.js returns positioned fragments, not lines. `hasEOL` is its own signal for
      // where a line ended; joining on it keeps bullets apart instead of smearing the
      // whole page into one line.
      var line = [];
      for (var k = 0; k < content.items.length; k++) {
        var item = content.items[k];
        if (typeof item.str !== "string") continue;
        line.push(item.str);
        if (item.hasEOL) { out.push(line.join("")); line = []; }
      }
      if (line.length) out.push(line.join(""));
    }
    await doc.destroy();
    var text = tidy(out.join("\n"));
    if (text.length < 50) {
      throw new Error("No text could be read from that PDF. If it is a scan, export a text-based PDF or Word file instead.");
    }
    return text;
  }

  // ---- entry point ----------------------------------------------------------

  async function extract(file) {
    if (!file) throw new Error("No file chosen.");
    if (file.size > MAX_BYTES) throw new Error("That file is larger than 4 MB. Resumes are rarely that big; try exporting it again.");
    var name = (file.name || "").toLowerCase();

    if (/\.(txt|md|markdown|text)$/.test(name) || /^text\//.test(file.type || "")) {
      return tidy(await file.text());
    }
    if (/\.docx$/.test(name)) return docxText(await file.arrayBuffer());
    if (/\.pdf$/.test(name) || file.type === "application/pdf") return pdfText(await file.arrayBuffer());
    if (/\.doc$/.test(name)) {
      throw new Error("Old-style .doc files cannot be read here. Save it as .docx or a text-based PDF.");
    }
    if (/\.(pages|rtf|odt)$/.test(name)) {
      throw new Error("That format is not supported. Export to PDF or .docx.");
    }
    // Unknown extension: try text, but refuse the result if it looks like a binary.
    var text = tidy(await file.text());
    if (!text || /[\u0000-\u0008\u000e-\u001f]/.test(text.slice(0, 2000))) {
      throw new Error("That file type is not supported. Use PDF, .docx, .txt or .md.");
    }
    return text;
  }

  // The original file as base64, for the upload.
  function encode(file) {
    if (file.size > MAX_BYTES) return Promise.reject(new Error("That file is larger than 4 MB. Resumes are rarely that big; try exporting it again."));
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).replace(/^data:[^,]*,/, "")); };
      reader.onerror = function () { reject(new Error("That file could not be read.")); };
      reader.readAsDataURL(file);
    });
  }

  global.ResumeImport = { extract: extract, encode: encode, tidy: tidy, ACCEPT: ".pdf,.docx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown" };
})(window);
