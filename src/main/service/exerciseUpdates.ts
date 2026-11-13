import { addDays, diffDays, type ISODate } from '../../shared/dates';
import {
  sessionStatus,
  type ChecklistItemInput,
  type Exercise,
  type ExerciseChanges,
  type ExerciseSeries,
  type ExerciseStatus,
  type ExerciseUpdateInput,
  type ExerciseUpdateResult,
  type Id,
  type OverridableField,
  type OverrideConflict,
  type Scope,
} from '../../shared/types';
import { MAX_DESCRIPTION, UserError } from './base';
import { ExerciseService } from './exercises';
import { alignSessions, applyProgress, changedFields, checklistSteps, promoted, seriesTitle, statusAfterSession, statusAfterStep, withStatus } from './status';

/** Changing exercises: editor and series edits, status, sessions, checklist steps, moving a planned day. */
export class ExerciseUpdateService extends ExerciseService {
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
      const d = this.deadlineInput(changes.deadlineDate);
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
        updated.sessions = alignSessions(e.sessions, updated.plannedDates, e.status === 'completed');
        applyProgress(updated, c, checklist ?? e.checklist);
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
      // A moved deadline shifts each occurrence's by as many days; adding one (or one to an occurrence without)
      // puts it at the same position relative to the occurrence as on this exercise.
      const newDeadline = (t: Exercise): ISODate | null => {
        if (!c.deadlineDate) return null;
        if (e.deadlineDate && t.deadlineDate) return addDays(t.deadlineDate, diffDays(e.deadlineDate, c.deadlineDate));
        return addDays(c.deadlineDate, step * (t.sequenceNumber! - e.sequenceNumber!));
      };
      const invalid: string[] = [];
      const undated: string[] = [];
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
        if (apply.includes('plannedDate')) {
          u.plannedDates = c.plannedDates!.map((d) => addDays(d, step * (t.sequenceNumber! - e.sequenceNumber!)));
          u.sessions = alignSessions(t.sessions, u.plannedDates, t.status === 'completed');
        }
        if (apply.includes('deadlineDate')) u.deadlineDate = newDeadline(t);
        // Checklist: this exercise gets it as edited (with its done states); the others get the same steps,
        // keeping the done state of steps they already had.
        if (t.id === e.id && checklist) checklistWrites.set(t.id, checklist);
        else if (apply.includes('checklist')) {
          const done = new Set(t.checklist.filter((i) => i.done).map((i) => i.text));
          checklistWrites.set(t.id, checklist!.map((i) => ({ text: i.text, done: done.has(i.text) })));
        }
        // Status: this exercise as edited; the others only move up to what their sessions and steps now show.
        const steps = checklistWrites.get(t.id) ?? t.checklist;
        if (t.id === e.id) {
          if (c.handedIn !== undefined) u.handedIn = c.handedIn;
          applyProgress(u, c, steps);
        } else u.status = promoted(u.status, u.sessions, steps);
        if (u.deadlineDate !== null && u.plannedDates[u.plannedDates.length - 1] > u.deadlineDate) invalid.push(u.title);
        if (u.plannedDates.length === 0 && u.deadlineDate === null) undated.push(u.title);
        updates.push(u);
      }
      if (undated.length > 0) {
        throw new UserError(
          `This change would leave ${undated.slice(0, 5).join(', ')}${undated.length > 5 ? ` and ${undated.length - 5} more` : ''} ` +
            'without a planned day or a deadline. Nothing was changed.',
        );
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
    this.tx(() => {
      const e = this.liveExercise(id);
      const s = this.status(status);
      // Done stays handed in; anything else clears it (writeExercise).
      this.writeExercise({ ...e, status: s, sessions: withStatus(e.sessions, s) });
    });
  }

  setExerciseHandedIn(id: Id, handedIn: boolean): void {
    this.tx(() => {
      const e = this.liveExercise(id);
      const h = this.handedIn(handedIn);
      if (h && e.deadlineDate === null) throw new UserError(`"${e.title}" has no deadline, so there is nothing to hand in.`);
      this.writeExercise(h ? { ...e, handedIn: true, status: 'completed', sessions: withStatus(e.sessions, 'completed') } : { ...e, handedIn: false });
    });
  }

  setSessionStatus(id: Id, date: ISODate, status: ExerciseStatus): Exercise {
    return this.tx(() => {
      const e = this.liveExercise(id);
      const d = this.date(date, 'Planned date');
      const s = this.status(status);
      if (!e.plannedDates.includes(d)) throw new UserError('This planned day no longer exists; the exercise was changed in the meantime.');
      const sessions = e.sessions.map((x) => (x.date === d ? { ...x, status: s } : x));
      this.writeExercise({ ...e, sessions, status: statusAfterSession(e, sessions, s) });
      return this.liveExercise(id);
    });
  }

  setChecklistItemDone(itemId: Id, done: boolean): Exercise {
    return this.tx(() => {
      const item = this.get<{ exercise_id: Id }>('SELECT exercise_id FROM exercise_checklist_items WHERE id = ?', itemId);
      if (!item) throw new UserError('This checklist step no longer exists; the exercise was changed in the meantime.');
      const e = this.liveExercise(item.exercise_id);
      this.run('UPDATE exercise_checklist_items SET done = ? WHERE id = ?', done ? 1 : 0, itemId);
      // The status follows: done once every step is (or every session), in progress once one is.
      const checklist = e.checklist.map((c) => (c.id === itemId ? { ...c, done } : c));
      const status = statusAfterStep(e, checklist);
      if (status !== e.status) this.writeExercise({ ...e, status });
      return this.liveExercise(e.id);
    });
  }

  /**
   * Moves one planned date with its progress. If the exercise is already planned on `toDate`, the two sessions merge
   * (into in progress when only one of them was done or started).
   */
  moveExercise(id: Id, fromDate: ISODate, toDate: ISODate): Exercise {
    return this.tx(() => {
      const e = this.liveExercise(id);
      const from = this.date(fromDate, 'Planned date');
      const to = this.date(toDate, 'Planned date');
      if (!e.plannedDates.includes(from)) throw new UserError('This planned date no longer exists; the exercise was changed in the meantime.');
      if (from === to) return e;
      this.checkPlanned([to], e.deadlineDate, e.title);
      const plannedDates = [...new Set(e.plannedDates.map((d) => (d === from ? to : d)))].sort();
      const moved = sessionStatus(e, from);
      const target = e.sessions.find((s) => s.date === to);
      const status: ExerciseStatus = !target || target.status === moved ? moved : 'in_progress';
      const sessions = plannedDates.map((date) => ({ date, status: date === to ? status : sessionStatus(e, date) }));
      const overrides = e.seriesId !== null ? [...e.overrides, 'plannedDate' as const] : e.overrides;
      this.writeExercise({ ...e, plannedDates, sessions, overrides, status: promoted(e.status, sessions, e.checklist) });
      return this.liveExercise(id);
    });
  }
}
