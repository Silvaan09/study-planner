import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrations, type Migration } from './migrations';

export const DB_FILE_NAME = 'study-planner.db';
const AUTO_BACKUPS_TO_KEEP = 14;

export class NewerDatabaseError extends Error {
  constructor(
    public dbVersion: number,
    public appVersion: number,
  ) {
    super(
      `The database was created by a newer version of Study Planner (schema v${dbVersion}, ` +
        `this app supports up to v${appVersion}). It was left untouched. Please use the newer version.`,
    );
  }
}

export interface OpenedDatabase {
  db: DatabaseSync;
  dbPath: string;
  backupDir: string;
  schemaVersion: number;
  /** Backup files created while opening (pre-migration or daily). */
  backupsCreated: string[];
  integrityProblem: string | null;
}

function timestamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** Consistent snapshot of the live database (safe with WAL mode). */
export function backupTo(db: DatabaseSync, backupDir: string, prefix: string, now = new Date()): string {
  fs.mkdirSync(backupDir, { recursive: true });
  let file = path.join(backupDir, `${prefix}-${timestamp(now)}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(backupDir, `${prefix}-${timestamp(now)}-${i}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return file;
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  return row.user_version;
}

function hasUserTables(db: DatabaseSync): boolean {
  const row = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get() as {
    n: number;
  };
  return row.n > 0;
}

function runMigration(db: DatabaseSync, m: Migration): void {
  if (m.rebuildsTables) db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    m.up(db);
    if (m.rebuildsTables) {
      const problems = db.prepare('PRAGMA foreign_key_check').all();
      if (problems.length > 0) throw new Error(`Migration ${m.version} broke foreign keys: ${JSON.stringify(problems)}`);
    }
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      m.version,
      m.name,
      new Date().toISOString(),
    );
    db.exec(`PRAGMA user_version = ${m.version}`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    if (m.rebuildsTables) db.exec('PRAGMA foreign_keys = ON');
  }
}

function pruneAutoBackups(backupDir: string): void {
  const autos = fs
    .readdirSync(backupDir)
    .filter((f) => f.startsWith('auto-') && f.endsWith('.db'))
    .sort();
  for (const f of autos.slice(0, Math.max(0, autos.length - AUTO_BACKUPS_TO_KEEP))) {
    fs.rmSync(path.join(backupDir, f), { force: true });
  }
}

function hasBackupForDay(backupDir: string, now: Date): boolean {
  const day = timestamp(now).slice(0, 8);
  return fs.readdirSync(backupDir).some((f) => f.startsWith(`auto-${day}`));
}

/**
 * Opens (or creates) the database in `dataDir`, migrating it to the latest schema.
 * An existing database is never replaced: it is backed up and migrated in place.
 */
export function openDatabase(
  dataDir: string,
  opts: { dailyBackup?: boolean; now?: Date; migrations?: Migration[] } = {},
): OpenedDatabase {
  const now = opts.now ?? new Date();
  const allMigrations = opts.migrations ?? migrations;
  const latest = allMigrations[allMigrations.length - 1].version;
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, DB_FILE_NAME);
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });

  const db = new DatabaseSync(dbPath);
  const backupsCreated: string[] = [];
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');

    const check = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
    const integrityProblem = check.length === 1 && check[0].quick_check === 'ok' ? null : check.map((r) => r.quick_check).join('; ');

    const current = userVersion(db);
    if (current > latest) throw new NewerDatabaseError(current, latest);

    if (current < latest) {
      if (hasUserTables(db)) {
        backupsCreated.push(backupTo(db, backupDir, `pre-migration-v${current}-to-v${latest}`, now));
      }
      if (current === 0) {
        db.exec(
          'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
        );
      }
      for (const m of allMigrations) {
        if (m.version > current) runMigration(db, m);
      }
    } else if (opts.dailyBackup && !hasBackupForDay(backupDir, now)) {
      backupsCreated.push(backupTo(db, backupDir, 'auto', now));
      pruneAutoBackups(backupDir);
    }

    return { db, dbPath, backupDir, schemaVersion: userVersion(db), backupsCreated, integrityProblem };
  } catch (err) {
    db.close();
    throw err;
  }
}
