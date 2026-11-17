// Prints the 9 S2 tables and their row counts from server/data/app.db.
// Run from the repo root: node scripts/db-report.mjs
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverDir = path.join(root, 'server');
const dbPath = path.join(serverDir, 'data', 'app.db');

const requireFromServer = createRequire(path.join(serverDir, 'package.json'));
const Database = requireFromServer('better-sqlite3');

const TABLES = [
  'discussions',
  'guests',
  'turns',
  'events',
  'ledger',
  'consensus_points',
  'divergence_points',
  'agent_status',
  'llm_calls',
];

if (!existsSync(dbPath)) {
  console.error(`db-report: database not found at ${dbPath}`);
  console.error('db-report: run "pnpm -C server db:migrate" then "pnpm -C server db:seed" first');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('AI Panel Studio — database report');
console.log(`db: ${dbPath}`);
console.log('');

let total = 0;
for (const table of TABLES) {
  let count;
  try {
    count = Number(db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get());
  } catch (error) {
    console.error(`db-report: cannot count ${table}: ${String(error)}`);
    db.close();
    process.exit(1);
  }
  total += count;
  console.log(`${table.padEnd(20)} ${String(count).padStart(6)}`);
}

const sampleDiscussions = Number(
  db.prepare('SELECT COUNT(*) FROM discussions WHERE sample = 1').pluck().get(),
);
const schemaVersion = Number(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get());

console.log('-'.repeat(28));
console.log(`${'tables'.padEnd(20)} ${String(TABLES.length).padStart(6)}`);
console.log(`${'rows total'.padEnd(20)} ${String(total).padStart(6)}`);
console.log(`${'sample discussions'.padEnd(20)} ${String(sampleDiscussions).padStart(6)}`);
console.log(`${'migrations applied'.padEnd(20)} ${String(schemaVersion).padStart(6)}`);

db.close();
