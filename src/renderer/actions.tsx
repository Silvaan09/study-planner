import { api } from './api';
import { Confirm, ScopeChooser, useUi } from './ui';
import { dateInWeek, formatDate, startOfWeek, type ISODate } from '../shared/dates';
import { sessionStatus, type DeleteResult, type Exam, type Exercise, type ExerciseStage, type ExerciseStatus, type Id, type Lecture, type Semester, type Subject } from '../shared/types';
import { biggerCelebration, celebrationFor, exerciseWeeks, weekProgress, type CelebrationKind } from '../shared/progress';
import { playDing } from './sound';

/**
 * Wraps a completion change: compares the given weeks before and after it and celebrates
 * when all lectures and/or exercises of one of them just became completed. Pass no weeks to skip the check.
 * Passing weeks means something is being checked off, which also plays the ding.
 */
export function useWeekCompletion(semesterId: Id) {
  const ui = useUi();
  return async (weeks: ISODate[], change: () => Promise<unknown>): Promise<void> => {
    const snapshot = () => Promise.all(weeks.map(async (w) => weekProgress(await api.getWeek(semesterId, w))));
    const before = await snapshot();
    await change();
    if (weeks.length === 0) return;
    playDing();
    const after = await snapshot();
    let best: { kind: CelebrationKind; week: ISODate } | null = null;
    for (const [i, week] of weeks.entries()) {
      const kind = celebrationFor(before[i], after[i]);
      if (kind && biggerCelebration(best?.kind ?? null, kind) !== best?.kind) best = { kind, week };
    }
    if (best) ui.celebrate(best.kind, best.week);
  };
}

/**
 * Exercise progress, shared by all views. The work belongs to the planned ("To do") days, each session on its own;
 * handing in belongs to the deadline, so finishing the work doesn't tick off the deadline.
 * Both run through useWeekCompletion when something gets checked off.
 */
export function useExerciseProgress(semesterId: Id) {
  const ui = useUi();
  const completing = useWeekCompletion(semesterId);
  const undo = (e: Exercise) => ({
    label: 'Undo',
    run: () => void ui.run(() => (e.handedIn ? api.setExerciseHandedIn(e.id, true) : api.setExerciseStatus(e.id, e.status))),
  });

  const setStatus = (e: Exercise, status: ExerciseStatus, opts: { toast?: boolean } = {}) =>
    ui.run(async () => {
      const done = status === 'completed' && e.status !== 'completed';
      await completing(done ? exerciseWeeks(e.plannedDates) : [], () => api.setExerciseStatus(e.id, status));
      if (done && opts.toast) ui.toast(`"${e.title}" done`, { kind: 'success', action: undo(e) });
    });

  const setHandedIn = (e: Exercise, handedIn: boolean) =>
    ui.run(async () => {
      await completing(handedIn ? exerciseWeeks(e.plannedDates) : [], () => api.setExerciseHandedIn(e.id, handedIn));
      if (handedIn) ui.toast(`"${e.title}" handed in`, { kind: 'success', action: undo(e) });
    });

  /** One session (planned day) only: the planned cards and "To do today". The exercise is done once every session is. */
  const setSession = (e: Exercise, date: ISODate, status: ExerciseStatus, opts: { toast?: boolean } = {}) =>
    ui.run(async () => {
      const before = sessionStatus(e, date);
      const done = status === 'completed' && before !== 'completed';
      let after: Exercise | undefined;
      await completing(done ? [startOfWeek(date)] : [], async () => {
        after = await api.setSessionStatus(e.id, date, status);
      });
      if (done && opts.toast) {
        const n = e.plannedDates.length;
        const what = n > 1 && after?.status !== 'completed' ? `Session ${e.plannedDates.indexOf(date) + 1} of ${n} of "${e.title}"` : `"${e.title}"`;
        ui.toast(`${what} done`, {
          kind: 'success',
          action: { label: 'Undo', run: () => void ui.run(() => api.setSessionStatus(e.id, date, before)) },
        });
      }
    });

  /** For pickers that offer all four stages. */
  const setStage = (e: Exercise, stage: ExerciseStage, opts: { toast?: boolean } = {}) =>
    stage === 'handed_in'
      ? setHandedIn(e, true)
      : e.handedIn && stage === 'completed'
        ? setHandedIn(e, false)
        : setStatus(e, stage, opts);

  /** Finishes it off for good: hands it in, or (without a deadline, nothing to hand in) marks it done. */
  const settle = (e: Exercise) => (e.deadlineDate ? setHandedIn(e, true) : setStatus(e, 'completed', { toast: true }));

  return { setStatus, setSession, setHandedIn, setStage, settle };
}

