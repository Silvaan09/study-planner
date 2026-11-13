import { addDays, startOfWeek, weeksBetween, type ISODate } from '../../shared/dates';
import { computeStreak, weekProgress, type DayTally } from '../../shared/progress';
import {
  breakTitle,
  exerciseDueBy,
  exerciseFirstDay,
  exerciseSettled,
  type Id,
  type LectureOccurrence,
  type Outstanding,
  type OutstandingItem,
  type Semester,
  type SemesterWeekProgress,
  type StudyPeriod,
  type SubjectOverview,
  type TodayData,
  type WeekData,
} from '../../shared/types';
import { EXERCISE_FROM, LIVE_EXERCISE, LIVE_SUBJECT, SUBJECT_JOIN } from './base';
import { ExerciseUpdateService } from './exerciseUpdates';

/** Read models for the views: subject overview, week, semester progress, Outstanding, Today. */
export class ViewService extends ExerciseUpdateService {
  // ------------------------------------------------------------------ views

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
           ORDER BY COALESCE(x.deadline_date, x.planned_date), x.planned_date, x.sequence_number, x.title COLLATE NOCASE`,
          subject.id,
        ),
      );
      const exams = this.exams(semesterId, { subjectId: subject.id });
      return { subject, lectures, series, exercises, exerciseCount: exercises.length, exams };
    });
  }

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
         ORDER BY COALESCE(x.deadline_date, x.planned_date), x.title`,
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
      breaks: this.breaksBetween(sem.id, ws, we),
      studyPeriod: this.studyPeriod(sem),
    };
  }

  /**
   * The exam study period: from the Monday after the semester's last week until the last exam, so study weeks never
   * overlap semester weeks. Follows the semester's dates and the exams; null when no exam comes after the semester.
   */
  protected studyPeriod(sem: Semester): StudyPeriod | null {
    const last = this.exams(sem.id).pop();
    if (!last) return null;
    const startDate = addDays(startOfWeek(sem.endDate), 7);
    return last.date >= startDate ? { startDate, endDate: last.date } : null;
  }

  getSemesterProgress(semesterId: Id): SemesterWeekProgress[] {
    const sem = this.liveSemester(semesterId);
    const period = this.studyPeriod(sem);
    const end = period && period.endDate > sem.endDate ? period.endDate : sem.endDate;
    return weeksBetween(sem.startDate, end).map((w) => {
      const week = this.getWeek(semesterId, w);
      const study = period !== null && period.startDate <= addDays(w, 6) && w <= period.endDate;
      return { weekStart: w, ...weekProgress(week), breaks: week.breaks.map(breakTitle), study };
    });
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
    ).filter((e) => !exerciseSettled(e));
    for (const e of exercises) items.push({ kind: 'exercise', date: exerciseFirstDay(e), exercise: e, overdue: exerciseDueBy(e) < t });
    const key = (i: OutstandingItem) =>
      i.kind === 'lecture' ? `${i.date}|0|${i.occurrence.startTime}|${i.occurrence.title}` : `${i.date}|1|${exerciseDueBy(i.exercise)}|${i.exercise.title}`;
    items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return { subjects: this.listSubjects(sem.id), items };
  }

  getToday(semesterId: Id, today: ISODate): TodayData {
    const sem = this.liveSemester(semesterId);
    const t = this.date(today, 'Today');
    const weekAhead = addDays(t, 7);
    const lectures = this.lectureOccurrences(sem, sem.startDate, weekAhead);
    const exercises = this.toExercises(
      this.all(`SELECT x.* FROM ${EXERCISE_FROM} WHERE s.semester_id = ? AND ${LIVE_EXERCISE} ORDER BY COALESCE(x.deadline_date, x.planned_date), x.title`, sem.id),
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
    for (const e of exercises) for (const s of e.sessions) if (s.date >= sem.startDate && s.date <= t) tally(s.date, s.status === 'completed');

    const byTime = (a: LectureOccurrence, b: LectureOccurrence) =>
      a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.title.localeCompare(b.title);
    const open = exercises.filter((e) => !exerciseSettled(e));
    return {
      today: t,
      subjects: this.listSubjects(sem.id),
      lectures: lectures.filter((o) => o.date === t).sort(byTime),
      upcomingLectures: lectures.filter((o) => o.date > t).sort(byTime),
      planned: exercises.filter((e) => e.plannedDates.includes(t)),
      dueSoon: open.filter((e) => e.deadlineDate !== null && e.deadlineDate >= t && e.deadlineDate <= weekAhead),
      overdue: open.filter((e) => exerciseDueBy(e) < t).sort((a, b) => exerciseDueBy(a).localeCompare(exerciseDueBy(b))),
      missedLectures: lectures.filter((o) => o.date < t && !o.completed).sort(byTime),
      exams: this.exams(sem.id, { from: t }),
      todayBreak: this.breaksBetween(sem.id, t, t)[0] ?? null,
      studyPeriod: this.studyPeriod(sem),
      streak: computeStreak(tallies, sem.startDate, t),
    };
  }
}
