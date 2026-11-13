import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { formatDate, isValidISODate, weekday, type ISODate } from '../../shared/dates';
import type { Id, TrashKind } from '../../shared/types';

/** An error caused by invalid user input; its message is shown to the user as-is. */
export class UserError extends Error {}

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 20_000;
export const MAX_CHECKLIST = 100;
export const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// "Live" = not in the trash and no ancestor in the trash.
export const LIVE_SUBJECT = 's.deleted_at IS NULL AND sem.deleted_at IS NULL';
export const SUBJECT_JOIN = 'JOIN subjects s ON s.id = x.subject_id JOIN semesters sem ON sem.id = s.semester_id';
export const EXERCISE_FROM = `exercises x ${SUBJECT_JOIN} LEFT JOIN exercise_series es ON es.id = x.series_id`;
export const LIVE_EXERCISE = `x.deleted_at IS NULL AND (x.series_id IS NULL OR es.deleted_at IS NULL) AND ${LIVE_SUBJECT}`;

/** Database access, transactions and input validation shared by every part of the service. */
export class ServiceBase {
  private txDepth = 0;

  constructor(
    private db: DatabaseSync,
    private now: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------- helpers

  protected all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  protected get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  protected run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  protected stamp(): string {
    return this.now().toISOString();
  }

  /** Runs `fn` atomically. Nested calls join the outer transaction via savepoints. */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.txDepth}`;
    this.db.exec(this.txDepth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.txDepth++;
    try {
      const result = fn();
      this.txDepth--;
      this.db.exec(this.txDepth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (err) {
      this.txDepth--;
      this.db.exec(this.txDepth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw err;
    }
  }

  protected newTrashBatch(kind: TrashKind, label: string, detail = ''): Id {
    const r = this.run('INSERT INTO trash_batches (kind, label, detail, deleted_at) VALUES (?, ?, ?, ?)', kind, label, detail, this.stamp());
    return Number(r.lastInsertRowid);
  }

  // ------------------------------------------------------------- validation

  protected text(value: unknown, what: string, opts: { max?: number; allowEmpty?: boolean } = {}): string {
    if (typeof value !== 'string') throw new UserError(`${what} is missing.`);
    const v = value.trim();
    if (!v && !opts.allowEmpty) throw new UserError(`${what} can't be empty.`);
    if (v.length > (opts.max ?? MAX_TITLE)) throw new UserError(`${what} is too long.`);
    return v;
  }

  protected date(value: unknown, what: string): ISODate {
    if (!isValidISODate(value)) throw new UserError(`${what} is not a valid date.`);
    return value;
  }

  protected int(value: unknown, what: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new UserError(`${what} must be a whole number between ${min} and ${max}.`);
    }
    return value;
  }

  protected monday(value: unknown): ISODate {
    const d = this.date(value, 'Week');
    if (weekday(d) !== 1) throw new UserError('Week must start on a Monday.');
    return d;
  }

  /** Planned dates must all be on or before the deadline (if there is one); without planned days a deadline is needed. */
  protected checkPlanned(planned: ISODate[], deadline: ISODate | null, title?: string): void {
    if (planned.length === 0) {
      if (deadline === null) throw new UserError(`Plan at least one day to work on ${title ? `"${title}"` : 'it'}, or set a deadline.`);
      return;
    }
    const latest = planned[planned.length - 1];
    if (deadline !== null && latest > deadline) {
      const who = title ? ` for "${title}"` : '';
      throw new UserError(
        `The planned date${who} (${formatDate(latest, { weekday: true })}) can't be after the deadline (${formatDate(deadline, { weekday: true })}).`,
      );
    }
  }

  /** A deadline date, or null for none. */
  protected deadlineInput(value: unknown): ISODate | null {
    return value === null || value === undefined || value === '' ? null : this.date(value, 'Deadline');
  }

  /** Validates, de-duplicates and sorts a list of planned dates (empty = deadline only, see checkPlanned). */
  protected plannedDatesInput(value: unknown): ISODate[] {
    if (!Array.isArray(value)) throw new UserError('The planned dates are invalid.');
    if (value.length > 100) throw new UserError('Too many planned dates (at most 100).');
    return [...new Set(value.map((d) => this.date(d, 'Planned date')))].sort();
  }
}
