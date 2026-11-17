// Real HTTP probe: spawns the Fastify server, polls GET /health for up to 15s,
// prints status + raw body, then kills the whole child tree.
// Run from the repo root: node scripts/health-probe.mjs
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const url = 'http://127.0.0.1:8787/health';

const tsxCli = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const args = existsSync(tsxCli) ? [tsxCli, 'src/index.ts'] : ['--import', 'tsx', 'src/index.ts'];

const child = spawn(process.execPath, args, {
  cwd: serverDir,
  env: { ...process.env, PORT: '8787' },
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stopChild() {
  if (child.exitCode !== null) {
    return;
  }
  child.kill();
  await delay(300);
  if (child.exitCode === null && child.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    await delay(200);
  }
}

async function probe() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      return null;
    }
    try {
      const response = await fetch(url);
      return { status: response.status, body: await response.text() };
    } catch {
      await delay(250);
    }
  }
  return null;
}

console.log(`probe: GET ${url}`);
const result = await probe();
await stopChild();

if (result === null) {
  console.error('probe: server did not answer within 15s');
  if (stderr.trim().length > 0) {
    console.error('--- server stderr ---');
    console.error(stderr.trim());
  }
  process.exit(1);
}

console.log(`HTTP ${result.status}`);
console.log(result.body);
process.exit(result.status === 200 ? 0 : 1);
