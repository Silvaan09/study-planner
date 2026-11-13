import { addDays, formatDate, type ISODate } from '../../shared/dates';
import {
  EXERCISE_STATUSES,
  type ChecklistItem,
  type ChecklistItemInput,
  type DeleteResult,
  type Exercise,
  type ExerciseCreateInput,
  type ExerciseSeries,
  type ExerciseSession,
  type ExerciseStatus,
  type Id,
  type Scope,
} from '../../shared/types';
import { EXERCISE_FROM, LIVE_EXERCISE, LIVE_SUBJECT, MAX_CHECKLIST, MAX_DESCRIPTION, SUBJECT_JOIN, UserError } from './base';
import { ExamService } from './exams';
import { alignSessions, promoted, seriesTitle, singleFollows, withStatus } from './status';

/** Exercises and series: reading, creating, extending, writing and deleting them. */
export class ExerciseService extends ExamService {
  // --------------------------------------------------------------- exercises

  /** Maps exercise rows and attaches each exercise's sessions and checklist (queries per 500 rows). */
  protected toExercises(rows: any[]): Exercise[] {
    const sessions = new Map<Id, ExerciseSession[]>();
    const checklists = new Map<Id, ChecklistItem[]>();
    const ids = rows.map((r) => r.id as Id);
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const marks = chunk.map(() => '?').join(',');
      for (const d of this.all<{ exercise_id: Id; date: ISODate; status: ExerciseStatus }>(
        `SELECT exercise_id, date, status FROM exercise_plan_dates WHERE exercise_id IN (${marks}) ORDER BY date`,
        ...chunk,
      )) {
        if (!sessions.has(d.exercise_id)) sessions.set(d.exercise_id, []);
        sessions.get(d.exercise_id)!.push({ date: d.date, status: d.status });
      }
      for (const c of this.all<{ id: Id; exercise_id: Id; text: string; done: number }>(
        `SELECT id, exercise_id, text, done FROM exercise_checklist_items WHERE exercise_id IN (${marks}) ORDER BY position, id`,
        ...chunk,
      )) {
        if (!checklists.has(c.exercise_id)) checklists.set(c.exercise_id, []);
        checklists.get(c.exercise_id)!.push({ id: c.id, text: c.text, done: !!c.done });
      }
    }
    return rows.map((r) => {
      const own = sessions.get(r.id) ?? [];
      const plannedDates = own.map((x) => x.date);
      return {
        id: r.id,
        subjectId: r.subject_id,
        seriesId: r.series_id ?? null,
        sequenceNumber: r.sequence_number ?? null,
        title: r.title,
        description: r.description,
        plannedDate: plannedDates[0] ?? null,
        plannedDates,
        sessions: own,
        deadlineDate: r.deadline_date ?? null,
        status: r.status,
        handedIn: !!r.handed_in,
        checklist: checklists.get(r.id) ?? [],
        overrides: JSON.parse(r.overrides || '[]'),
      };
    });
  }

  protected mapSeries = (r: any): ExerciseSeries => ({
    id: r.id,
    subjectId: r.subject_id,
    baseTitle: r.base_title,
    intervalWeeks: r.interval_weeks,
    nextNumber: r.next_number,
  });

  protected liveExercise(id: Id): Exercise {
    const r = this.get(`SELECT x.* FROM ${EXERCISE_FROM} WHERE x.id = ? AND ${LIVE_EXERCISE}`, id);
    if (!r) throw new UserError('This exercise no longer exists.');
    return this.toExercises([r])[0];
  }

  protected liveSeries(id: Id): ExerciseSeries {
    const r = this.get(`SELECT x.* FROM exercise_series x ${SUBJECT_JOIN} WHERE x.id = ? AND x.deleted_at IS NULL AND ${LIVE_SUBJECT}`, id);
    if (!r) throw new UserError('This exercise series no longer exists.');
    return this.mapSeries(r);
  }

  protected liveSeriesOccurrences(seriesId: Id): Exercise[] {
    return this.toExercises(
      this.all(`SELECT x.* FROM ${EXERCISE_FROM} WHERE x.series_id = ? AND ${LIVE_EXERCISE} ORDER BY x.sequence_number`, seriesId),
    );
  }

  getExercise(id: Id): Exercise {
    return this.liveExercise(id);
  }

  getSeries(id: Id): ExerciseSeries {
    return this.liveSeries(id);
  }

  protected status(value: unknown): ExerciseStatus {
    if (!EXERCISE_STATUSES.includes(value as ExerciseStatus)) throw new UserError('Unknown exercise status.');
    return value as ExerciseStatus;
  }

  protected handedIn(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new UserError('Unknown hand-in state.');
    return value;
  }

  private saveSessions(exerciseId: Id, sessions: ExerciseSession[]): void {
    this.run('DELETE FROM exercise_plan_dates WHERE exercise_id = ?', exerciseId);
    for (const s of sessions) this.run('INSERT INTO exercise_plan_dates (exercise_id, date, status) VALUES (?, ?, ?)', exerciseId, s.date, s.status);
  }


  /** Validates a checklist: every step needs text. */
  protected checklistInput(value: unknown): ChecklistItemInput[] {
    if (!Array.isArray(value)) throw new UserError('The checklist is invalid.');
    if (value.length > MAX_CHECKLIST) throw new UserError(`A checklist can have at most ${MAX_CHECKLIST} steps.`);
    return value.map((item) => ({ text: this.text(item?.text, 'Checklist step'), done: item?.done === true }));
  }

  protected saveChecklist(exerciseId: Id, items: ChecklistItemInput[]): void {
    this.run('DELETE FROM exercise_checklist_items WHERE exercise_id = ?', exerciseId);
    items.forEach((item, i) =>
      this.run('INSERT INTO exercise_checklist_items (exercise_id, position, text, done) VALUES (?, ?, ?, ?)', exerciseId, i, item.text, item.done ? 1 : 0),
    );
  }

  /** Inserts an exercise; done ticks off every session, otherwise they start not started; all steps ticked = done. */
  private insertExercise(e: Omit<Exercise, 'id' | 'overrides' | 'plannedDate' | 'sessions' | 'checklist'> & { checklist: ChecklistItemInput[] }): Id {
    const dates = [...new Set(e.plannedDates)].sort();
    const fresh = dates.map((date) => ({ date, status: 'not_started' as const }));
    const status = promoted(e.status, fresh, e.checklist);
    const sessions = singleFollows(withStatus(fresh, status === 'completed' ? 'completed' : 'not_started'), status);
    const t = this.stamp();
    const r = this.run(
      `INSERT INTO exercises (subject_id, series_id, sequence_number, title, description, planned_date, deadline_date, status, handed_in, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.subjectId,
      e.seriesId,
      e.sequenceNumber,
      e.title,
      e.description,
      dates[0] ?? null,
      e.deadlineDate,
      status,
      e.handedIn && e.deadlineDate !== null ? 1 : 0,
      t,
      t,
    );
    const id = Number(r.lastInsertRowid);
    this.saveSessions(id, sessions);
    this.saveChecklist(id, e.checklist);
    return id;
  }

  createExercise(input: ExerciseCreateInput): Exercise[] {
    return this.tx(() => {
      this.liveSubject(input?.subjectId);
      const title = this.text(input.title, 'Exercise title');
      const description = this.text(input.description ?? '', 'Description', { max: MAX_DESCRIPTION, allowEmpty: true });
      const planned = this.plannedDatesInput(input.plannedDates);
      const deadline = this.deadlineInput(input.deadlineDate);
      this.checkPlanned(planned, deadline);
      const handedIn = this.handedIn(input.handedIn ?? false) && deadline !== null;
      const status = handedIn ? 'completed' : this.status(input.status ?? 'not_started');
      const checklist = this.checklistInput(input.checklist ?? []);

      if (!input.recurrence) {
        const id = this.insertExercise({
          subjectId: input.subjectId,
          seriesId: null,
          sequenceNumber: null,
          title,
          description,
          plannedDates: planned,
          deadlineDate: deadline,
          status,
          handedIn,
          checklist,
        });
        return [this.liveExercise(id)];
      }

      const interval = this.int(input.recurrence.intervalWeeks, 'Repeat interval (weeks)', 1, 52);
      const count = this.int(input.recurrence.count, 'Number of occurrences', 1, 200);
      const first = this.int(input.recurrence.firstNumber, 'First number', 0, 9999);
      const t = this.stamp();
      const seriesId = Number(
        this.run(
          'INSERT INTO exercise_series (subject_id, base_title, interval_weeks, next_number, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          input.subjectId,
          title,
          interval,
          first + count,
          t,
          t,
        ).lastInsertRowid,
      );
      const ids: Id[] = [];
      for (let i = 0; i < count; i++) {
        ids.push(
          this.insertExercise({
            subjectId: input.subjectId,
            seriesId,
            sequenceNumber: first + i,
            title: seriesTitle(title, first + i),
            description,
            // The planned-date pattern repeats in every occurrence.
            plannedDates: planned.map((d) => addDays(d, 7 * interval * i)),
            deadlineDate: deadline && addDays(deadline, 7 * interval * i),
            status: i === 0 ? status : 'not_started',
            handedIn: i === 0 && handedIn,
            checklist: i === 0 ? checklist : checklist.map((c) => ({ text: c.text, done: false })),
          }),
        );
      }
      return ids.map((id) => this.liveExercise(id));
    });
  }

  extendSeries(seriesId: Id, count: number): Exercise[] {
    return this.tx(() => {
      const series = this.liveSeries(seriesId);
      const n = this.int(count, 'Number of occurrences', 1, 200);
      // Continue from the latest occurrence still present (live or in the trash).
      const lastRow = this.get<any>('SELECT * FROM exercises WHERE series_id = ? ORDER BY sequence_number DESC LIMIT 1', seriesId);
      if (!lastRow) throw new UserError('This series has no occurrences left to continue from.');
      const last = this.toExercises([lastRow])[0];
      const ids: Id[] = [];
      for (let i = 0; i < n; i++) {
        const num = series.nextNumber + i;
        const shift = 7 * series.intervalWeeks * (num - last.sequenceNumber!);
        ids.push(
          this.insertExercise({
            subjectId: series.subjectId,
            seriesId,
            sequenceNumber: num,
            title: seriesTitle(series.baseTitle, num),
            description: last.description,
            plannedDates: last.plannedDates.map((d) => addDays(d, shift)),
            deadlineDate: last.deadlineDate && addDays(last.deadlineDate, shift),
            status: 'not_started',
            handedIn: false,
            checklist: last.checklist.map((c) => ({ text: c.text, done: false })),
          }),
        );
      }
      this.run('UPDATE exercise_series SET next_number = ?, updated_at = ? WHERE id = ?', series.nextNumber + n, this.stamp(), seriesId);
      return ids.map((id) => this.liveExercise(id));
    });
  }

  /**
   * Writes an exercise. Its sessions follow `plannedDates` (see alignSessions); handedIn is kept only while the
   * status is completed. Callers set the status (shownStatus / promoted / a status set by hand).
   */
  protected writeExercise(e: Exercise): void {
    const dates = [...new Set(e.plannedDates)].sort();
    const sessions = singleFollows(alignSessions(e.sessions, dates, e.status === 'completed'), e.status);
    const status = e.status;
    this.run(
      `UPDATE exercises SET subject_id = ?, title = ?, description = ?, planned_date = ?, deadline_date = ?, status = ?, handed_in = ?, overrides = ?, updated_at = ?
       WHERE id = ?`,
      e.subjectId,
      e.title,
      e.description,
      dates[0] ?? null,
      e.deadlineDate,
      status,
      e.handedIn && status === 'completed' && e.deadlineDate !== null ? 1 : 0,
      JSON.stringify([...new Set(e.overrides)].sort()),
      this.stamp(),
      e.id,
    );
    this.saveSessions(e.id, sessions);
  }

  deleteExercise(id: Id, scope: Scope): DeleteResult {
    return this.tx(() => {
      const e = this.liveExercise(id);
      const t = this.stamp();
      if (e.seriesId === null || scope === 'this') {
        const label = `Exercise "${e.title}"`;
        const when = e.deadlineDate
          ? `Due ${formatDate(e.deadlineDate, { weekday: true, year: true })}`
          : `Planned ${formatDate(e.plannedDates[0], { weekday: true, year: true })}`;
        const batch = this.newTrashBatch('exercise', label, when);
        this.run('UPDATE exercises SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', t, batch, id);
        return { trashId: batch, label };
      }
      const series = this.liveSeries(e.seriesId);
      if (scope === 'all') {
        const n = this.liveSeriesOccurrences(series.id).length;
        const label = `Exercise series "${series.baseTitle}"`;
        const batch = this.newTrashBatch('exercise_series', label, `${n} exercise(s)`);
        this.run('UPDATE exercise_series SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', t, batch, series.id);
        return { trashId: batch, label };
      }
      const targets = this.liveSeriesOccurrences(series.id).filter((x) => x.sequenceNumber! >= e.sequenceNumber!);
      const label = `"${e.title}" and later occurrences`;
      const batch = this.newTrashBatch('exercise_occurrences', label, `${targets.length} exercise(s) of "${series.baseTitle}"`);
      for (const x of targets) this.run('UPDATE exercises SET deleted_at = ?, trash_batch_id = ? WHERE id = ?', t, batch, x.id);
      return { trashId: batch, label };
    });
  }
}
