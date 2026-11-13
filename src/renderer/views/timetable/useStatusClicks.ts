import { useEffect, useRef, useState } from 'react';
import type { useExerciseProgress } from '../../actions';
import type { ISODate } from '../../../shared/dates';
import { sessionStatus, type Exercise, type ExerciseStatus, type WeekData } from '../../../shared/types';

const NEXT_STATUS: Record<ExerciseStatus, ExerciseStatus> = { not_started: 'in_progress', in_progress: 'completed', completed: 'not_started' };

/**
 * Status circle on a planned card: the work of that session only; handing in is the deadline card's flag.
 * Clicking a planned card's circle shows the next status at once and saves in order, so quick repeated clicks
 * (e.g. a double click: not started → in progress → done) build on each other instead of each starting from the
 * status loaded before the first click was saved. An entry is dropped once the loaded data shows it.
 */
export function useStatusClicks(progress: ReturnType<typeof useExerciseProgress>, byWeek: ReadonlyMap<ISODate, WeekData>) {
  const [clicked, setClicked] = useState<ReadonlyMap<string, { status: ExerciseStatus; saved: boolean }>>(new Map());
  const saves = useRef<Promise<unknown>>(Promise.resolve());
  const cardStatus = (e: Exercise, day: ISODate) => clicked.get(`${e.id}:${day}`)?.status ?? sessionStatus(e, day);
  const updateClicked = (key: string, fn: (entry: { status: ExerciseStatus; saved: boolean } | undefined) => { status: ExerciseStatus; saved: boolean } | undefined) =>
    setClicked((m) => {
      const entry = fn(m.get(key));
      if (entry === m.get(key)) return m;
      const next = new Map(m);
      if (entry) next.set(key, entry);
      else next.delete(key);
      return next;
    });
  const cycleStatus = (e: Exercise, day: ISODate) => {
    const key = `${e.id}:${day}`;
    const current = cardStatus(e, day);
    const status = NEXT_STATUS[current];
    const entry = { status, saved: false };
    updateClicked(key, () => entry);
    // The exercise as it will be when this save runs, so "just completed" (ding, celebration) is judged correctly.
    const shown = { ...e, sessions: e.sessions.map((s) => (s.date === day ? { ...s, status: current } : s)) };
    saves.current = saves.current.then(() => progress.setSession(shown, day, status));
    void saves.current.then(() => {
      updateClicked(key, (x) => (x === entry ? { status, saved: true } : x));
      // Fallback if the save failed (the data then never shows it): back to what's loaded.
      setTimeout(() => updateClicked(key, (x) => (x?.status === status && x.saved ? undefined : x)), 1500);
    });
  };
  useEffect(() => {
    if (clicked.size === 0) return;
    const exercises = [...byWeek.values()].flatMap((w) => w.exercises);
    for (const [key, entry] of clicked) {
      if (!entry.saved) continue;
      const [id, day] = key.split(':');
      const e = exercises.find((x) => x.id === Number(id) && x.plannedDates.includes(day));
      if (!e || sessionStatus(e, day) === entry.status) updateClicked(key, (x) => (x?.saved ? undefined : x));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byWeek, clicked]);
  return { cardStatus, cycleStatus };
}
