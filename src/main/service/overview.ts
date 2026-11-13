import { addDays, type ISODate } from '../../shared/dates';
import type { ActivityDay, Id, SemesterOverview } from '../../shared/types';
import { EXERCISE_FROM, LIVE_EXERCISE } from './base';
import { TrashService } from './trash';

/** The Semesters page: every semester with its subjects, and a semester's day-by-day activity. */
export class OverviewService extends TrashService {
  listSemesterOverview(): SemesterOverview[] {
    return this.listSemesters().map((semester) => ({
      semester,
      studyPeriod: this.studyPeriod(semester),
      subjects: this.listSubjects(semester.id).filter((s) => !s.personal),
    }));
  }

  /**
   * Per day from the semester's start to the end of its study period (or its end): each real subject's lecture
   * occurrences and exercise sessions that day, and how many of them are done. Personal tasks don't count.
   */
  getSemesterActivity(semesterId: Id): ActivityDay[] {
    const sem = this.liveSemester(semesterId);
    const period = this.studyPeriod(sem);
    const end = period && period.endDate > sem.endDate ? period.endDate : sem.endDate;
    const personal = new Set(this.listSubjects(sem.id).filter((s) => s.personal).map((s) => s.id));

    const days = new Map<ISODate, Map<Id, { done: number; total: number }>>();
    const count = (date: ISODate, subjectId: Id, done: boolean) => {
      if (date < sem.startDate || date > end || personal.has(subjectId)) return;
      let day = days.get(date);
      if (!day) days.set(date, (day = new Map()));
      const t = day.get(subjectId) ?? { done: 0, total: 0 };
      t.total++;
      if (done) t.done++;
      day.set(subjectId, t);
    };
    for (const o of this.lectureOccurrences(sem, sem.startDate, end)) count(o.date, o.subjectId, o.completed);
    const exercises = this.toExercises(
      this.all(`SELECT x.* FROM ${EXERCISE_FROM} WHERE s.semester_id = ? AND s.personal = 0 AND ${LIVE_EXERCISE}`, sem.id),
    );
    for (const e of exercises) for (const s of e.sessions) count(s.date, e.subjectId, s.status === 'completed');

    const result: ActivityDay[] = [];
    for (let d = sem.startDate; d <= end; d = addDays(d, 1)) {
      const day = days.get(d);
      result.push({ date: d, subjects: day ? [...day].map(([subjectId, t]) => ({ subjectId, ...t })) : [] });
    }
    return result;
  }
}