/** Ticks a checklist step. Ticking the last one finishes the exercise (the service does that): ding and toast with Undo. */
export function useChecklistToggle() {
  const ui = useUi();
  return (itemId: Id, done: boolean) =>
    ui.run(async () => {
      const e = await api.setChecklistItemDone(itemId, done);
      if (done && e.status === 'completed' && e.checklist.every((c) => c.done)) {
        playDing();
        const ready = e.deadlineDate && !e.handedIn ? ' · ready to hand in' : '';
        ui.toast(`"${e.title}" done: every step is ticked off${ready}`, {
          kind: 'success',
          action: { label: 'Undo', run: () => void ui.run(() => api.setChecklistItemDone(itemId, false)) },
        });
      }
      return e;
    });
}

/** Delete flows shared by all views. Everything goes to the trash and can be undone. */
export function useActions() {
  const ui = useUi();

  const moved = (res: DeleteResult | undefined) => {
    if (!res) return false;
    ui.toast(`${res.label} moved to trash`, {
      action: { label: 'Undo', run: () => void ui.run(() => api.restoreTrash(res.trashId)) },
    });
    return true;
  };

  return {
    async deleteSemester(s: Semester): Promise<boolean> {
      const ok = await ui.dialog<boolean>((close) => (
        <Confirm
          title="Delete semester?"
          message={
            <>
              <strong>{s.name}</strong> and all its subjects, lectures and exercises will be moved to the trash. You can restore it from there.
            </>
          }
          confirmLabel="Move to trash"
          danger
          close={close}
        />
      ));
      return ok ? moved(await ui.run(() => api.deleteSemester(s.id))) : false;
    },

    async deleteSubject(s: Subject): Promise<boolean> {
      const ok = await ui.dialog<boolean>((close) => (
        <Confirm
          title="Delete subject?"
          message={
            <>
              <strong>{s.name}</strong> with its lectures and exercises will be moved to the trash. You can restore it from there.
            </>
          }
          confirmLabel="Move to trash"
          danger
          close={close}
        />
      ));
      return ok ? moved(await ui.run(() => api.deleteSubject(s.id))) : false;
    },

    /** Without a week, the whole recurring lecture is deleted. */
    async deleteLecture(l: Lecture, weekStart?: ISODate): Promise<boolean> {
      if (!weekStart) {
        const ok = await ui.dialog<boolean>((close) => (
          <Confirm
            title="Delete lecture?"
            message={
              <>
                <strong>{l.title}</strong> will be removed from every week and moved to the trash.
              </>
            }
            confirmLabel="Move to trash"
            danger
            close={close}
          />
        ));
        return ok ? moved(await ui.run(() => api.deleteLecture(l.id, 'all', ''))) : false;
      }
      const day = formatDate(dateInWeek(weekStart, l.weekday), { weekday: true });
      const scope = await ui.dialog<'this' | 'future' | 'all'>((close) => (
        <ScopeChooser
          title={`Delete "${l.title}"`}
          action="Move to trash"
          danger
          close={close}
          options={[
            { value: 'this', label: 'Only this week', hint: `Removes the lecture on ${day}` },
            { value: 'future', label: 'This and following weeks', hint: `From ${day} until the end of the semester` },
            { value: 'all', label: 'All weeks', hint: 'Removes the recurring lecture entirely' },
          ]}
        />
      ));
      return scope ? moved(await ui.run(() => api.deleteLecture(l.id, scope, weekStart))) : false;
    },

    async deleteExercise(e: Exercise): Promise<boolean> {
      if (e.seriesId === null) return moved(await ui.run(() => api.deleteExercise(e.id, 'this')));
      const scope = await ui.dialog<'this' | 'future' | 'all'>((close) => (
        <ScopeChooser
          title={`Delete "${e.title}"`}
          action="Move to trash"
          danger
          close={close}
          options={[
            { value: 'this', label: 'Only this exercise', hint: 'Other occurrences are not affected' },
            { value: 'future', label: 'This and following', hint: `${e.title} and all later occurrences` },
            { value: 'all', label: 'Whole series', hint: 'Every occurrence, past and future' },
          ]}
        />
      ));
      return scope ? moved(await ui.run(() => api.deleteExercise(e.id, scope))) : false;
    },

    async deleteExam(e: Exam): Promise<boolean> {
      return moved(await ui.run(() => api.deleteExam(e.id)));
    },
  };
}
