import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/** server/data/app.db, resolved from this module rather than process.cwd(). */
export const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/app.db');

export function createDb(filePath: string = DEFAULT_DB_PATH): Db {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  return db;
}

let instance: Db | null = null;

export function getDb(): Db {
  if (instance === null) {
    instance = createDb();
  }
  return instance;
}

export function closeDb(): void {
  if (instance !== null) {
    instance.close();
    instance = null;
  }
}
