import { formatDate, isValidTime, type ISODate } from '../../shared/dates';
import { EXAM_KINDS, examTitle, type DeleteResult, type Exam, type ExamInput, type Id } from '../../shared/types';
import { LIVE_SUBJECT, MAX_DESCRIPTION, SUBJECT_JOIN, UserError } from './base';
import { LectureService } from './lectures';

/** Exams. */
export class ExamService extends LectureService {
  // ------------------------------------------------------------------- exams

  private mapExam = (r: any): Exam => ({
    id: r.id,
    subjectId: r.subject_id,
    kind: r.kind,
    title: r.title,
    date: r.date,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    location: r.location,
    notes: r.notes,
  });

  private liveExam(id: Id): Exam {
    const r = this.get(`SELECT x.* FROM exams x ${SUBJECT_JOIN} WHERE x.id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`, id);
    if (!r) throw new UserError('This exam no longer exists.');
    return this.mapExam(r);
  }

  private examInput(input: ExamInput): ExamInput {
    if (!EXAM_KINDS.includes(input?.kind)) throw new UserError('Unknown kind of exam.');
    const title = this.text(input.title ?? '', 'Exam title', { allowEmpty: true });
    const date = this.date(input.date, 'Exam date');
    const startTime = input.startTime || null;
    const endTime = input.endTime || null;
    if ((startTime && !isValidTime(startTime)) || (endTime && !isValidTime(endTime))) throw new UserError('Please enter times as HH:MM (24-hour).');
    if (endTime && !startTime) throw new UserError('Enter a start time, or leave both times empty.');
    if (startTime && endTime && startTime >= endTime) throw new UserError('The exam must end after it starts.');
    const location = this.text(input.location ?? '', 'Room', { allowEmpty: true });
    const notes = this.text(input.notes ?? '', 'Notes', { max: MAX_DESCRIPTION, allowEmpty: true });
    return { subjectId: input.subjectId, kind: input.kind, title, date, startTime, endTime, location, notes };
  }

  /** Live exams of a semester (optionally of one subject) with a date in [from, to], by date and time. */
  protected exams(semesterId: Id, opts: { subjectId?: Id; from?: ISODate; to?: ISODate } = {}): Exam[] {
    return this.all(
      `SELECT x.* FROM exams x ${SUBJECT_JOIN}
       WHERE s.semester_id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}
         AND (? IS NULL OR x.subject_id = ?) AND x.date BETWEEN ? AND ?
       ORDER BY x.date, x.start_time IS NULL, x.start_time, x.id`,
      semesterId,
      opts.subjectId ?? null,
      opts.subjectId ?? null,
      opts.from ?? '0000-01-01',
      opts.to ?? '9999-12-31',
    ).map(this.mapExam);
  }

  getExam(id: Id): Exam {
    return this.liveExam(id);
  }

  createExam(input: ExamInput): Exam {
    const v = this.examInput(input);
    this.courseSubject(v.subjectId, 'exams');
    const t = this.stamp();
    const r = this.run(
      `INSERT INTO exams (subject_id, kind, title, date, start_time, end_time, location, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.subjectId,
      v.kind,
      v.title,
      v.date,
      v.startTime,
      v.endTime,
      v.location,
      v.notes,
      t,
      t,
    );
    return this.liveExam(Number(r.lastInsertRowid));
  }

  updateExam(id: Id, input: ExamInput): Exam {
    const existing = this.liveExam(id);
    const v = this.examInput(input);
    if (this.courseSubject(v.subjectId, 'exams').semesterId !== this.liveSubject(existing.subjectId).semesterId) {
      throw new UserError('An exam can only be moved to a subject in the same semester.');
    }
    this.run(
      `UPDATE exams SET subject_id = ?, kind = ?, title = ?, date = ?, start_time = ?, end_time = ?, location = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      v.subjectId,
      v.kind,
      v.title,
      v.date,
      v.startTime,
      v.endTime,
      v.location,
      v.notes,
      this.stamp(),
      id,
    );
    return this.liveExam(id);
  }

  deleteExam(id: Id): DeleteResult {
    return this.tx(() => {
      const e = this.liveExam(id);
      const subject = this.liveSubject(e.subjectId);
      const label = `${examTitle(e)} (${subject.name})`;
      const batch = this.newTrashBatch('exam', label, formatDate(e.date, { weekday: true, year: true }));
      this.run('UPDATE exams SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
      return { trashId: batch, label };
    });
  }
}
