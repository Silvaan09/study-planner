import type { Dispatch, DragEvent, RefObject, SetStateAction } from 'react';
import type { ISODate } from '../../../shared/dates';
import type { Exam, Exercise, ExerciseStatus, LectureOccurrence, WeekData } from '../../../shared/types';
import type { Dragging } from './useDragDrop';

/**
 * Everything the week grid's render functions use from `TimetableView`, built anew on each render. The grid parts are
 * plain functions called from `renderWeek` (not components), exactly as when they were inline.
 */
export interface WeekContext {
  today: ISODate;
  nowMin: number;
  // Refs of the panes' scroll containers and the current pane's sticky block.
  scrollRef: RefObject<HTMLDivElement | null>;
  prevScrollRef: RefObject<HTMLDivElement | null>;
  nextScrollRef: RefObject<HTMLDivElement | null>;
  stickyRef: RefObject<HTMLDivElement | null>;
  alignPanes: () => void;
  // Days and drag & drop.
  dayClass: (day: ISODate, week: WeekData | undefined) => string;
  dropProps: (day: ISODate) => {
    onDragOver: (ev: DragEvent) => void;
    onDragLeave: (ev: DragEvent) => void;
    onDrop: (ev: DragEvent) => void;
  };
  canDrop: (day: ISODate) => boolean;
  dragging: Dragging | null;
  setDragging: Dispatch<SetStateAction<Dragging | null>>;
  dropDay: ISODate | null;
  setDropDay: Dispatch<SetStateAction<ISODate | null>>;
  // Subjects.
  colorOf: (subjectId: number) => string;
  subjectName: (subjectId: number) => string;
  dim: (subjectId: number) => string;
  // Menus.
  dayMenu: (ev: React.MouseEvent, day: ISODate, week: WeekData | undefined) => void;
  lectureMenu: (ev: React.MouseEvent, o: LectureOccurrence) => void;
  exerciseMenu: (ev: React.MouseEvent, e: Exercise, day?: ISODate) => void;
  examMenu: (ev: React.MouseEvent, x: Exam) => void;
  // Exercises, exams and lectures.
  cardStatus: (e: Exercise, day: ISODate) => ExerciseStatus;
  cycleStatus: (e: Exercise, day: ISODate) => void;
  toggleHandedIn: (e: Exercise) => unknown;
  toggleLecture: (o: LectureOccurrence) => unknown;
  openExercise: (id: number) => unknown;
  openExam: (id: number) => unknown;
  newExercise: (plannedDate?: ISODate) => unknown;
  newDeadline: (deadlineDate: ISODate) => unknown;
  newLecture: (weekday?: number, startMin?: number) => unknown;
  checklistFor: { id: number; anchor: HTMLElement } | null;
  setChecklistFor: Dispatch<SetStateAction<{ id: number; anchor: HTMLElement } | null>>;
}
