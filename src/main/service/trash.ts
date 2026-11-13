import type { Id, TrashEntry } from '../../shared/types';
import { UserError } from './base';
import { ViewService } from './views';

// Tables that hold trashable rows, in child-to-parent order.
const TRASH_TABLES = ['exams', 'exercises', 'exercise_series', 'lecture_occurrences', 'lectures', 'subjects', 'semester_breaks', 'semesters'] as const;
type TrashTable = (typeof TRASH_TABLES)[number];

/** The trash: listing, restoring and purging deleted items. */
export class TrashService extends ViewService {
  // ------------------------------------------------------------------- trash

  listTrash(): TrashEntry[] {
    const counts = TRASH_TABLES.map((tb) => `(SELECT count(*) FROM ${tb} WHERE trash_batch_id = b.id)`).join(' + ');
    return this.all<any>(`SELECT b.*, ${counts} AS n FROM trash_batches b ORDER BY b.deleted_at DESC, b.id DESC`).map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.label,
      detail: r.detail,
      deletedAt: r.deleted_at,
      itemCount: r.n,
    }));
  }

  /** Returns why a trashed row can't be restored yet (its parent is in the trash), or null. */
  private blockedByParent(table: TrashTable, id: Id): string | null {
    const semesterGone = (semId: Id) => {
      const s = this.get<any>('SELECT name, deleted_at FROM semesters WHERE id = ?', semId);
      return s?.deleted_at ? `Restore semester "${s.name}" first.` : null;
    };
    const subjectGone = (subjectId: Id): string | null => {
      const s = this.get<any>('SELECT name, semester_id, deleted_at FROM subjects WHERE id = ?', subjectId);
      if (!s) return null;
      return s.deleted_at ? `Restore subject "${s.name}" first.` : semesterGone(s.semester_id);
    };
    switch (table) {
      case 'semesters':
        return null;
      case 'subjects':
      case 'semester_breaks':
        return semesterGone(this.get<any>(`SELECT semester_id FROM ${table} WHERE id = ?`, id).semester_id);
      case 'lectures':
      case 'exercise_series':
      case 'exams':
        return subjectGone(this.get<any>(`SELECT subject_id FROM ${table} WHERE id = ?`, id).subject_id);
      case 'lecture_occurrences': {
        const l = this.get<any>('SELECT l.title, l.subject_id, l.deleted_at FROM lecture_occurrences o JOIN lectures l ON l.id = o.lecture_id WHERE o.id = ?', id);
        return l.deleted_at ? `Restore lecture "${l.title}" first.` : subjectGone(l.subject_id);
      }
      case 'exercises': {
        const x = this.get<any>('SELECT subject_id, series_id FROM exercises WHERE id = ?', id);
        if (x.series_id !== null) {
          const s = this.get<any>('SELECT base_title, deleted_at FROM exercise_series WHERE id = ?', x.series_id);
          if (s?.deleted_at) return `Restore exercise series "${s.base_title}" first.`;
        }
        return subjectGone(x.subject_id);
      }
    }
  }

  private batchExists(id: Id): void {
    if (!this.get('SELECT id FROM trash_batches WHERE id = ?', id)) throw new UserError('This item is no longer in the trash.');
  }

  restoreTrash(id: Id): void {
    this.tx(() => {
      this.batchExists(id);
      for (const table of TRASH_TABLES) {
        for (const r of this.all<{ id: Id }>(`SELECT id FROM ${table} WHERE trash_batch_id = ?`, id)) {
          const problem = this.blockedByParent(table, r.id);
          if (problem) throw new UserError(`Can't restore this yet. ${problem}`);
        }
      }
      for (const table of TRASH_TABLES) {
        this.run(`UPDATE ${table} SET deleted_at = NULL, trash_batch_id = NULL WHERE trash_batch_id = ?`, id);
      }
      this.run('DELETE FROM trash_batches WHERE id = ?', id);
    });
  }

  purgeTrash(id: Id): void {
    this.tx(() => {
      this.batchExists(id);
      for (const table of TRASH_TABLES) {
        if (table === 'lecture_occurrences') {
          // The lecture itself still exists; keep a tombstone so the week stays removed.
          this.run('UPDATE lecture_occurrences SET removed = 1, deleted_at = NULL, trash_batch_id = NULL WHERE trash_batch_id = ?', id);
        } else {
          this.run(`DELETE FROM ${table} WHERE trash_batch_id = ?`, id);
        }
      }
      this.run('DELETE FROM trash_batches WHERE id = ?', id);
      this.removeEmptyBatches();
    });
  }

  emptyTrash(): void {
    this.tx(() => {
      for (const { id } of this.all<{ id: Id }>('SELECT id FROM trash_batches ORDER BY id')) {
        if (this.get('SELECT id FROM trash_batches WHERE id = ?', id)) this.purgeTrash(id);
      }
    });
  }

  /** Children of a purged item are deleted by cascade; drop trash entries left empty by that. */
  private removeEmptyBatches(): void {
    const used = TRASH_TABLES.map((tb) => `SELECT trash_batch_id FROM ${tb} WHERE trash_batch_id IS NOT NULL`).join(' UNION ');
    this.run(`DELETE FROM trash_batches WHERE id NOT IN (${used})`);
  }
}
