import type { ISODate } from './dates';

export type Id = number;

export type ExerciseStatus = 'not_started' | 'in_progress' | 'completed';
export const EXERCISE_STATUSES: ExerciseStatus[] = ['not_started', 'in_progress', 'completed'];
export const EXERCISE_STATUS_LABEL: Record<ExerciseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** Scope for edits/deletes of recurring items. */
export type Scope = 'this' | 'future' | 'all';

export interface Semester {
  id: Id;
  name: string;
  startDate: ISODate;
  endDate: ISODate;
}

export interface Subject {
  id: Id;
  semesterId: Id;
  name: string;
  color: string;
}

/** A recurring weekly lecture definition. */
export interface Lecture {
  id: Id;
  subjectId: Id;
  title: string;
  weekday: number; // 1 = Monday ... 7 = Sunday
  startTime: string; // "HH:MM"
  endTime: string;
}

/** One concrete weekly occurrence of a lecture. */
export interface LectureOccurrence {
  lectureId: Id;
  subjectId: Id;
  title: string;
  date: ISODate;
  weekStart: ISODate;
  startTime: string;
  endTime: string;
  completed: boolean;
}

export interface ExerciseSeries {
  id: Id;
  subjectId: Id;
  baseTitle: string;
  intervalWeeks: number;
  nextNumber: number;
}

export type OverridableField = 'title' | 'description' | 'plannedDate' | 'deadlineDate' | 'subjectId';

export interface Exercise {
  id: Id;
  subjectId: Id;
  seriesId: Id | null;
  sequenceNumber: number | null;
  title: string;
  description: string;
  /** Earliest planned date (same as plannedDates[0]). */
  plannedDate: ISODate;
  /** Every day this exercise is planned to be worked on, sorted ascending (at least one). */
  plannedDates: ISODate[];
  deadlineDate: ISODate;
  status: ExerciseStatus;
  /** Fields changed on this occurrence individually (series members only). 'plannedDate' covers all planned dates. */
  overrides: OverridableField[];
}

export interface WeekData {
  weekStart: ISODate;
  subjects: Subject[];
  lectures: LectureOccurrence[];
  /** Exercises with a planned date or the deadline within the week. */
  exercises: Exercise[];
  series: ExerciseSeries[];
}

export type OutstandingItem =
  | { kind: 'lecture'; date: ISODate; occurrence: LectureOccurrence }
  | { kind: 'exercise'; date: ISODate; exercise: Exercise; overdue: boolean };

export interface Outstanding {
  subjects: Subject[];
  items: OutstandingItem[];
}

export interface SubjectOverview {
  subject: Subject;
  lectures: Lecture[];
  series: (ExerciseSeries & { occurrenceCount: number })[];
  exerciseCount: number;
}

export type TrashKind =
  | 'semester'
  | 'subject'
  | 'lecture'
  | 'lecture_occurrences'
  | 'exercise'
  | 'exercise_occurrences'
  | 'exercise_series';

export interface TrashEntry {
  id: Id;
  kind: TrashKind;
  label: string;
  detail: string;
  deletedAt: string;
  itemCount: number;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  schemaVersion: number;
  isDev: boolean;
}

// ---- Inputs ----

export interface SemesterInput {
  name: string;
  startDate: ISODate;
  endDate: ISODate;
}

export interface SubjectInput {
  semesterId: Id;
  name: string;
  color: string;
}

export interface LectureInput {
  subjectId: Id;
  title: string;
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface ExerciseCreateInput {
  subjectId: Id;
  title: string;
  description: string;
  /** Days to work on it. For a recurring exercise, this pattern repeats in every occurrence. */
  plannedDates: ISODate[];
  deadlineDate: ISODate;
  status?: ExerciseStatus;
  recurrence?: {
    intervalWeeks: number;
    count: number;
    firstNumber: number;
  };
}

export interface ExerciseChanges {
  /** For scope 'this': the full title. For 'future'/'all': the series base title. */
  title?: string;
  description?: string;
  subjectId?: Id;
  /** For 'future'/'all': the same pattern is applied to each affected occurrence, shifted by its position in the series. */
  plannedDates?: ISODate[];
  deadlineDate?: ISODate;
  status?: ExerciseStatus;
}

export interface ExerciseUpdateInput {
  id: Id;
  scope: Scope;
  changes: ExerciseChanges;
  /**
   * How to treat other occurrences that were modified individually.
   * Undefined = ask first (the call returns the conflicts without changing anything).
   */
  overridePolicy?: 'overwrite' | 'keep';
}

export interface OverrideConflict {
  id: Id;
  title: string;
  fields: OverridableField[];
}

export type ExerciseUpdateResult = { status: 'updated'; count: number } | { status: 'conflicts'; conflicts: OverrideConflict[] };

export interface DeleteResult {
  trashId: Id;
  label: string;
}

/** Every call the renderer can make into the data layer. */
export interface StudyApi {
  appInfo(): AppInfo;

  listSemesters(): Semester[];
  createSemester(input: SemesterInput): Semester;
  updateSemester(id: Id, input: SemesterInput): Semester;
  deleteSemester(id: Id): DeleteResult;

  listSubjects(semesterId: Id): Subject[];
  subjectOverview(semesterId: Id): SubjectOverview[];
  createSubject(input: SubjectInput): Subject;
  updateSubject(id: Id, input: SubjectInput): Subject;
  deleteSubject(id: Id): DeleteResult;

  createLecture(input: LectureInput): Lecture;
  updateLecture(id: Id, input: LectureInput): Lecture;
  getLecture(id: Id): Lecture;
  /** weekStart identifies the occurrence for scopes 'this' and 'future'. */
  deleteLecture(id: Id, scope: Scope, weekStart: ISODate): DeleteResult;
  setLectureCompleted(lectureId: Id, weekStart: ISODate, completed: boolean): void;

  getExercise(id: Id): Exercise;
  getSeries(id: Id): ExerciseSeries;
  createExercise(input: ExerciseCreateInput): Exercise[];
  updateExercise(input: ExerciseUpdateInput): ExerciseUpdateResult;
  setExerciseStatus(id: Id, status: ExerciseStatus): void;
  /** Quick reschedule (drag & drop) of one planned date. Always applies to this occurrence only. */
  moveExercise(id: Id, fromDate: ISODate, toDate: ISODate): Exercise;
  deleteExercise(id: Id, scope: Scope): DeleteResult;
  extendSeries(seriesId: Id, count: number): Exercise[];

  getWeek(semesterId: Id, weekStart: ISODate): WeekData;
  getOutstanding(semesterId: Id, today: ISODate): Outstanding;

  listTrash(): TrashEntry[];
  restoreTrash(id: Id): void;
  purgeTrash(id: Id): void;
  emptyTrash(): void;

  createBackup(): string;
  openDataFolder(): void;
}

export type ApiMethod = keyof StudyApi;

export type ApiResponse<T> = { ok: true; value: T } | { ok: false; error: string; userError: boolean };
