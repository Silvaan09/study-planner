// Which semester and week the app opens on (pure, see tests/current-semester.test.ts).
import { startOfWeek, type ISODate } from './dates';
import type { Id, Semester, StudyPeriod } from './types';

interface Span {
  semester: Semester;
  studyPeriod: StudyPeriod | null;
}

/** A semester's last day, counting its exam study period. */
export function semesterLastDay({ semester, studyPeriod }: Span): ISODate {
  return studyPeriod && studyPeriod.endDate > semester.endDate ? studyPeriod.endDate : semester.endDate;
}

/**
 * The semester today belongs to: the one running today, counting its exam study period (the latest-starting one if
 * they overlap); between semesters the next one to start; after the last one, the latest.
 */
export function currentSemesterId(list: Span[], today: ISODate): Id | null {
  if (list.length === 0) return null;
  const byStart = [...list].sort((a, b) => a.semester.startDate.localeCompare(b.semester.startDate));
  const running = byStart.filter((s) => s.semester.startDate <= today && today <= semesterLastDay(s));
  if (running.length) return running[running.length - 1].semester.id;
  const next = byStart.find((s) => s.semester.startDate > today);
  return (next ?? byStart[byStart.length - 1]).semester.id;
}

/** The timetable week to open a semester on: this week while it runs (study period included), else its first or last week. */
export function initialWeek(span: Span, today: ISODate): ISODate {
  if (today < span.semester.startDate) return startOfWeek(span.semester.startDate);
  const last = semesterLastDay(span);
  return startOfWeek(today > last ? last : today);
}
