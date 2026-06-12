const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const snapshotPath = path.join(repoRoot, 'openapi-snapshot.json');

const result = spawnSync(
  'go',
  [
    'run',
    './cmd/openapi-snapshot',
    '--base-url',
    'http://localhost:3000',
    '--version',
    packageJson.version
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HLOOLMAIL_BASE_URL: 'http://localhost:3000',
      HLOOLMAIL_OUTPUT: 'raw'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  }
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }
  process.exit(result.status || 1);
}

const raw = result.stdout.trim();

try {
  JSON.parse(raw);
} catch (error) {
  console.error(`Generated OpenAPI output is not valid JSON: ${error.message}`);
  process.exit(1);
}

fs.writeFileSync(snapshotPath, `${raw}\n`);
console.log(`Wrote ${path.relative(process.cwd(), snapshotPath)}`);
