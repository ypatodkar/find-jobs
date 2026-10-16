// Original resume files, as uploaded, kept beside the text extracted from them.
//
// The extracted text (resumes.body) is what matching reads; the file is kept so a
// resume can be parsed again with a better reader, and checked against what was read
// from it. resumes.file_key says where each file is.
//
// Production: a private S3 bucket named by RESUME_BUCKET, encrypted at rest, reachable
// only through this API's role (scripts/setup-resume-bucket.sh). The S3 client is the
// one the Lambda Node runtime ships, so it is required only when a bucket is set and
// the repo stays dependency-free.
//
// Anywhere else (the dev server, the integration test): a directory, RESUME_FILE_DIR,
// default .resume-files/ at the repo root, which git ignores.
//
// Deleting a resume keeps its row (match-store.cjs), so its file is not removed either;
// it is tagged deleted=true, and the bucket's lifecycle rule erases tagged files 30 days
// later. Locally the file moves to a deleted/ folder instead.

const fs = require("fs");
const path = require("path");

const MAX_FILE_BYTES = 4 * 1024 * 1024;

// What a resume may be, recognised by its first bytes rather than by what the browser
// claims: a PDF, a .docx (a ZIP), or plain text / Markdown.
const TYPES = {
  pdf: { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
  text: { mime: "text/plain; charset=utf-8", ext: "txt", test: (b) => !/[\u0000-\u0008\u000e-\u001f]/.test(b.subarray(0, 4000).toString("utf8")) },
};

function fail(status, message) {
  return Object.assign(new Error(message), { status });
}

/**
 * Decode and check an uploaded file. `data` is base64, as the browser sends it.
 * Returns { bytes, type, ext, size }, or throws a 400/413 the page can show.
 */
function readUpload(data) {
  if (typeof data !== "string" || !data) throw fail(400, "The resume file was missing from the upload.");
  if (data.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) throw fail(413, "That file is larger than 4 MB. Resumes are rarely that big; try exporting it again.");
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length) throw fail(400, "The resume file was empty.");
  if (bytes.length > MAX_FILE_BYTES) throw fail(413, "That file is larger than 4 MB. Resumes are rarely that big; try exporting it again.");
  const kind = [TYPES.pdf, TYPES.docx, TYPES.text].find((t) => t.test(bytes));
  if (!kind) throw fail(400, "That file is not a PDF, Word (.docx) or text file.");
  return { bytes, type: kind.mime, ext: kind.ext, size: bytes.length };
}

const keyFor = (accountId, resumeId, ext) => `resumes/${accountId}/${resumeId}.${ext}`;

function s3Store(bucket, region) {
  // eslint-disable-next-line global-require
  const { S3Client, PutObjectCommand, DeleteObjectCommand, PutObjectTaggingCommand } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({ region });
  return {
    async put(key, bytes, type) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: type, ServerSideEncryption: "AES256" }));
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async markDeleted(key) {
      await s3.send(new PutObjectTaggingCommand({ Bucket: bucket, Key: key, Tagging: { TagSet: [{ Key: "deleted", Value: "true" }] } }));
    },
  };
}

function dirStore(dir) {
  const full = (key) => {
    const p = path.resolve(dir, key);
    if (!p.startsWith(path.resolve(dir) + path.sep)) throw fail(400, "Invalid file key.");
    return p;
  };
  return {
    async put(key, bytes) {
      fs.mkdirSync(path.dirname(full(key)), { recursive: true });
      fs.writeFileSync(full(key), bytes);
    },
    async remove(key) {
      fs.rmSync(full(key), { force: true });
    },
    async markDeleted(key) {
      const to = full(path.join("deleted", key));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      if (fs.existsSync(full(key))) fs.renameSync(full(key), to);
    },
  };
}

/**
 * Where files go, or null when there is nowhere to put them: on Lambda without a
 * bucket configured, the only disk is read-only. Uploads then keep the text alone
 * rather than fail, and say so in the log.
 */
function createFileStore(env = process.env) {
  if (env.RESUME_BUCKET) return s3Store(env.RESUME_BUCKET, env.AWS_REGION || "us-east-1");
  if (env.AWS_LAMBDA_FUNCTION_NAME && !env.RESUME_FILE_DIR) {
    console.warn("RESUME_BUCKET is not set: original resume files are not being kept.");
    return null;
  }
  return dirStore(env.RESUME_FILE_DIR || path.join(__dirname, "..", "..", ".resume-files"));
}

module.exports = { createFileStore, readUpload, keyFor, MAX_FILE_BYTES };
