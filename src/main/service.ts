import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import {
  addDays,
  dateInWeek,
  diffDays,
  formatDate,
  isValidISODate,
  isValidTime,
  startOfWeek,
  weekday,
  weeksBetween,
  type ISODate,
} from '../shared/dates';
import { computeStreak, weekProgress, type DayTally } from '../shared/progress';
import {
  EXAM_KINDS,
  EXERCISE_STATUSES,
  examTitle,
  type ChecklistItem,
  type ChecklistItemInput,
  type DeleteResult,
  type Exam,
  type ExamInput,
  type Exercise,
  type ExerciseChanges,
  type ExerciseCreateInput,
  type ExerciseSeries,
  type ExerciseStatus,
  type ExerciseUpdateInput,
  type ExerciseUpdateResult,
  type Id,
  type Lecture,
  type LectureInput,
  type LectureOccurrence,
  type Outstanding,
  type OutstandingItem,
  type OverridableField,
  type OverrideConflict,
  type Scope,
  type Semester,
  type SemesterInput,
  type Subject,
  type SubjectInput,
  type SubjectOverview,
  type TrashEntry,
  type TrashKind,
  type SemesterWeekProgress,
  type TodayData,
  type WeekData,
} from '../shared/types';

/** An error caused by invalid user input; its message is shown to the user as-is. */
export class UserError extends Error {}


const MAX_TITLE = 200;
const MAX_DESCRIPTION = 20_000;
const MAX_CHECKLIST = 100;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Override field name for each ExerciseChanges key. */
const CHANGE_FIELDS: [OverridableField, keyof ExerciseChanges][] = [
  ['title', 'title'],
  ['description', 'description'],
  ['plannedDate', 'plannedDates'],
  ['deadlineDate', 'deadlineDate'],
  ['subjectId', 'subjectId'],
];

/** Override fields for the changed keys ('checklist' is handled separately: only a changed structure counts). */
/** Keeps "handed in implies completed" after a change: a newly set handedIn wins, otherwise the status does. */
function settleProgress(u: Exercise, c: ExerciseChanges): void {
  if (!u.handedIn || u.status === 'completed') return;
  if (c.handedIn) u.status = 'completed';
  else u.handedIn = false;
}

function changedFields(c: ExerciseChanges): OverridableField[] {
  return CHANGE_FIELDS.filter(([, key]) => c[key] !== undefined).map(([f]) => f);
}

/** The steps of a checklist without their done state, to tell a changed structure from ticked steps. */
function checklistSteps(items: { text: string }[]): string {
  return JSON.stringify(items.map((i) => i.text));
}

export function seriesTitle(base: string, n: number): string {
  return `${base} ${String(n).padStart(2, '0')}`;
}

// Tables that hold trashable rows, in child-to-parent order.
const TRASH_TABLES = ['exams', 'exercises', 'exercise_series', 'lecture_occurrences', 'lectures', 'subjects', 'semesters'] as const;
type TrashTable = (typeof TRASH_TABLES)[number];

// "Live" = not in the trash and no ancestor in the trash.
const LIVE_SUBJECT = 's.deleted_at IS NULL AND sem.deleted_at IS NULL';
const SUBJECT_JOIN = 'JOIN subjects s ON s.id = x.subject_id JOIN semesters sem ON sem.id = s.semester_id';
const EXERCISE_FROM = `exercises x ${SUBJECT_JOIN} LEFT JOIN exercise_series es ON es.id = x.series_id`;
const LIVE_EXERCISE = `x.deleted_at IS NULL AND (x.series_id IS NULL OR es.deleted_at IS NULL) AND ${LIVE_SUBJECT}`;

export class StudyService {
  private txDepth = 0;

  constructor(
    private db: DatabaseSync,
    private now: () => Date = () => new Date(),
  ) {}

