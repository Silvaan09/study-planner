import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useUi } from '../../ui';
import { addDays, type ISODate } from '../../../shared/dates';
import type { WeekData } from '../../../shared/types';

/** Loaded weeks kept for swiping back and forth. */
const WEEK_CACHE = 12;

/**
 * The week `weekStart` and its neighbours, loaded together and kept per week (reloaded whenever data changes), so the
 * weeks beside the current one can be shown while swiping and a week swiped to is there at once.
 */
export function useWeekData(semesterId: number, weekStart: ISODate): ReadonlyMap<ISODate, WeekData> {
  const { dataVersion } = useUi();
  const [store, setStore] = useState<{ semesterId: number; weeks: Map<ISODate, WeekData> }>({ semesterId, weeks: new Map() });
  useEffect(() => {
    let cancelled = false;
    const wanted = [addDays(weekStart, -7), weekStart, addDays(weekStart, 7)];
    // All three at once, and only weeks whose data changed are replaced: every update re-renders the timetable, and a
    // replaced week is rebuilt, which would make the next swipe stutter.
    Promise.all(wanted.map((w) => api.getWeek(semesterId, w))).then(
      (loaded) => {
        if (cancelled) return;
        setStore((st) => {
          const old = st.semesterId === semesterId ? st.weeks : new Map<ISODate, WeekData>();
          const changed = loaded.filter((week) => JSON.stringify(old.get(week.weekStart)) !== JSON.stringify(week));
          if (changed.length === 0 && st.semesterId === semesterId) return st;
          const weeks = new Map(old);
          for (const week of changed) {
            weeks.delete(week.weekStart);
            weeks.set(week.weekStart, week);
          }
          while (weeks.size > WEEK_CACHE) weeks.delete(weeks.keys().next().value!);
          return { semesterId, weeks };
        });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [semesterId, weekStart, dataVersion]);
  return store.semesterId === semesterId ? store.weeks : new Map();
}
