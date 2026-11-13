import type { ISODate } from '../../shared/dates';
import type { Exercise, ExerciseChanges, ExerciseSession, ExerciseStatus, OverridableField } from '../../shared/types';

/** Override field name for each ExerciseChanges key. */
const CHANGE_FIELDS: [OverridableField, keyof ExerciseChanges][] = [
  ['title', 'title'],
  ['description', 'description'],
  ['plannedDate', 'plannedDates'],
  ['deadlineDate', 'deadlineDate'],
  ['subjectId', 'subjectId'],
];

const STATUS_RANK: Record<ExerciseStatus, number> = { not_started: 0, in_progress: 1, completed: 2 };

/** The work is done: every session is (if it has any), or every step of a non-empty checklist is ticked. */
function workDone(sessions: ExerciseSession[], checklist: { done: boolean }[]): boolean {
  return (sessions.length > 0 && sessions.every((s) => s.status === 'completed')) || (checklist.length > 0 && checklist.every((c) => c.done));
}

/** Any session or step started or done. */
function anyProgress(sessions: ExerciseSession[], checklist: { done: boolean }[]): boolean {
  return sessions.some((s) => s.status !== 'not_started') || checklist.some((c) => c.done);
}

/** The exercise's status as its sessions and steps show it: done (see workDone), in progress, or not started. */
function shownStatus(sessions: ExerciseSession[], checklist: { done: boolean }[]): ExerciseStatus {
  if (workDone(sessions, checklist)) return 'completed';
  return anyProgress(sessions, checklist) ? 'in_progress' : 'not_started';
}

/**
 * The status after one session was set to `status`: done once the last session is; a done exercise stays done while
 * sessions are checked off (e.g. one finished through its checklist); otherwise in progress or not started.
 */
export function statusAfterSession(e: Exercise, sessions: ExerciseSession[], status: ExerciseStatus): ExerciseStatus {
  if (sessions.every((s) => s.status === 'completed')) return 'completed';
  if (e.status === 'completed' && status === 'completed') return 'completed';
  return anyProgress(sessions, e.checklist) ? 'in_progress' : 'not_started';
}

/**
 * The status after a step was (un)ticked: done once the last step is; unticking one reopens an exercise that isn't
 * done through its sessions; otherwise in progress or not started.
 */
export function statusAfterStep(e: Exercise, checklist: { done: boolean }[]): ExerciseStatus {
  if (workDone(e.sessions, checklist)) return 'completed';
  return anyProgress(e.sessions, checklist) ? 'in_progress' : 'not_started';
}

/** After other changes (planned days, steps edited in the editor): the status only moves up to what they show. */
export function promoted(status: ExerciseStatus, sessions: ExerciseSession[], checklist: { done: boolean }[]): ExerciseStatus {
  const shown = shownStatus(sessions, checklist);
  return STATUS_RANK[shown] > STATUS_RANK[status] ? shown : status;
}

/**
 * The sessions after setting the whole exercise's status by hand: done ticks off every session, not started clears
 * them, in progress leaves them as they are (each session is only started when that day's work is).
 */
export function withStatus(sessions: ExerciseSession[], status: ExerciseStatus): ExerciseSession[] {
  return status === 'in_progress' ? sessions : sessions.map((s) => ({ ...s, status }));
}

/** With a single planned day, its session is the exercise: it always has the exercise's status. */
export function singleFollows(sessions: ExerciseSession[], status: ExerciseStatus): ExerciseSession[] {
  return sessions.length === 1 ? [{ ...sessions[0], status }] : sessions;
}

/**
 * Sessions for a new list of planned days. Days that stay keep their progress; new days take over the progress of
 * removed ones in order (so moving a whole pattern, e.g. in a series edit, keeps it); any further new day starts
 * not started, or done if the exercise is done (so adding a day never reopens a finished exercise).
 */
export function alignSessions(sessions: ExerciseSession[], dates: ISODate[], done: boolean): ExerciseSession[] {
  const byDate = new Map(sessions.map((s) => [s.date, s.status]));
  const freed = sessions.filter((s) => !dates.includes(s.date)).map((s) => s.status);
  const extra: ExerciseStatus = done ? 'completed' : 'not_started';
  return dates.map((date) => ({ date, status: byDate.get(date) ?? freed.shift() ?? extra }));
}

/**
 * Applies an editor change to the status and keeps "handed in implies completed": a newly set handedIn wins, then a
 * status set by hand; otherwise the status moves up to what the (re-planned) sessions and steps show.
 */
export function applyProgress(u: Exercise, c: ExerciseChanges, checklist: { done: boolean }[]): void {
  if (c.handedIn) u.status = 'completed';
  else if (c.status !== undefined) u.status = c.status;
  else u.status = promoted(u.status, u.sessions, checklist);
  if (c.handedIn || c.status !== undefined) u.sessions = withStatus(u.sessions, u.status);
  if (u.status !== 'completed') u.handedIn = false;
}

/** Override fields for the changed keys ('checklist' is handled separately: only a changed structure counts). */
export function changedFields(c: ExerciseChanges): OverridableField[] {
  return CHANGE_FIELDS.filter(([, key]) => c[key] !== undefined).map(([f]) => f);
}

/** The steps of a checklist without their done state, to tell a changed structure from ticked steps. */
export function checklistSteps(items: { text: string }[]): string {
  return JSON.stringify(items.map((i) => i.text));
}

export function seriesTitle(base: string, n: number): string {
  return `${base} ${String(n).padStart(2, '0')}`;
}