  // ---------------------------------------------------------------- helpers

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }

  private stamp(): string {
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

  private newTrashBatch(kind: TrashKind, label: string, detail = ''): Id {
    const r = this.run('INSERT INTO trash_batches (kind, label, detail, deleted_at) VALUES (?, ?, ?, ?)', kind, label, detail, this.stamp());
    return Number(r.lastInsertRowid);
  }

  // ------------------------------------------------------------- validation

  private text(value: unknown, what: string, opts: { max?: number; allowEmpty?: boolean } = {}): string {
    if (typeof value !== 'string') throw new UserError(`${what} is missing.`);
    const v = value.trim();
    if (!v && !opts.allowEmpty) throw new UserError(`${what} can't be empty.`);
    if (v.length > (opts.max ?? MAX_TITLE)) throw new UserError(`${what} is too long.`);
    return v;
  }

  private date(value: unknown, what: string): ISODate {
    if (!isValidISODate(value)) throw new UserError(`${what} is not a valid date.`);
    return value;
  }

  private int(value: unknown, what: string, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new UserError(`${what} must be a whole number between ${min} and ${max}.`);
    }
    return value;
  }

  private monday(value: unknown): ISODate {
    const d = this.date(value, 'Week');
    if (weekday(d) !== 1) throw new UserError('Week must start on a Monday.');
    return d;
  }

  /** Planned dates must all be on or before the deadline. */
  private checkPlanned(planned: ISODate[], deadline: ISODate, title?: string): void {
    const latest = planned[planned.length - 1];
    if (latest > deadline) {
      const who = title ? ` for "${title}"` : '';
      throw new UserError(
        `The planned date${who} (${formatDate(latest, { weekday: true })}) can't be after the deadline (${formatDate(deadline, { weekday: true })}).`,
      );
    }
  }

  /** Validates, de-duplicates and sorts a list of planned dates. */
  private plannedDatesInput(value: unknown): ISODate[] {
    if (!Array.isArray(value) || value.length === 0) throw new UserError('Plan at least one day to work on the exercise.');
    if (value.length > 100) throw new UserError('Too many planned dates (at most 100).');
    return [...new Set(value.map((d) => this.date(d, 'Planned date')))].sort();
  }

  // --------------------------------------------------------------- semesters

  private mapSemester = (r: any): Semester => ({ id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date });

  private semesterInput(input: SemesterInput): SemesterInput {
    const name = this.text(input?.name, 'Semester name');
    const startDate = this.date(input.startDate, 'Start date');
    const endDate = this.date(input.endDate, 'End date');
    if (startDate > endDate) throw new UserError('The semester must end on or after its start date.');
    return { name, startDate, endDate };
  }

  private liveSemester(id: Id): Semester {
    const r = this.get('SELECT * FROM semesters WHERE id = ? AND deleted_at IS NULL', id);
    if (!r) throw new UserError('This semester no longer exists.');
    return this.mapSemester(r);
  }

  listSemesters(): Semester[] {
    return this.all('SELECT * FROM semesters WHERE deleted_at IS NULL ORDER BY start_date DESC, id DESC').map(this.mapSemester);
  }

  createSemester(input: SemesterInput): Semester {
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
    return this.liveSemester(Number(r.lastInsertRowid));
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
      const n = this.get<{ n: number }>('SELECT count(*) n FROM subjects WHERE semester_id = ? AND deleted_at IS NULL', id)!.n;
      const label = `Semester "${sem.name}"`;
      const batch = this.newTrashBatch('semester', label, `${n} subject${n === 1 ? '' : 's'} with all lectures and exercises`);
      this.run('UPDATE semesters SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
      return { trashId: batch, label };
    });
  }

  // ---------------------------------------------------------------- subjects

  private mapSubject = (r: any): Subject => ({ id: r.id, semesterId: r.semester_id, name: r.name, color: r.color });

  private liveSubject(id: Id): Subject {
    const r = this.get(
      `SELECT x.* FROM subjects x JOIN semesters sem ON sem.id = x.semester_id
       WHERE x.id = ? AND x.deleted_at IS NULL AND sem.deleted_at IS NULL`,
      id,
    );
    if (!r) throw new UserError('This subject no longer exists.');
    return this.mapSubject(r);
  }

  private subjectInput(input: SubjectInput): SubjectInput {
    const name = this.text(input?.name, 'Subject name');
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) throw new UserError('Please pick a color.');
    return { semesterId: input.semesterId, name, color: input.color.toLowerCase() };
  }

  listSubjects(semesterId: Id): Subject[] {
    return this.all('SELECT * FROM subjects WHERE semester_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE, id', semesterId).map(
      this.mapSubject,
    );
  }

  createSubject(input: SubjectInput): Subject {
    const v = this.subjectInput(input);
    this.liveSemester(v.semesterId);
    const t = this.stamp();
    const r = this.run('INSERT INTO subjects (semester_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', v.semesterId, v.name, v.color, t, t);
    return this.liveSubject(Number(r.lastInsertRowid));
  }

  updateSubject(id: Id, input: SubjectInput): Subject {
    const existing = this.liveSubject(id);
    const v = this.subjectInput({ ...input, semesterId: existing.semesterId });
    this.run('UPDATE subjects SET name = ?, color = ?, updated_at = ? WHERE id = ?', v.name, v.color, this.stamp(), id);
    return this.liveSubject(id);
  }

  deleteSubject(id: Id): DeleteResult {
    return this.tx(() => {
      const s = this.liveSubject(id);
      const sem = this.liveSemester(s.semesterId);
      const lectures = this.get<{ n: number }>('SELECT count(*) n FROM lectures WHERE subject_id = ? AND deleted_at IS NULL', id)!.n;
      const exercises = this.get<{ n: number }>('SELECT count(*) n FROM exercises WHERE subject_id = ? AND deleted_at IS NULL', id)!.n;
      const label = `Subject "${s.name}"`;
      const batch = this.newTrashBatch('subject', label, `${sem.name} · ${lectures} lecture(s) · ${exercises} exercise(s)`);
      this.run('UPDATE subjects SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
      return { trashId: batch, label };
    });
  }

  subjectOverview(semesterId: Id): SubjectOverview[] {
    this.liveSemester(semesterId);
    return this.listSubjects(semesterId).map((subject) => {
      const lectures = this.all('SELECT * FROM lectures WHERE subject_id = ? AND deleted_at IS NULL ORDER BY weekday, start_time', subject.id).map(
        this.mapLecture,
      );
      const series = this.all<any>(
        `SELECT es.*, (SELECT count(*) FROM exercises x WHERE x.series_id = es.id AND x.deleted_at IS NULL) AS occ
         FROM exercise_series es WHERE es.subject_id = ? AND es.deleted_at IS NULL ORDER BY es.base_title COLLATE NOCASE`,
        subject.id,
      ).map((r) => ({ ...this.mapSeries(r), occurrenceCount: r.occ }));
      const exercises = this.toExercises(
        this.all(
          `SELECT x.* FROM ${EXERCISE_FROM} WHERE x.subject_id = ? AND ${LIVE_EXERCISE}
           ORDER BY x.deadline_date, x.planned_date, x.sequence_number, x.title COLLATE NOCASE`,
          subject.id,
        ),
      );
      const exams = this.exams(semesterId, { subjectId: subject.id });
      return { subject, lectures, series, exercises, exerciseCount: exercises.length, exams };
    });
  }

  // ---------------------------------------------------------------- lectures

  private mapLecture = (r: any): Lecture => ({
    id: r.id,
    subjectId: r.subject_id,
    title: r.title,
    weekday: r.weekday,
    startTime: r.start_time,
    endTime: r.end_time,
  });

  private liveLecture(id: Id): Lecture {
    const r = this.get(`SELECT x.* FROM lectures x ${SUBJECT_JOIN} WHERE x.id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`, id);
    if (!r) throw new UserError('This lecture no longer exists.');
    return this.mapLecture(r);
  }

  private lectureInput(input: LectureInput): LectureInput {
    const title = this.text(input?.title, 'Lecture title');
    const wd = this.int(input.weekday, 'Day', 1, 7);
    if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) throw new UserError('Please enter times as HH:MM (24-hour).');
    if (input.startTime >= input.endTime) throw new UserError('The lecture must end after it starts.');
    return { subjectId: input.subjectId, title, weekday: wd, startTime: input.startTime, endTime: input.endTime };
  }

  getLecture(id: Id): Lecture {
    return this.liveLecture(id);
  }

  createLecture(input: LectureInput): Lecture {
    const v = this.lectureInput(input);
    this.liveSubject(v.subjectId);
    const t = this.stamp();
    const r = this.run(
      'INSERT INTO lectures (subject_id, title, weekday, start_time, end_time, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      v.subjectId,
      v.title,
      v.weekday,
      v.startTime,
      v.endTime,
      t,
      t,
    );
    return this.liveLecture(Number(r.lastInsertRowid));
  }

  updateLecture(id: Id, input: LectureInput): Lecture {
    const existing = this.liveLecture(id);
    const v = this.lectureInput(input);
    const newSubject = this.liveSubject(v.subjectId);
    if (newSubject.semesterId !== this.liveSubject(existing.subjectId).semesterId) {
      throw new UserError('A lecture can only be moved to a subject in the same semester.');
    }
    this.run(
      'UPDATE lectures SET subject_id = ?, title = ?, weekday = ?, start_time = ?, end_time = ?, updated_at = ? WHERE id = ?',
      v.subjectId,
      v.title,
      v.weekday,
      v.startTime,
      v.endTime,
      this.stamp(),
      id,
    );
    return this.liveLecture(id);
  }

  private semesterOfSubject(subjectId: Id): Semester {
    return this.liveSemester(this.liveSubject(subjectId).semesterId);
  }

  /** Mondays of weeks in which this lecture has an occurrence inside the semester. */
  private lectureWeeks(lecture: Lecture, sem: Semester): ISODate[] {
    return weeksBetween(sem.startDate, sem.endDate).filter((w) => {
      const d = dateInWeek(w, lecture.weekday);
      return d >= sem.startDate && d <= sem.endDate;
    });
  }

  setLectureCompleted(lectureId: Id, weekStart: ISODate, completed: boolean): void {
    this.tx(() => {
      const lecture = this.liveLecture(lectureId);
      const ws = this.monday(weekStart);
      const sem = this.semesterOfSubject(lecture.subjectId);
      const d = dateInWeek(ws, lecture.weekday);
      if (d < sem.startDate || d > sem.endDate) throw new UserError('This lecture does not take place in that week.');
      const row = this.get<any>('SELECT * FROM lecture_occurrences WHERE lecture_id = ? AND week_start = ?', lectureId, ws);
      if (row && (row.deleted_at || row.removed)) throw new UserError('This lecture occurrence was deleted.');
      const at = completed ? this.stamp() : null;
      if (row) {
        this.run('UPDATE lecture_occurrences SET completed = ?, completed_at = ? WHERE id = ?', completed ? 1 : 0, at, row.id);
      } else {
        this.run('INSERT INTO lecture_occurrences (lecture_id, week_start, completed, completed_at) VALUES (?, ?, ?, ?)', lectureId, ws, completed ? 1 : 0, at);
      }
    });
  }

  deleteLecture(id: Id, scope: Scope, weekStart: ISODate): DeleteResult {
    return this.tx(() => {
      const lecture = this.liveLecture(id);
      if (scope === 'all') {
        const label = `Lecture "${lecture.title}"`;
        const batch = this.newTrashBatch('lecture', label, 'All weeks');
        this.run('UPDATE lectures SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', this.stamp(), batch, id);
        return { trashId: batch, label };
      }
      const ws = this.monday(weekStart);
      const sem = this.semesterOfSubject(lecture.subjectId);
      const weeks = scope === 'this' ? [ws] : this.lectureWeeks(lecture, sem).filter((w) => w >= ws);
      const d = formatDate(dateInWeek(ws, lecture.weekday), { weekday: true, year: true });
      const label = scope === 'this' ? `Lecture "${lecture.title}" on ${d}` : `Lecture "${lecture.title}" from ${d} onwards`;
      const batch = this.newTrashBatch('lecture_occurrences', label, scope === 'this' ? 'One week' : `${weeks.length} week(s)`);
      const t = this.stamp();
      for (const w of weeks) {
        this.run(
          `INSERT INTO lecture_occurrences (lecture_id, week_start, deleted_at, trash_batch_id) VALUES (?, ?, ?, ?)
           ON CONFLICT (lecture_id, week_start) DO UPDATE SET deleted_at = excluded.deleted_at, trash_batch_id = excluded.trash_batch_id
           WHERE deleted_at IS NULL AND removed = 0`,
          id,
          w,
          t,
          batch,
        );
      }
      return { trashId: batch, label };
    });
  }

  /** Occurrences of live lectures of a semester, within the semester's date range. */
  private lectureOccurrences(sem: Semester, from: ISODate, to: ISODate): LectureOccurrence[] {
    const lectures = this.all<any>(
      `SELECT x.* FROM lectures x ${SUBJECT_JOIN} WHERE s.semester_id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`,
      sem.id,
    ).map(this.mapLecture);
    if (lectures.length === 0) return [];
    const lo = from > sem.startDate ? from : sem.startDate;
    const hi = to < sem.endDate ? to : sem.endDate;
    if (lo > hi) return [];
    const states = new Map<string, any>();
    for (const r of this.all<any>(
      `SELECT o.* FROM lecture_occurrences o JOIN lectures x ON x.id = o.lecture_id ${SUBJECT_JOIN}
       WHERE s.semester_id = ? AND o.week_start BETWEEN ? AND ?`,
      sem.id,
      startOfWeek(lo),
      startOfWeek(hi),
    )) {
      states.set(`${r.lecture_id}|${r.week_start}`, r);
    }
    const result: LectureOccurrence[] = [];
    for (const w of weeksBetween(lo, hi)) {
      for (const l of lectures) {
        const date = dateInWeek(w, l.weekday);
        if (date < lo || date > hi) continue;
        const st = states.get(`${l.id}|${w}`);
        if (st && (st.deleted_at || st.removed)) continue;
        result.push({
          lectureId: l.id,
          subjectId: l.subjectId,
          title: l.title,
          date,
          weekStart: w,
          startTime: l.startTime,
          endTime: l.endTime,
          completed: !!st?.completed,
        });
      }
    }
    return result;
  }

  // --------------------------------------------------------------- exercises

  /** Maps exercise rows and attaches each exercise's planned dates and checklist (queries per 500 rows). */
  private toExercises(rows: any[]): Exercise[] {
    const dates = new Map<Id, ISODate[]>();
    const checklists = new Map<Id, ChecklistItem[]>();
    const ids = rows.map((r) => r.id as Id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const marks = chunk.map(() => '?').join(',');
      for (const d of this.all<{ exercise_id: Id; date: ISODate }>(
        `SELECT exercise_id, date FROM exercise_plan_dates WHERE exercise_id IN (${marks}) ORDER BY date`,
        ...chunk,
      )) {
        if (!dates.has(d.exercise_id)) dates.set(d.exercise_id, []);
        dates.get(d.exercise_id)!.push(d.date);
      }
      for (const c of this.all<{ id: Id; exercise_id: Id; text: string; done: number }>(
        `SELECT id, exercise_id, text, done FROM exercise_checklist_items WHERE exercise_id IN (${marks}) ORDER BY position, id`,
        ...chunk,
      )) {
        if (!checklists.has(c.exercise_id)) checklists.set(c.exercise_id, []);
        checklists.get(c.exercise_id)!.push({ id: c.id, text: c.text, done: !!c.done });
      }
    }
    return rows.map((r) => {
      const plannedDates = dates.get(r.id) ?? [r.planned_date];
      return {
        id: r.id,
        subjectId: r.subject_id,
        seriesId: r.series_id ?? null,
        sequenceNumber: r.sequence_number ?? null,
        title: r.title,
        description: r.description,
        plannedDate: plannedDates[0],
        plannedDates,
        deadlineDate: r.deadline_date,
        status: r.status,
        handedIn: !!r.handed_in,
        checklist: checklists.get(r.id) ?? [],
        overrides: JSON.parse(r.overrides || '[]'),
      };
    });
  }

  private mapSeries = (r: any): ExerciseSeries => ({
    id: r.id,
    subjectId: r.subject_id,
    baseTitle: r.base_title,
    intervalWeeks: r.interval_weeks,
    nextNumber: r.next_number,
  });

  private liveExercise(id: Id): Exercise {
    const r = this.get(`SELECT x.* FROM ${EXERCISE_FROM} WHERE x.id = ? AND ${LIVE_EXERCISE}`, id);
    if (!r) throw new UserError('This exercise no longer exists.');
    return this.toExercises([r])[0];
  }

  private liveSeries(id: Id): ExerciseSeries {
    const r = this.get(`SELECT x.* FROM exercise_series x ${SUBJECT_JOIN} WHERE x.id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`, id);
    if (!r) throw new UserError('This exercise series no longer exists.');
    return this.mapSeries(r);
  }

  private liveSeriesOccurrences(seriesId: Id): Exercise[] {
    return this.toExercises(
      this.all(`SELECT x.* FROM ${EXERCISE_FROM} WHERE x.series_id = ? AND ${LIVE_EXERCISE} ORDER BY x.sequence_number`, seriesId),
    );
  }

  getExercise(id: Id): Exercise {
    return this.liveExercise(id);
  }

  getSeries(id: Id): ExerciseSeries {
    return this.liveSeries(id);
  }

  private status(value: unknown): ExerciseStatus {
    if (!EXERCISE_STATUSES.includes(value as ExerciseStatus)) throw new UserError('Unknown exercise status.');
    return value as ExerciseStatus;
  }

  private handedIn(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new UserError('Unknown hand-in state.');
    return value;
  }

  private savePlannedDates(exerciseId: Id, dates: ISODate[]): void {
    this.run('DELETE FROM exercise_plan_dates WHERE exercise_id = ?', exerciseId);
    for (const d of dates) this.run('INSERT INTO exercise_plan_dates (exercise_id, date) VALUES (?, ?)', exerciseId, d);
  }

  /** Validates a checklist: every step needs text. */
  private checklistInput(value: unknown): ChecklistItemInput[] {
    if (!Array.isArray(value)) throw new UserError('The checklist is invalid.');
    if (value.length > MAX_CHECKLIST) throw new UserError(`A checklist can have at most ${MAX_CHECKLIST} steps.`);
    return value.map((item) => ({ text: this.text(item?.text, 'Checklist step'), done: item?.done === true }));
  }

  private saveChecklist(exerciseId: Id, items: ChecklistItemInput[]): void {
    this.run('DELETE FROM exercise_checklist_items WHERE exercise_id = ?', exerciseId);
    items.forEach((item, i) =>
      this.run('INSERT INTO exercise_checklist_items (exercise_id, position, text, done) VALUES (?, ?, ?, ?)', exerciseId, i, item.text, item.done ? 1 : 0),
    );
  }

  private insertExercise(e: Omit<Exercise, 'id' | 'overrides' | 'plannedDate' | 'checklist'> & { checklist: ChecklistItemInput[] }): Id {
    const dates = [...new Set(e.plannedDates)].sort();
    const t = this.stamp();
    const r = this.run(
      `INSERT INTO exercises (subject_id, series_id, sequence_number, title, description, planned_date, deadline_date, status, handed_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.subjectId,
      e.seriesId,
      e.sequenceNumber,
      e.title,
      e.description,
      dates[0],
      e.deadlineDate,
      e.status,
      e.handedIn ? 1 : 0,
      t,
      t,
    );
    const id = Number(r.lastInsertRowid);
    this.savePlannedDates(id, dates);
    this.saveChecklist(id, e.checklist);
    return id;
  }

  createExercise(input: ExerciseCreateInput): Exercise[] {
    return this.tx(() => {
      this.liveSubject(input?.subjectId);
      const title = this.text(input.title, 'Exercise title');
      const description = this.text(input.description ?? '', 'Description', { max: MAX_DESCRIPTION, allowEmpty: true });
      const planned = this.plannedDatesInput(input.plannedDates);
      const deadline = this.date(input.deadlineDate, 'Deadline');
      this.checkPlanned(planned, deadline);
      const handedIn = this.handedIn(input.handedIn ?? false);
      const status = handedIn ? 'completed' : this.status(input.status ?? 'not_started');
      const checklist = this.checklistInput(input.checklist ?? []);

      if (!input.recurrence) {
        const id = this.insertExercise({
          subjectId: input.subjectId,
          seriesId: null,
          sequenceNumber: null,
          title,
          description,
          plannedDates: planned,
          deadlineDate: deadline,
          status,
          handedIn,
          checklist,
        });
        return [this.liveExercise(id)];
      }

      const interval = this.int(input.recurrence.intervalWeeks, 'Repeat interval (weeks)', 1, 52);
      const count = this.int(input.recurrence.count, 'Number of occurrences', 1, 200);
      const first = this.int(input.recurrence.firstNumber, 'First number', 0, 9999);
      const t = this.stamp();
      const seriesId = Number(
        this.run(
          'INSERT INTO exercise_series (subject_id, base_title, interval_weeks, next_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          input.subjectId,
          title,
          interval,
          first + count,
          t,
          t,
        ).lastInsertRowid,
      );
      const ids: Id[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(
          this.insertExercise({
            subjectId: input.subjectId,
            seriesId,
            sequenceNumber: first + i,
            title: seriesTitle(title, first + i),
            description,
            // The planned-date pattern repeats in every occurrence.
            plannedDates: planned.map((d) => addDays(d, 7 * interval * i)),
            deadlineDate: addDays(deadline, 7 * interval * i),
            status: i === 0 ? status : 'not_started',
            handedIn: i === 0 && handedIn,
            checklist: i === 0 ? checklist : checklist.map((c) => ({ text: c.text, done: false })),
          }),
        );
      }
      return ids.map((id) => this.liveExercise(id));
    });
  }

  extendSeries(seriesId: Id, count: number): Exercise[] {
    return this.tx(() => {
      const series = this.liveSeries(seriesId);
      const n = this.int(count, 'Number of occurrences', 1, 200);
      // Continue from the latest occurrence still present (live or in the trash).
      const lastRow = this.get<any>('SELECT * FROM exercises WHERE series_id = ? ORDER BY sequence_number DESC LIMIT 1', seriesId);
      if (!lastRow) throw new UserError('This series has no occurrences left to continue from.');
      const last = this.toExercises([lastRow])[0];
      const ids: Id[] = [];
      for (let i = 0; i < n; i++) {
        const num = series.nextNumber + i;
        const shift = 7 * series.intervalWeeks * (num - last.sequenceNumber!);
        ids.push(
          this.insertExercise({
            subjectId: series.subjectId,
            seriesId,
            sequenceNumber: num,
            title: seriesTitle(series.baseTitle, num),
            description: last.description,
            plannedDates: last.plannedDates.map((d) => addDays(d, shift)),
            deadlineDate: addDays(last.deadlineDate, shift),
            status: 'not_started',
            handedIn: false,
            checklist: last.checklist.map((c) => ({ text: c.text, done: false })),
          }),
        );
      }
      this.run('UPDATE exercise_series SET next_number = ?, updated_at = ? WHERE id = ?', series.nextNumber + n, this.stamp(), seriesId);
      return ids.map((id) => this.liveExercise(id));
    });
  }

  private writeExercise(e: Exercise): void {
    const dates = [...new Set(e.plannedDates)].sort();
    this.run(
      `UPDATE exercises SET subject_id = ?, title = ?, description = ?, planned_date = ?, deadline_date = ?, status = ?, handed_in = ?, overrides = ?, updated_at = ?
       WHERE id = ?`,
      e.subjectId,
      e.title,
      e.description,
      dates[0],
      e.deadlineDate,
      e.status,
      e.handedIn ? 1 : 0,
      JSON.stringify([...new Set(e.overrides)].sort()),
      this.stamp(),
      e.id,
    );
    this.savePlannedDates(e.id, dates);
  }

  /** Validates `changes` and drops fields that equal the current value. */
  private normalizeChanges(e: Exercise, changes: ExerciseChanges, seriesScope: boolean, series: ExerciseSeries | null): ExerciseChanges {
    const c: ExerciseChanges = {};
    if (changes.title !== undefined) {
      const title = this.text(changes.title, seriesScope ? 'Series title' : 'Exercise title');
      if (title !== (seriesScope ? series!.baseTitle : e.title)) c.title = title;
    }
    if (changes.description !== undefined) {
      const d = this.text(changes.description, 'Description', { max: MAX_DESCRIPTION, allowEmpty: true });
      if (d !== e.description) c.description = d;
    }
    if (changes.subjectId !== undefined && changes.subjectId !== e.subjectId) {
      const target = this.liveSubject(changes.subjectId);
      if (target.semesterId !== this.liveSubject(e.subjectId).semesterId) {
        throw new UserError('An exercise can only be moved to a subject in the same semester.');
      }
      c.subjectId = changes.subjectId;
    }
    if (changes.plannedDates !== undefined) {
      const d = this.plannedDatesInput(changes.plannedDates);
      if (d.join() !== e.plannedDates.join()) c.plannedDates = d;
    }
    if (changes.deadlineDate !== undefined) {
      const d = this.date(changes.deadlineDate, 'Deadline');
      if (d !== e.deadlineDate) c.deadlineDate = d;
    }
    if (changes.status !== undefined) {
      const s = this.status(changes.status);
      if (s !== e.status) c.status = s;
    }
    if (changes.handedIn !== undefined) {
      const h = this.handedIn(changes.handedIn);
      if (h !== e.handedIn) c.handedIn = h;
    }
    if (changes.checklist !== undefined) {
      const list = this.checklistInput(changes.checklist);
      const same = JSON.stringify(list) === JSON.stringify(e.checklist.map(({ text, done }) => ({ text, done })));
      if (!same) c.checklist = list;
    }
    return c;
  }

  updateExercise(input: ExerciseUpdateInput): ExerciseUpdateResult {
    return this.tx(() => {
      const e = this.liveExercise(input?.id);
      const scope: Scope = e.seriesId === null ? 'this' : input.scope;
      if (!['this', 'future', 'all'].includes(scope)) throw new UserError('Unknown scope.');

      if (scope === 'this') {
        const { checklist, ...c } = this.normalizeChanges(e, input.changes ?? {}, false, null);
        const updated: Exercise = { ...e, ...c };
        settleProgress(updated, c);
        this.checkPlanned(updated.plannedDates, updated.deadlineDate);
        if (e.seriesId !== null) {
          updated.overrides.push(...changedFields(c));
          // Ticking steps is progress, not an individual change; different steps are.
          if (checklist && checklistSteps(checklist) !== checklistSteps(e.checklist)) updated.overrides.push('checklist');
        }
        this.writeExercise(updated);
        if (checklist) this.saveChecklist(e.id, checklist);
        return { status: 'updated', count: 1 };
      }

      const series = this.liveSeries(e.seriesId!);
      const { checklist, ...c } = this.normalizeChanges(e, input.changes ?? {}, true, series);
      const structural = checklist !== undefined && checklistSteps(checklist) !== checklistSteps(e.checklist);
      const fields: OverridableField[] = [...changedFields(c), ...(structural ? ['checklist' as const] : [])];
      const targets = this.liveSeriesOccurrences(series.id).filter((t) => scope === 'all' || t.sequenceNumber! >= e.sequenceNumber!);

      // Never silently overwrite individually changed occurrences: ask first.
      const conflicts: OverrideConflict[] = targets
        .filter((t) => t.id !== e.id)
        .map((t) => ({ id: t.id, title: t.title, fields: t.overrides.filter((f) => fields.includes(f)) }))
        .filter((x) => x.fields.length > 0);
      if (conflicts.length > 0 && input.overridePolicy === undefined) return { status: 'conflicts', conflicts };

      const step = 7 * series.intervalWeeks;
      const deadlineShift = c.deadlineDate !== undefined ? diffDays(e.deadlineDate, c.deadlineDate) : 0;
      const invalid: string[] = [];
      const updates: Exercise[] = [];
      const checklistWrites = new Map<Id, ChecklistItemInput[]>();
      for (const t of targets) {
        const keep = t.id !== e.id && input.overridePolicy === 'keep' ? t.overrides : [];
        const apply = fields.filter((f) => !keep.includes(f));
        const u: Exercise = { ...t, overrides: t.overrides.filter((f) => !apply.includes(f)) };
        if (apply.includes('title')) u.title = seriesTitle(c.title!, t.sequenceNumber!);
        if (apply.includes('description')) u.description = c.description!;
        if (apply.includes('subjectId')) u.subjectId = c.subjectId!;
        // Planned dates: the edited pattern, moved to each occurrence's position in the series.
        if (apply.includes('plannedDate')) u.plannedDates = c.plannedDates!.map((d) => addDays(d, step * (t.sequenceNumber! - e.sequenceNumber!)));
        if (apply.includes('deadlineDate')) u.deadlineDate = addDays(t.deadlineDate, deadlineShift);
        if (t.id === e.id) {
          if (c.status !== undefined) u.status = c.status;
          if (c.handedIn !== undefined) u.handedIn = c.handedIn;
          settleProgress(u, c);
        }
        // Checklist: this exercise gets it as edited (with its done states); the others get the same steps,
        // keeping the done state of steps they already had.
        if (t.id === e.id && checklist) checklistWrites.set(t.id, checklist);
        else if (apply.includes('checklist')) {
          const done = new Set(t.checklist.filter((i) => i.done).map((i) => i.text));
          checklistWrites.set(t.id, checklist!.map((i) => ({ text: i.text, done: done.has(i.text) })));
        }
        if (u.plannedDates[u.plannedDates.length - 1] > u.deadlineDate) invalid.push(u.title);
        updates.push(u);
      }
      if (invalid.length > 0) {
        throw new UserError(
          `This change would put the planned date after the deadline for: ${invalid.slice(0, 5).join(', ')}` +
            (invalid.length > 5 ? ` and ${invalid.length - 5} more` : '') +
            '. Nothing was changed.',
        );
      }
      for (const u of updates) this.writeExercise(u);
      for (const [id, list] of checklistWrites) this.saveChecklist(id, list);
      if (c.title !== undefined || c.subjectId !== undefined) {
        this.run(
          'UPDATE exercise_series SET base_title = ?, subject_id = ?, updated_at = ? WHERE id = ?',
          c.title ?? series.baseTitle,
          c.subjectId ?? series.subjectId,
          this.stamp(),
          series.id,
        );
      }
      return { status: 'updated', count: updates.length };
    });
  }

  setExerciseStatus(id: Id, status: ExerciseStatus): void {
    const e = this.liveExercise(id);
    const s = this.status(status);
    this.run('UPDATE exercises SET status = ?, handed_in = ?, updated_at = ? WHERE id = ?', s, s === 'completed' && e.handedIn ? 1 : 0, this.stamp(), e.id);
  }

  setExerciseHandedIn(id: Id, handedIn: boolean): void {
    const e = this.liveExercise(id);
    const h = this.handedIn(handedIn);
    this.run('UPDATE exercises SET status = ?, handed_in = ?, updated_at = ? WHERE id = ?', h ? 'completed' : e.status, h ? 1 : 0, this.stamp(), e.id);
  }

  setChecklistItemDone(itemId: Id, done: boolean): Exercise {
    return this.tx(() => {
      const item = this.get<{ exercise_id: Id }>('SELECT exercise_id FROM exercise_checklist_items WHERE id = ?', itemId);
      if (!item) throw new UserError('This checklist step no longer exists; the exercise was changed in the meantime.');
      const e = this.liveExercise(item.exercise_id);
      this.run('UPDATE exercise_checklist_items SET done = ? WHERE id = ?', done ? 1 : 0, itemId);
      if (done && e.status === 'not_started') {
        this.run("UPDATE exercises SET status = 'in_progress', updated_at = ? WHERE id = ?", this.stamp(), e.id);
      }
      return this.liveExercise(e.id);
    });
  }

  /** Moves one planned date. If the exercise is already planned on `toDate`, the two merge. */
  moveExercise(id: Id, fromDate: ISODate, toDate: ISODate): Exercise {
    return this.tx(() => {
      const e = this.liveExercise(id);
      const from = this.date(fromDate, 'Planned date');
      const to = this.date(toDate, 'Planned date');
      if (!e.plannedDates.includes(from)) throw new UserError('This planned date no longer exists; the exercise was changed in the meantime.');
      if (from === to) return e;
      this.checkPlanned([to], e.deadlineDate, e.title);
      const plannedDates = [...new Set(e.plannedDates.map((d) => (d === from ? to : d)))].sort();
      const overrides = e.seriesId !== null ? [...e.overrides, 'plannedDate' as const] : e.overrides;
      this.writeExercise({ ...e, plannedDates, overrides });
      return this.liveExercise(id);
    });
  }

  deleteExercise(id: Id, scope: Scope): DeleteResult {
    return this.tx(() => {
      const e = this.liveExercise(id);
      const t = this.stamp();
      if (e.seriesId === null || scope === 'this') {
        const label = `Exercise "${e.title}"`;
        const batch = this.newTrashBatch('exercise', label, `Due ${formatDate(e.deadlineDate, { weekday: true, year: true })}`);
        this.run('UPDATE exercises SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', t, batch, id);
        return { trashId: batch, label };
      }
      const series = this.liveSeries(e.seriesId);
      if (scope === 'all') {
        const n = this.liveSeriesOccurrences(series.id).length;
        const label = `Exercise series "${series.baseTitle}"`;
        const batch = this.newTrashBatch('exercise_series', label, `${n} exercise(s)`);
        this.run('UPDATE exercise_series SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', t, batch, series.id);
        return { trashId: batch, label };
      }
      const targets = this.liveSeriesOccurrences(series.id).filter((x) => x.sequenceNumber! >= e.sequenceNumber!);
      const label = `"${e.title}" and later occurrences`;
      const batch = this.newTrashBatch('exercise_occurrences', label, `${targets.length} exercise(s) of "${series.baseTitle}"`);
      for (const x of targets) this.run('UPDATE exercises SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', t, batch, x.id);
      return { trashId: batch, label };
    });
  }

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
  private exams(semesterId: Id, opts: { subjectId?: Id; from?: ISODate; to?: ISODate } = {}): Exam[] {
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
    this.liveSubject(v.subjectId);
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
    if (this.liveSubject(v.subjectId).semesterId !== this.liveSubject(existing.subjectId).semesterId) {
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

  // ------------------------------------------------------------------ views

  getWeek(semesterId: Id, weekStart: ISODate): WeekData {
    const sem = this.liveSemester(semesterId);
    const ws = this.monday(weekStart);
    const we = addDays(ws, 6);
    const exercises = this.toExercises(
      this.all(
        `SELECT x.* FROM ${EXERCISE_FROM}
         WHERE s.semester_id = ? AND ${LIVE_EXERCISE}
           AND (x.deadline_date BETWEEN ? AND ?
                OR EXISTS (SELECT 1 FROM exercise_plan_dates p WHERE p.exercise_id = x.id AND p.date BETWEEN ? AND ?))
         ORDER BY x.deadline_date, x.title`,
        sem.id,
        ws,
        we,
        ws,
        we,
      ),
    );
    const series = this.all(
      `SELECT x.* FROM exercise_series x ${SUBJECT_JOIN} WHERE s.semester_id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`,
      sem.id,
    ).map(this.mapSeries);
    return {
      weekStart: ws,
      subjects: this.listSubjects(sem.id),
      lectures: this.lectureOccurrences(sem, ws, we),
      exercises,
      series,
      exams: this.exams(sem.id, { from: ws, to: we }),
    };
  }

  getSemesterProgress(semesterId: Id): SemesterWeekProgress[] {
    const sem = this.liveSemester(semesterId);
    return weeksBetween(sem.startDate, sem.endDate).map((w) => ({ weekStart: w, ...weekProgress(this.getWeek(semesterId, w)) }));
  }

  getOutstanding(semesterId: Id, today: ISODate): Outstanding {
    const sem = this.liveSemester(semesterId);
    const t = this.date(today, 'Today');
    const items: OutstandingItem[] = [];
    for (const o of this.lectureOccurrences(sem, sem.startDate, t)) {
      if (!o.completed) items.push({ kind: 'lecture', date: o.date, occurrence: o });
    }
    const exercises = this.toExercises(
      this.all(`SELECT x.* FROM ${EXERCISE_FROM} WHERE s.semester_id = ? AND ${LIVE_EXERCISE} AND x.handed_in = 0`, sem.id),
    );
    for (const e of exercises) items.push({ kind: 'exercise', date: e.plannedDate, exercise: e, overdue: e.deadlineDate < t });
    const key = (i: OutstandingItem) =>
      i.kind === 'lecture' ? `${i.date}|0|${i.occurrence.startTime}|${i.occurrence.title}` : `${i.date}|1|${i.exercise.deadlineDate}|${i.exercise.title}`;
    items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return { subjects: this.listSubjects(sem.id), items };
  }

  getToday(semesterId: Id, today: ISODate): TodayData {
    const sem = this.liveSemester(semesterId);
    const t = this.date(today, 'Today');
    const weekAhead = addDays(t, 7);
    const lectures = this.lectureOccurrences(sem, sem.startDate, weekAhead);
    const exercises = this.toExercises(
      this.all(`SELECT x.* FROM ${EXERCISE_FROM} WHERE s.semester_id = ? AND ${LIVE_EXERCISE} ORDER BY x.deadline_date, x.title`, sem.id),
    );

    // Streak: what was scheduled on each day up to today, and how much of it is done.
    const tallies = new Map<ISODate, DayTally>();
    const tally = (d: ISODate, done: boolean) => {
      const x = tallies.get(d) ?? { total: 0, done: 0 };
      x.total++;
      if (done) x.done++;
      tallies.set(d, x);
    };
    for (const o of lectures) if (o.date <= t) tally(o.date, o.completed);
    for (const e of exercises) for (const d of e.plannedDates) if (d >= sem.startDate && d <= t) tally(d, e.status === 'completed');

    const byTime = (a: LectureOccurrence, b: LectureOccurrence) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title);
    const open = exercises.filter((e) => !e.handedIn);
    return {
      today: t,
      subjects: this.listSubjects(sem.id),
      lectures: lectures.filter((o) => o.date === t).sort(byTime),
      upcomingLectures: lectures.filter((o) => o.date > t).sort(byTime),
      planned: exercises.filter((e) => e.plannedDates.includes(t)),
      dueSoon: open.filter((e) => e.deadlineDate >= t && e.deadlineDate <= weekAhead),
      overdue: open.filter((e) => e.deadlineDate < t),
      missedLectures: lectures.filter((o) => o.date < t && !o.completed).sort(byTime),
      exams: this.exams(sem.id, { from: t }),
      streak: computeStreak(tallies, sem.startDate, t),
    };
  }

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
        return semesterGone(this.get<any>('SELECT semester_id FROM subjects WHERE id = ?', id).semester_id);
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
