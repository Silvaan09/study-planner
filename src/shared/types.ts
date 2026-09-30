import type { ISODate } from './dates';

export type Id = number;

export type ExerciseStatus = 'not_started' | 'in_progress' | 'completed';
export const EXERCISE_STATUSES: ExerciseStatus[] = ['not_started', 'in_progress', 'completed'];
export const EXERCISE_STATUS_LABEL: Record<ExerciseStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Done',
};

/** Where an exercise stands overall: its work status, or handed in (done and the deadline dealt with). */
export type ExerciseStage = ExerciseStatus | 'handed_in';
export const EXERCISE_STAGES: ExerciseStage[] = [...EXERCISE_STATUSES, 'handed_in'];
export const EXERCISE_STAGE_LABEL: Record<ExerciseStage, string> = { ...EXERCISE_STATUS_LABEL, handed_in: 'Handed in' };
export function exerciseStage(e: Pick<Exercise, 'status' | 'handedIn'>): ExerciseStage {
  return e.handedIn ? 'handed_in' : e.status;
}

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

export type OverridableField = 'title' | 'description' | 'plannedDate' | 'deadlineDate' | 'subjectId' | 'checklist';

/** One step of an exercise's checklist. */
export interface ChecklistItem {
  id: Id;
  text: string;
  done: boolean;
}

export interface ChecklistItemInput {
  text: string;
  done: boolean;
}

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
  /** Progress of the work itself (the planned "To do" days). */
  status: ExerciseStatus;
  /** Handed in / dealt with by the deadline (the "Due" side). Implies status 'completed'. */
  handedIn: boolean;
  /** Optional sub-steps, in order. */
  checklist: ChecklistItem[];
  /**
   * Fields changed on this occurrence individually (series members only). 'plannedDate' covers all planned dates;
   * 'checklist' means its steps (not their done state) differ from the series.
   */
  overrides: OverridableField[];
}

export type ExamKind = 'midterm' | 'endterm' | 'final' | 'other';
export const EXAM_KINDS: ExamKind[] = ['midterm', 'endterm', 'final', 'other'];
export const EXAM_KIND_LABEL: Record<ExamKind, string> = {
  midterm: 'Midterm',
  endterm: 'Endterm',
  final: 'Final',
  other: 'Exam',
};

export interface Exam {
  id: Id;
  subjectId: Id;
  kind: ExamKind;
  /** Optional; the kind's label is shown when empty (see examTitle). */
  title: string;
  date: ISODate;
  /** "HH:MM" or null when the time isn't known yet. */
  startTime: string | null;
  endTime: string | null;
  location: string;
  notes: string;
}

/** The exam's own title, or its kind ("Midterm") when it has none. */
export function examTitle(e: Pick<Exam, 'title' | 'kind'>): string {
  return e.title || EXAM_KIND_LABEL[e.kind];
}

/** Completion counts of one week, as shown in the timetable header. */
export interface WeekProgress {
  lectures: number;
  lecturesDone: number;
  /** Exercises with at least one planned date in the week. */
  exercises: number;
  exercisesDone: number;
  exercisesInProgress: number;
}

export interface SemesterWeekProgress extends WeekProgress {
  weekStart: ISODate;
}

export interface WeekData {
  weekStart: ISODate;
  subjects: Subject[];
  lectures: LectureOccurrence[];
  /** Exercises with a planned date or the deadline within the week. */
  exercises: Exercise[];
  series: ExerciseSeries[];
  /** Exams on a day of the week. */
  exams: Exam[];
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
  /** Live exercises of the subject (series occurrences and standalone), by deadline. */
  exercises: Exercise[];
  exerciseCount: number;
  /** Live exams of the subject, by date. */
  exams: Exam[];
}

/** Consecutive days with everything done (see computeStreak). */
export interface Streak {
  current: number;
  best: number;
  /** Today's state: 'done' counts towards the streak, 'open' doesn't break it (yet), 'empty' = nothing scheduled. */
  today: 'done' | 'open' | 'empty';
}

/** Everything the Today view shows. */
export interface TodayData {
  today: ISODate;
  subjects: Subject[];
  /** Today's lecture occurrences, by start time. */
  lectures: LectureOccurrence[];
  /** Lecture occurrences of the next 7 days after today (for "Up next" once today's are over). */
  upcomingLectures: LectureOccurrence[];
  /** Exercises planned for today, any status. */
  planned: Exercise[];
  /** Uncompleted exercises due today or within the next 7 days, by deadline. */
  dueSoon: Exercise[];
  /** Uncompleted exercises whose deadline has passed, oldest first. */
  overdue: Exercise[];
  /** Past lecture occurrences (before today) that aren't completed. */
  missedLectures: LectureOccurrence[];
  /** Exams from today on, by date. */
  exams: Exam[];
  streak: Streak;
}

export type TrashKind =
  | 'semester'
  | 'subject'
  | 'lecture'
  | 'lecture_occurrences'
  | 'exercise'
  | 'exercise_occurrences'
  | 'exercise_series'
  | 'exam';

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
  /** Requires status 'completed' (or none: then it is set). Recurring: first occurrence only, like status. */
  handedIn?: boolean;
  /** For a recurring exercise, every occurrence gets these steps (only the first keeps their done state). */
  checklist?: ChecklistItemInput[];
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
  /** Applies to this exercise only. A status other than 'completed' also clears handedIn. */
  status?: ExerciseStatus;
  /** Applies to this exercise only. true also sets status 'completed'. */
  handedIn?: boolean;
  /**
   * The full checklist. For 'future'/'all' the steps are copied to each affected occurrence (keeping the done state
   * of steps it already had); done states set here apply to this exercise only, like status.
   */
  checklist?: ChecklistItemInput[];
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

export interface ExamInput {
  subjectId: Id;
  kind: ExamKind;
  title: string;
  date: ISODate;
  startTime: string | null;
  endTime: string | null;
  location: string;
  notes: string;
}

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
  /** Work status. Anything but 'completed' also clears handedIn. */
  setExerciseStatus(id: Id, status: ExerciseStatus): void;
  /** Handing in also marks the work completed; taking it back leaves the status as it is. */
  setExerciseHandedIn(id: Id, handedIn: boolean): void;
  /** Quick reschedule (drag & drop) of one planned date. Always applies to this occurrence only. */
  moveExercise(id: Id, fromDate: ISODate, toDate: ISODate): Exercise;
  deleteExercise(id: Id, scope: Scope): DeleteResult;
  extendSeries(seriesId: Id, count: number): Exercise[];
  /** Ticks one checklist step; ticking a step of a not-started exercise marks it in progress. */
  setChecklistItemDone(itemId: Id, done: boolean): Exercise;

  getExam(id: Id): Exam;
  createExam(input: ExamInput): Exam;
  updateExam(id: Id, input: ExamInput): Exam;
  deleteExam(id: Id): DeleteResult;

  getWeek(semesterId: Id, weekStart: ISODate): WeekData;
  getOutstanding(semesterId: Id, today: ISODate): Outstanding;
  /** Progress of every week of the semester, in order (for the week picker). */
  getSemesterProgress(semesterId: Id): SemesterWeekProgress[];
  getToday(semesterId: Id, today: ISODate): TodayData;

  listTrash(): TrashEntry[];
  restoreTrash(id: Id): void;
  purgeTrash(id: Id): void;
  emptyTrash(): void;

  createBackup(): string;
  openDataFolder(): void;
}

export type ApiMethod = keyof StudyApi;

export type ApiResponse<T> = { ok: true; value: T } | { ok: false; error: string; userError: boolean };
