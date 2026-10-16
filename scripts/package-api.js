// Build the Lambda archive with the same relative imports used by the dev server.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'aws/function.zip');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'find-jobs-api-'));
const files = ['shared/jev.js', 'shared/requirements.js', 'shared/description.js', 'aws/schema.sql', 'aws/lambda/index.mjs', 'aws/lambda/api.cjs', 'aws/lambda/account-api.cjs', 'aws/lambda/package.json', 'aws/lambda/account-store.cjs', 'aws/lambda/google-id.cjs', 'aws/lambda/match-store.cjs', 'aws/lambda/file-store.cjs', 'aws/lambda/usage-store.cjs'];
try {
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(stage, rel)), { recursive: true });
    fs.copyFileSync(path.join(root, rel), path.join(stage, rel));
  }
  // The previous deployment used index.handler; keep that entry working during
  // the update before configuration switches to the shared handler path.
  fs.writeFileSync(path.join(stage, 'index.mjs'), "export { handler } from './aws/lambda/index.mjs';\n");
  fs.cpSync(path.join(root, 'aws/lambda/node_modules'), path.join(stage, 'node_modules'), { recursive: true });
  fs.rmSync(output, { force: true });
  execFileSync('zip', ['-qr', output, '.'], { cwd: stage });
  console.log('Packaged authenticated API and analytics into aws/function.zip');
} finally { fs.rmSync(stage, { recursive: true, force: true }); }
