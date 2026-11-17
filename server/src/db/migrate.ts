import fs from 'node:fs';
import path from 'node:path';
import { closeDb, getDb, type Db } from './index';

const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations');

interface MigrationRow {
  version: string;
}

/**
 * Applies every pending .sql file in migrations/ exactly once, recording the
 * version in schema_migrations. Idempotent: re-running applies nothing.
 */
export function migrate(db: Db): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );

  const rows = db.prepare('SELECT version FROM schema_migrations').all() as MigrationRow[];
  const applied = new Set(rows.map((row) => row.version));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    const version = path.basename(file, '.sql');
    if (applied.has(version)) {
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const run = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
    });
    run();
    newlyApplied.push(version);
  }

  return newlyApplied;
}

if (require.main === module) {
  const db = getDb();
  const applied = migrate(db);
  if (applied.length === 0) {
    console.log('migrate: already up to date');
  } else {
    console.log(`migrate: applied ${applied.join(', ')}`);
  }
  closeDb();
}
