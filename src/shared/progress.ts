import { addDays, startOfWeek, type ISODate } from './dates';
import type { ExerciseStatus, WeekData, WeekProgress } from './types';

export type { WeekProgress };

export type CelebrationKind = 'lectures' | 'exercises' | 'everything';

export function weekProgress(week: WeekData): WeekProgress {
  const weekEnd = addDays(week.weekStart, 6);
  const planned = week.exercises.filter((e) => e.plannedDates.some((p) => p >= week.weekStart && p <= weekEnd));
  return {
    lectures: week.lectures.length,
    lecturesDone: week.lectures.filter((l) => l.completed).length,
    exercises: planned.length,
    exercisesDone: planned.filter((e) => e.status === 'completed').length,
    exercisesInProgress: planned.filter((e) => e.status === 'in_progress').length,
  };
}

/**
 * Overall state of a week: completed when everything in it is done, in progress once anything is done
 * or an exercise has been started, otherwise not started. Null for a week with nothing in it.
 */
export function weekStatus(p: WeekProgress): ExerciseStatus | null {
  if (p.lectures + p.exercises === 0) return null;
  if (p.lecturesDone === p.lectures && p.exercisesDone === p.exercises) return 'completed';
  return p.lecturesDone + p.exercisesDone + p.exercisesInProgress > 0 ? 'in_progress' : 'not_started';
}

const allDone = (total: number, done: number) => total > 0 && done === total;

/**
 * The celebration a change from `before` to `after` earns, or null.
 * Only a category that just became complete counts. When nothing else in the week is left
 * (the other category is complete or empty), the whole week is celebrated instead.
 */
export function celebrationFor(before: WeekProgress, after: WeekProgress): CelebrationKind | null {
  const lecturesNow = allDone(after.lectures, after.lecturesDone);
  const exercisesNow = allDone(after.exercises, after.exercisesDone);
  const lectures = lecturesNow && !allDone(before.lectures, before.lecturesDone);
  const exercises = exercisesNow && !allDone(before.exercises, before.exercisesDone);
  if (!lectures && !exercises) return null;
  const weekDone = (lecturesNow || after.lectures === 0) && (exercisesNow || after.exercises === 0);
  if (weekDone) return 'everything';
  return lectures ? 'lectures' : 'exercises';
}

const RANK: Record<CelebrationKind, number> = { lectures: 1, exercises: 1, everything: 2 };

/** The bigger of two celebrations (e.g. when one change completes several weeks). */
export function biggerCelebration(a: CelebrationKind | null, b: CelebrationKind | null): CelebrationKind | null {
  if (!a) return b;
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
}

/** Weeks whose exercise count includes this exercise (the weeks of its planned dates). */
export function exerciseWeeks(plannedDates: ISODate[]): ISODate[] {
  return [...new Set(plannedDates.map(startOfWeek))];
}
