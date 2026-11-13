// How full a day's square in the activity grid is (pure, see tests/activity.test.ts).
import type { ISODate } from '../shared/dates';
import type { ActivityDay } from '../shared/types';

/** Fill levels above "nothing done"; 4 = everything done. */
export const ACTIVITY_LEVELS = [1, 2, 3, 4] as const;

export interface ActivityCell {
  /** 0 = nothing done … 4 = all done. */
  level: 0 | 1 | 2 | 3 | 4;
  /** A day after today with nothing done yet (drawn as a faint outline). */
  future: boolean;
  done: number;
  total: number;
  label: string;
}

/**
 * Share of the day's lectures and sessions that are done: 1 of 1 is as full as 6 of 6, and a day up to today with
 * nothing planned counts as complete (so a finished semester is all full). Today shows its current share. Later days
 * stay empty outlines until something on them is done early.
 */
export function activityCell(day: ActivityDay, today: ISODate): ActivityCell {
  let done = 0;
  let total = 0;
  for (const s of day.subjects) {
    done += s.done;
    total += s.total;
  }
  const future = day.date > today && done === 0;
  if (future) return { level: 0, future, done, total, label: total ? `${total} planned` : 'Nothing planned' };
  const share = total === 0 ? 1 : done / total;
  const level = share >= 1 ? 4 : share >= 2 / 3 ? 3 : share >= 1 / 3 ? 2 : share > 0 ? 1 : 0;
  const label = total === 0 ? 'Nothing planned' : done === total ? `All ${total} done` : `${done} of ${total} done`;
  return { level, future: false, done, total, label };
}
