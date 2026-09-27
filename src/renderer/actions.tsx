import { api } from './api';
import { Confirm, ScopeChooser, useUi } from './ui';
import { dateInWeek, formatDate, type ISODate } from '../shared/dates';
import type { DeleteResult, Exercise, Lecture, Semester, Subject } from '../shared/types';

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
  };
}
