import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupTo, openDatabase, type OpenedDatabase } from '../src/main/db/database';
import { BackupError, backupPath, inspectBackup, listBackups, restoreDatabase } from '../src/main/db/backups';
import { migrations } from '../src/main/db/migrations';
import { StudyService } from '../src/main/service';

let dir: string;
let other: string;
let opened: OpenedDatabase;

const semesterNames = (o: OpenedDatabase) => new StudyService(o.db).listSemesters().map((s) => s.name);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-'));
  other = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-backup-src-'));
  opened = openDatabase(dir);
  new StudyService(opened.db).createSemester({ name: 'Current', startDate: '2026-09-14', endDate: '2026-12-18' });
});

afterEach(() => {
  try {
    opened.db.close();
  } catch {
    // already closed
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

/** A separate database (in `other`) with one semester called `name`, optionally on an older schema. */
function makeSource(name: string, upTo = migrations.length): string {
  const src = openDatabase(path.join(other, name), { migrations: migrations.slice(0, upTo) });
  src.db.prepare("INSERT INTO semesters (name, start_date, end_date, created_at, updated_at) VALUES (?, '2026-02-16', '2026-05-29', 'x', 'x')").run(name);
  const file = backupTo(src.db, path.join(other, 'out'), name);
  src.db.close();
  return file;
}

describe('listing backups', () => {
  it('lists .db files newest first with their kind and time from the file name', () => {
    const b = opened.backupDir;
    for (const f of ['auto-20261110-080000.db', 'manual-20261112-153000.db', 'pre-migration-v8-to-v9-20261101-120000.db', 'pre-restore-20261112-153000-2.db', 'mine.db', 'notes.txt']) {
      fs.writeFileSync(path.join(b, f), 'x');
    }
    const list = listBackups(b);
    expect(list.map((x) => [x.file, x.kind, x.createdAt])).toEqual([
      ...list.filter((x) => x.file === 'mine.db').map((x) => [x.file, 'other', x.createdAt]), // modification time = now
      ['pre-restore-20261112-153000-2.db', 'pre-restore', '2026-11-12T15:30:00'],
      ['manual-20261112-153000.db', 'manual', '2026-11-12T15:30:00'],
      ['auto-20261110-080000.db', 'auto', '2026-11-10T08:00:00'],
      ['pre-migration-v8-to-v9-20261101-120000.db', 'pre-migration', '2026-11-01T12:00:00'],
    ]);
    expect(list.every((x) => x.size === 1)).toBe(true);
  });

  it('only accepts plain file names of existing backups', () => {
    fs.writeFileSync(path.join(opened.backupDir, 'manual-20261112-153000.db'), 'x');
    expect(backupPath(opened.backupDir, 'manual-20261112-153000.db')).toBe(path.join(opened.backupDir, 'manual-20261112-153000.db'));
    expect(() => backupPath(opened.backupDir, '../study-planner.db')).toThrow(BackupError);
    expect(() => backupPath(opened.backupDir, 'missing.db')).toThrow(BackupError);
    expect(() => backupPath(opened.backupDir, 42)).toThrow(BackupError);
  });
});

describe('restoring', () => {
  it('replaces the data with the backup and keeps a backup of the previous state', () => {
    const source = makeSource('Restored');
    const { opened: after, safetyBackup } = restoreDatabase(opened, dir, source, { now: new Date(2026, 10, 13, 14, 0, 0) });
    opened = after;
    expect(semesterNames(after)).toEqual(['Restored']);
    expect(path.basename(safetyBackup)).toBe('pre-restore-20261113-140000.db');
    expect(listBackups(after.backupDir)[0].kind).toBe('pre-restore');
    // The safety backup holds what was there before.
    const before = new DatabaseSync(safetyBackup, { readOnly: true });
    expect(before.prepare('SELECT name FROM semesters').all()).toEqual([{ name: 'Current' }]);
    before.close();
    // The backup file itself is untouched and no temporary file is left behind.
    expect(fs.existsSync(source)).toBe(true);
    expect(fs.existsSync(path.join(dir, 'restore-incoming.db'))).toBe(false);
  });

  it('upgrades a backup from an older version', () => {
    const source = makeSource('Old', 4);
    expect(inspectBackup(source)).toBe(4);
    const result = restoreDatabase(opened, dir, source);
    opened = result.opened;
    expect(opened.schemaVersion).toBe(migrations[migrations.length - 1].version);
    expect(semesterNames(opened)).toEqual(['Old']);
    expect(listBackups(opened.backupDir).some((b) => b.kind === 'pre-migration')).toBe(true);
  });

  it('refuses a backup from a newer version, leaving the data open and unchanged', () => {
    const source = makeSource('Newer');
    const db = new DatabaseSync(source);
    db.exec('PRAGMA user_version = 999');
    db.close();
    expect(() => restoreDatabase(opened, dir, source)).toThrow(/newer version/);
    expect(semesterNames(opened)).toEqual(['Current']);
    expect(listBackups(opened.backupDir).some((b) => b.kind === 'pre-restore')).toBe(false);
  });

  it('refuses files that are not Study Planner databases', () => {
    const text = path.join(other, 'notes.db');
    fs.writeFileSync(text, 'just some text, not a database at all '.repeat(200));
    expect(() => restoreDatabase(opened, dir, text)).toThrow(BackupError);

    const foreign = path.join(other, 'foreign.db');
    const db = new DatabaseSync(foreign);
    db.exec('CREATE TABLE things (id INTEGER); PRAGMA user_version = 3');
    db.close();
    expect(() => restoreDatabase(opened, dir, foreign)).toThrow(/not a Study Planner database/);

    expect(() => restoreDatabase(opened, dir, opened.dbPath)).toThrow(/using right now/);
    expect(semesterNames(opened)).toEqual(['Current']);
  });
});
