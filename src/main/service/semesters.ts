import { formatDateRange, type ISODate } from '../../shared/dates';
import {
  breakTitle,
  type BreakInput,
  type DeleteResult,
  type Id,
  type Semester,
  type SemesterBreak,
  type SemesterInput,
  type Subject,
  type SubjectInput,
  type Assessment,
} from '../../shared/types';
import { COLOR_RE, ServiceBase, UserError } from './base';
import { GRADE_MAX, GRADE_MIN, MAX_CREDITS, round2, twoDecimals } from '../../shared/grades';

/** The built-in subject every semester has for personal tasks (see Subject.personal). */
const PERSONAL_SUBJECT = { name: 'Personal', color: '#64748b' };

/** Semesters, subjects and breaks. */
export class SemesterService extends ServiceBase {
  // --------------------------------------------------------------- semesters

  private mapSemester = (r: any): Semester => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date });

  private semesterInput(input: SemesterInput): SemesterInput {
    const name = this.text(input?.name, 'Semester name');
    const startDate = this.date(input.startDate, 'Start date');
    const endDate = this.date(input.endDate, 'End date');
    if (startDate > endDate) throw new UserError('The semester must end on or after its start date.');
    return { name, startDate, endDate };
  }

  protected liveSemester(id: Id): Semester {
    const r = this.get('SELECT * FROM semesters WHERE id = ? AND deleted_at IS NULL', id);
    if (!r) throw new UserError('This semester no longer exists.');
    return this.mapSemester(r);
  }

  listSemesters(): Semester[] {
    return this.all('SELECT * FROM semesters WHERE deleted_at IS NULL ORDER BY start_date DESC, id DESC').map(this.mapSemester);
  }

  createSemester(input: SemesterInput): Semester {
    return this.tx(() => {
      const v = this.semesterInput(input);
      const t = this.stamp();
      const r = this.run(
        'INSERT INTO semesters (name, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        v.name,
        v.startDate,
        v.endDate,
        t,
        t,
      );
      const id = Number(r.lastInsertRowid);
      this.run(
        'INSERT INTO subjects (semester_id, name, color, personal, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
        id,
        PERSONAL_SUBJECT.name,
        PERSONAL_SUBJECT.color,
        t,
        t,
      );
      return this.liveSemester(id);
    });
  }

  updateSemester(id: Id, input: SemesterInput): Semester {
    this.liveSemester(id);
    const v = this.semesterInput(input);
    this.run('UPDATE semesters SET name = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?', v.name, v.startDate, v.endDate, this.stamp(), id);
    return this.liveSemester(id);
  }

  deleteSemester(id: Id): DeleteResult {
    return this.tx(() => {
      const sem = this.liveSemester(id);
      const n = this.get<{ n: number }>('SELECT count(*) n FROM subjects WHERE semester_id = ? AND deleted_at IS NULL AND personal = 0', id)!.n;
      const label = `Semester "${sem.name}"`;
      const batch = this.newTrashBatch('semester', label, `${n} subject${n === 1 ? '' : 's'} with all lectures, exercises and tasks`);
      this.run('UPDATE semesters SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
      return { trashId: batch, label };
    });
  }

  // ---------------------------------------------------------------- subjects

  private mapSubject = (r: any): Subject => ({
    id: r.id,
    semesterId: r.semester_id,
    name: r.name,
    color: r.color,
    personal: !!r.personal,
    assessment: r.assessment === 'pass_fail' ? 'pass_fail' : 'grade',
    credits: r.credits ?? null,
    grade: r.grade ?? null,
    passed: r.passed === null || r.passed === undefined ? null : !!r.passed,
  });

  protected liveSubject(id: Id): Subject {
    const r = this.get(
      `SELECT x.* FROM subjects x JOIN semesters sem ON sem.id = x.semester_id
       WHERE x.id = ? AND x.deleted_at IS NULL AND sem.deleted_at IS NULL`,
      id,
    );
    if (!r) throw new UserError('This subject no longer exists.');
    return this.mapSubject(r);
  }

  /** A live subject that can have lectures and exams, i.e. not the personal one. */
  protected courseSubject(id: Id, what: 'lectures' | 'exams'): Subject {
    const s = this.liveSubject(id);
    if (s.personal) throw new UserError(`Personal tasks can't have ${what}. Pick a subject.`);
    return s;
  }

  private subjectInput(input: SubjectInput): SubjectInput {
    const name = this.text(input?.name, 'Subject name');
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) throw new UserError('Please pick a color.');
    return { semesterId: input.semesterId, name, color: input.color.toLowerCase() };
  }

  /**
   * Assessment, credits and result of a subject: `input`'s values where given, else `existing`'s (or none). The
   * result of the other kind is always cleared; the personal subject never has any.
   */
  private resultInput(
    input: SubjectInput,
    existing: Pick<Subject, 'assessment' | 'credits' | 'grade' | 'passed'> | null,
    personal: boolean,
  ): { assessment: Assessment; credits: number | null; grade: number | null; passed: boolean | null } {
    if (personal) return { assessment: 'grade', credits: null, grade: null, passed: null };
    const assessment = input.assessment ?? existing?.assessment ?? 'grade';
    if (assessment !== 'grade' && assessment !== 'pass_fail') throw new UserError('Pick how the subject is assessed.');
    const num = (value: unknown, what: string, min: number, max: number): number | null => {
      if (value === null) return null;
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new UserError(`${what} must be a number.`);
      if (value < min || value > max) throw new UserError(`${what} must be between ${min} and ${max}.`);
      if (!twoDecimals(value)) throw new UserError(`${what} can have at most two decimals.`);
      return round2(value);
    };
    const credits = num(input.credits === undefined ? (existing?.credits ?? null) : input.credits, 'Credits', 0, MAX_CREDITS);
    const sameKind = existing?.assessment === assessment;
    const grade =
      assessment === 'grade'
        ? num(input.grade === undefined ? (sameKind ? (existing?.grade ?? null) : null) : input.grade, 'The grade', GRADE_MIN, GRADE_MAX)
        : null;
    let passed: boolean | null = null;
    if (assessment === 'pass_fail') {
      const v = input.passed === undefined ? (sameKind ? (existing?.passed ?? null) : null) : input.passed;
      if (v !== null && typeof v !== 'boolean') throw new UserError('Pick passed or failed.');
      passed = v;
    }
    return { assessment, credits, grade, passed };
  }

  listSubjects(semesterId: Id): Subject[] {
    return this.all('SELECT * FROM subjects WHERE semester_id = ? AND deleted_at IS NULL ORDER BY personal, name COLLATE NOCASE, id', semesterId).map(
      this.mapSubject,
    );
  }

  createSubject(input: SubjectInput): Subject {
    const v = this.subjectInput(input);
    this.liveSemester(v.semesterId);
    const res = this.resultInput(input, null, false);
    const t = this.stamp();
    const r = this.run(
      `INSERT INTO subjects (semester_id, name, color, assessment, credits, grade, passed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.semesterId,
      v.name,
      v.color,
      res.assessment,
      res.credits,
      res.grade,
      res.passed === null ? null : res.passed ? 1 : 0,
      t,
      t,
    );
    return this.liveSubject(Number(r.lastInsertRowid));
  }

  updateSubject(id: Id, input: SubjectInput): Subject {
    const existing = this.liveSubject(id);
    const v = this.subjectInput({ ...input, semesterId: existing.semesterId });
    const res = this.resultInput(input, existing, existing.personal);
    this.run(
      'UPDATE subjects SET name = ?, color = ?, assessment = ?, credits = ?, grade = ?, passed = ?, updated_at = ? WHERE id = ?',
      v.name,
      v.color,
      res.assessment,
      res.credits,
      res.grade,
      res.passed === null ? null : res.passed ? 1 : 0,
      this.stamp(),
      id,
    );
    return this.liveSubject(id);
  }

  deleteSubject(id: Id): DeleteResult {
    return this.tx(() => {
      const s = this.liveSubject(id);
      if (s.personal) throw new UserError(`"${s.name}" holds your personal tasks and can't be deleted. Delete the tasks instead.`);
      const sem = this.liveSemester(s.semesterId);
      const lectures =this.get<{ n: number }>('SELECT count(*) n FROM lectures WHERE subject_id = ? AND deleted_at IS NULL', id)!.n;
      const exercises = this.get<{ n: number }>('SELECT count(*) n FROM exercises WHERE subject_id = ? AND deleted_at IS NULL', id)!.n;
      const label = `Subject "${s.name}"`;
      const batch = this.newTrashBatch('subject', label, `${sem.name} · ${lectures} lecture(s) · ${exercises} exercise(s)`);
      this.run('UPDATE subjects SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
      return { trashId: batch, label };
    });
  }

  // ----------------------------------------------------------------- breaks

  private mapBreak = (r: any): SemesterBreak => ({
    id: r.id,
    semesterId: r.semester_id,
    name: r.name,
    startDate: r.start_date,
    endDate: r.end_date,
  });

  private liveBreak(id: Id): SemesterBreak {
    const r = this.get(
      `SELECT x.* FROM semester_breaks x JOIN semesters sem ON sem.id = x.semester_id
       WHERE x.id = ? AND x.deleted_at IS NULL AND sem.deleted_at IS NULL`,
      id,
    );
    if (!r) throw new UserError('This break no longer exists.');
    return this.mapBreak(r);
  }

  /** A break must overlap its semester (it may run on past its end, e.g. over Christmas). */
  private breakInput(input: BreakInput, sem: Semester): BreakInput {
    const name = this.text(input?.name ?? '', 'Name', { allowEmpty: true });
    const startDate = this.date(input.startDate, 'First day');
    const endDate = this.date(input.endDate, 'Last day');
    if (startDate > endDate) throw new UserError('The last day must be on or after the first day.');
    if (endDate < sem.startDate || startDate > sem.endDate) throw new UserError('The break must be within the semester.');
    return { semesterId: sem.id, name, startDate, endDate };
  }

  listBreaks(semesterId: Id): SemesterBreak[] {
    this.liveSemester(semesterId);
    return this.breaksBetween(semesterId, '0000-01-01', '9999-12-31');
  }

  /** Live breaks of a semester overlapping [from, to], by start date. */
  protected breaksBetween(semesterId: Id, from: ISODate, to: ISODate): SemesterBreak[] {
    return this.all(
      `SELECT * FROM semester_breaks WHERE semester_id = ? AND deleted_at IS NULL AND end_date >= ? AND start_date <= ?
       ORDER BY start_date, end_date, id`,
      semesterId,
      from,
      to,
    ).map(this.mapBreak);
  }

  createBreak(input: BreakInput): SemesterBreak {
    const v = this.breakInput(input, this.liveSemester(input?.semesterId));
    const t = this.stamp();
    const r = this.run(
      'INSERT INTO semester_breaks (semester_id, name, start_date, end_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      v.semesterId,
      v.name,
      v.startDate,
      v.endDate,
      t,
      t,
    );
    return this.liveBreak(Number(r.lastInsertRowid));
  }

  updateBreak(id: Id, input: BreakInput): SemesterBreak {
    const existing = this.liveBreak(id);
    const v = this.breakInput(input, this.liveSemester(existing.semesterId));
    this.run('UPDATE semester_breaks SET name = ?, start_date = ?, end_date = ?, updated_at = ? WHERE id = ?', v.name, v.startDate, v.endDate, this.stamp(), id);
    return this.liveBreak(id);
  }

  deleteBreak(id: Id): DeleteResult {
    return this.tx(() => {
      const b = this.liveBreak(id);
      const sem = this.liveSemester(b.semesterId);
      const label = `${breakTitle(b)} (${formatDateRange(b.startDate, b.endDate)})`;
      const batch = this.newTrashBatch('break', label, sem.name);
      this.run('UPDATE semester_breaks SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
      return { trashId: batch, label };
    });
  }
}
