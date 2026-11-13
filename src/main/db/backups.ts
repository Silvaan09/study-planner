import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { BackupInfo, BackupKind } from '../../shared/types';
import { backupTo, DB_FILE_NAME, openDatabase, type OpenedDatabase } from './database';
import { migrations, type Migration } from './migrations';

/**
 * A restore that was refused or failed; the message is shown to the user and the data is as before. If the current
 * database had already been closed, `reopened` is the previous state, opened again.
 */
export class BackupError extends Error {
  constructor(
    message: string,
    public reopened?: OpenedDatabase,
  ) {
    super(message);
  }
}

const KINDS: [string, BackupKind][] = [
  ['auto-', 'auto'],
  ['manual-', 'manual'],
  ['pre-migration-', 'pre-migration'],
  ['pre-restore-', 'pre-restore'],
];

/** "…-20261113-140501.db" → "2026-11-13T14:05:01" (backupTo's local-time stamp). */
function stampOf(file: string): string | null {
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?\.db$/.exec(file);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : null;
}

function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The .db files in the backups folder, newest first. */
export function listBackups(backupDir: string): BackupInfo[] {
  let names: string[];
  try {
    names = fs.readdirSync(backupDir);
  } catch {
    return [];
  }
  const list: BackupInfo[] = [];
  for (const file of names) {
    if (!file.toLowerCase().endsWith('.db')) continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(backupDir, file));
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const kind = KINDS.find(([prefix]) => file.startsWith(prefix))?.[1] ?? 'other';
    list.push({ file, kind, createdAt: stampOf(file) ?? localStamp(stat.mtime), size: stat.size });
  }
  return list.sort((a, b) => (a.createdAt === b.createdAt ? b.file.localeCompare(a.file) : b.createdAt.localeCompare(a.createdAt)));
}

/** A backup's path from its file name; only plain names of files directly in the backups folder. */
export function backupPath(backupDir: string, file: unknown): string {
  if (typeof file !== 'string' || file !== path.basename(file) || !file.toLowerCase().endsWith('.db')) {
    throw new BackupError('That backup does not exist.');
  }
  const full = path.join(backupDir, file);
  if (!fs.existsSync(full)) throw new BackupError('That backup does not exist (any more).');
  return full;
}

/**
 * Checks that `file` is an intact Study Planner database this app can open, and returns its schema version.
 * Opens it read-only, so the file is never changed.
 */
export function inspectBackup(file: string, allMigrations: Migration[] = migrations): number {
  const latest = allMigrations[allMigrations.length - 1].version;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw new BackupError('The file could not be opened as a database.');
  }
  try {
    let version: number;
    let hasSemesters: boolean;
    try {
      version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      hasSemesters = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'semesters'").get();
    } catch {
      throw new BackupError('The file is not a Study Planner database.');
    }
    if (version < 1 || !hasSemesters) throw new BackupError('The file is not a Study Planner database.');
    if (version > latest) {
      throw new BackupError(
        `This backup was made by a newer version of Study Planner (schema v${version}, this app supports up to v${latest}). Update the app first.`,
      );
    }
    const check = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[];
    if (!(check.length === 1 && check[0].quick_check === 'ok')) throw new BackupError('The backup is damaged (integrity check failed).');
    return version;
  } finally {
    db.close();
  }
}

/**
 * Replaces the open database with the backup `source` and returns the newly opened database.
 * Order: check the backup; copy it into the data folder (a clean, self-contained copy); back up the current state
 * ("pre-restore-…"); close the current database; swap the copy in; open it (older backups get migrated, with their own
 * pre-migration backup). If swapping or opening fails, the previous state is put back, reopened and passed along in
 * the BackupError. `current` is closed in every case except when the backup is refused before anything changed.
 */
export function restoreDatabase(
  current: OpenedDatabase,
  dataDir: string,
  source: string,
  opts: { now?: Date; migrations?: Migration[] } = {},
): { opened: OpenedDatabase; safetyBackup: string } {
  const allMigrations = opts.migrations ?? migrations;
  if (path.resolve(source) === path.resolve(current.dbPath)) throw new BackupError('That is the database the app is using right now.');
  inspectBackup(source, allMigrations);

  const incoming = path.join(dataDir, 'restore-incoming.db');
  fs.rmSync(incoming, { force: true });
  const src = new DatabaseSync(source, { readOnly: true });
  try {
    src.exec(`VACUUM INTO '${incoming.replace(/'/g, "''")}'`);
  } catch {
    src.close();
    fs.rmSync(incoming, { force: true });
    // Some read-only files can't be vacuumed: a plain copy is just as good once it's checked.
    fs.copyFileSync(source, incoming);
    inspectBackup(incoming, allMigrations);
  } finally {
    try {
      src.close();
    } catch {
      // already closed
    }
  }

  const safetyBackup = backupTo(current.db, current.backupDir, 'pre-restore', opts.now);
  closeQuietly(current);
  try {
    replaceDbFile(dataDir, incoming);
    return { opened: openDatabase(dataDir, { now: opts.now, migrations: allMigrations }), safetyBackup };
  } catch (err) {
    // Put the previous state back so the app keeps working, then report.
    fs.rmSync(incoming, { force: true });
    fs.copyFileSync(safetyBackup, incoming);
    replaceDbFile(dataDir, incoming);
    const reopened = openDatabase(dataDir, { now: opts.now, migrations: allMigrations });
    throw new BackupError(
      `The backup could not be restored (${err instanceof Error ? err.message : String(err)}). Your data was not changed.`,
      reopened,
    );
  }
}

function closeQuietly(o: OpenedDatabase): void {
  try {
    o.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // best effort
  }
  try {
    o.db.close();
  } catch {
    // already closed
  }
}

/** Moves `file` to the data folder's database, dropping the old database's WAL files. */
function replaceDbFile(dataDir: string, file: string): void {
  const dbPath = path.join(dataDir, DB_FILE_NAME);
  for (const extra of ['-wal', '-shm']) fs.rmSync(dbPath + extra, { force: true });
  fs.renameSync(file, dbPath);
}
