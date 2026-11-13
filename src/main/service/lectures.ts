import { addDays, dateInWeek, diffDays, formatDate, formatDateRange, isValidTime, startOfWeek, weekday, weeksBetween, WEEKDAY_NAMES, type ISODate } from '../../shared/dates';
import {
  breakOn,
  breakTitle,
  type DeleteResult,
  type Id,
  type Lecture,
  type LectureInput,
  type LectureOccurrence,
  type Scope,
  type Semester,
  type SemesterBreak,
} from '../../shared/types';
import { LIVE_SUBJECT, SUBJECT_JOIN, UserError } from './base';
import { SemesterService } from './semesters';

/** Lectures and their weekly occurrences. */
export class LectureService extends SemesterService {
  // ---------------------------------------------------------------- lectures

  protected mapLecture = (r: any): Lecture => ({
    id: r.id,
    subjectId: r.subject_id,
    title: r.title,
    weekday: r.weekday,
    startTime: r.start_time,
    endTime: r.end_time,
    startDate: r.start_date ?? null,
    endDate: r.end_date ?? null,
  });

  private liveLecture(id: Id): Lecture {
    const r = this.get(`SELECT x.* FROM lectures x ${SUBJECT_JOIN} WHERE x.id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`, id);
    if (!r) throw new UserError('This lecture no longer exists.');
    return this.mapLecture(r);
  }

  /** Validates a lecture; its dates must lie within the semester and include at least one of its weekdays. */
  private lectureInput(input: LectureInput, sem: Semester): Required<LectureInput> {
    const title = this.text(input?.title, 'Lecture title');
    const wd = this.int(input.weekday, 'Day', 1, 7);
    if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) throw new UserError('Please enter times as HH:MM (24-hour).');
    if (input.startTime >= input.endTime) throw new UserError('The lecture must end after it starts.');
    const optional = (v: unknown, what: string) => (v === null || v === undefined || v === '' ? null : this.date(v, what));
    const startDate = optional(input.startDate, 'First lecture');
    const endDate = optional(input.endDate, 'Last lecture');
    const v = { subjectId: input.subjectId, title, weekday: wd, startTime: input.startTime, endTime: input.endTime, startDate, endDate };
    for (const d of [startDate, endDate]) {
      if (d && (d < sem.startDate || d > sem.endDate)) {
        throw new UserError(`The lecture's dates must be within the semester (${formatDate(sem.startDate, { year: true })} – ${formatDate(sem.endDate, { year: true })}).`);
      }
    }
    const { from, to } = this.lectureRange(v, sem);
    if (from > to) throw new UserError('The last lecture must be on or after the first one.');
    const days = Array.from({ length: Math.min(7, diffDays(from, to) + 1) }, (_, i) => addDays(from, i));
    if (!days.some((d) => weekday(d) === wd)) throw new UserError(`There is no ${WEEKDAY_NAMES[wd - 1]} between ${formatDateRange(from, to)}.`);
    return v;
  }

  /** The days a lecture can take place: its own dates, else the semester's (never beyond the semester's). */
  private lectureRange(l: Pick<Lecture, 'startDate' | 'endDate'>, sem: Semester): { from: ISODate; to: ISODate } {
    return {
      from: l.startDate && l.startDate > sem.startDate ? l.startDate : sem.startDate,
      to: l.endDate && l.endDate < sem.endDate ? l.endDate : sem.endDate,
    };
  }

  getLecture(id: Id): Lecture {
    return this.liveLecture(id);
  }

  createLecture(input: LectureInput): Lecture {
    const subject = this.courseSubject(input?.subjectId, 'lectures');
    const v = this.lectureInput(input, this.liveSemester(subject.semesterId));
    const t = this.stamp();
    const r = this.run(
      `INSERT INTO lectures (subject_id, title, weekday, start_time, end_time, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      v.subjectId,
      v.title,
      v.weekday,
      v.startTime,
      v.endTime,
      v.startDate,
      v.endDate,
      t,
      t,
    );
    return this.liveLecture(Number(r.lastInsertRowid));
  }

  updateLecture(id: Id, input: LectureInput): Lecture {
    const existing = this.liveLecture(id);
    const newSubject = this.courseSubject(input?.subjectId, 'lectures');
    if (newSubject.semesterId !== this.liveSubject(existing.subjectId).semesterId) {
      throw new UserError('A lecture can only be moved to a subject in the same semester.');
    }
    const v = this.lectureInput(input, this.liveSemester(newSubject.semesterId));
    this.run(
      `UPDATE lectures SET subject_id = ?, title = ?, weekday = ?, start_time = ?, end_time = ?, start_date = ?, end_date = ?, updated_at = ?
       WHERE id = ?`,
      v.subjectId,
      v.title,
      v.weekday,
      v.startTime,
      v.endTime,
      v.startDate,
      v.endDate,
      this.stamp(),
      id,
    );
    return this.liveLecture(id);
  }

  private semesterOfSubject(subjectId: Id): Semester {
    return this.liveSemester(this.liveSubject(subjectId).semesterId);
  }

  /** Whether the lecture takes place on `date`: its weekday, within its dates (and the semester's), not during a break. */
  private takesPlace(lecture: Lecture, sem: Semester, breaks: SemesterBreak[], date: ISODate): boolean {
    const { from, to } = this.lectureRange(lecture, sem);
    return weekday(date) === lecture.weekday && date >= from && date <= to && !breakOn(breaks, date);
  }

  /** Mondays of weeks in which this lecture has an occurrence. */
  private lectureWeeks(lecture: Lecture, sem: Semester): ISODate[] {
    const breaks = this.listBreaks(sem.id);
    return weeksBetween(sem.startDate, sem.endDate).filter((w) => this.takesPlace(lecture, sem, breaks, dateInWeek(w, lecture.weekday)));
  }

  setLectureCompleted(lectureId: Id, weekStart: ISODate, completed: boolean): void {
    this.tx(() => {
      const lecture = this.liveLecture(lectureId);
      const ws = this.monday(weekStart);
      const sem = this.semesterOfSubject(lecture.subjectId);
      const d = dateInWeek(ws, lecture.weekday);
      const off = breakOn(this.listBreaks(sem.id), d);
      if (off) throw new UserError(`This lecture doesn't take place during ${breakTitle(off)}.`);
      if (!this.takesPlace(lecture, sem, [], d)) throw new UserError('This lecture does not take place in that week.');
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

  /** Occurrences of live lectures of a semester: within each lecture's dates (and the semester's), outside breaks. */
  protected lectureOccurrences(sem: Semester, from: ISODate, to: ISODate): LectureOccurrence[] {
    const lectures = this.all<any>(
      `SELECT x.* FROM lectures x ${SUBJECT_JOIN} WHERE s.semester_id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`,
      sem.id,
    ).map(this.mapLecture);
    if (lectures.length === 0) return [];
    const lo = from > sem.startDate ? from : sem.startDate;
    const hi = to < sem.endDate ? to : sem.endDate;
    if (lo > hi) return [];
    const breaks = this.breaksBetween(sem.id, lo, hi);
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
        if (date < lo || date > hi || !this.takesPlace(l, sem, breaks, date)) continue;
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
}
