const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { readUpload, createFileStore, keyFor, MAX_FILE_BYTES } = require("../aws/lambda/file-store.cjs");

const b64 = (s) => Buffer.from(s, "latin1").toString("base64");

test("an upload is recognised by its first bytes, not its name", () => {
  assert.equal(readUpload(b64("%PDF-1.7\n...")).ext, "pdf");
  assert.equal(readUpload(b64("PK\u0003\u0004word/document.xml")).ext, "docx");
  const txt = readUpload(Buffer.from("Jane Doe\nSoftware engineer, 3 years of Go").toString("base64"));
  assert.equal(txt.ext, "txt");
  assert.match(txt.type, /^text\/plain/);
});

test("anything else, an empty file, or one over 4 MB is refused", () => {
  assert.throws(() => readUpload(b64("\u0000\u0001\u0002 binary")), /not a PDF, Word/);
  assert.throws(() => readUpload(""), (e) => e.status === 400);
  assert.throws(() => readUpload(Buffer.alloc(MAX_FILE_BYTES + 1, 0x41).toString("base64")), (e) => e.status === 413);
});

test("without a bucket, files go to a local directory; deleting moves them aside", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resume-files-"));
  try {
    const store = createFileStore({ RESUME_FILE_DIR: dir });
    const key = keyFor("acct_1", "r_abcdefghijklmnop", "pdf");
    assert.equal(key, "resumes/acct_1/r_abcdefghijklmnop.pdf");
    await store.put(key, Buffer.from("%PDF-1.7"), "application/pdf");
    assert.equal(fs.readFileSync(path.join(dir, key), "latin1"), "%PDF-1.7");
    await store.markDeleted(key);
    assert.equal(fs.existsSync(path.join(dir, key)), false);
    assert.equal(fs.existsSync(path.join(dir, "deleted", key)), true);
    await assert.rejects(store.put("../escape.pdf", Buffer.from("x")), /Invalid file key/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
