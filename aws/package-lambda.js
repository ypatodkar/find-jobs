// npm ci --prefix aws/lambda --omit=dev && node aws/package-lambda.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'find-jobs-lambda-'));
try {
  fs.cpSync(path.join(__dirname, 'lambda'), stage, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'catalogue-schema.sql'), path.join(stage, 'catalogue-schema.sql'));
  const output = path.join(__dirname, 'function.zip');
  fs.rmSync(output, { force: true });
  execFileSync('zip', ['-qr', output, '.'], { cwd: stage });
  console.log('Built aws/function.zip with the API, dependencies, and catalogue schema.');
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
