import type { CSSProperties } from 'react';
import { addDays, timeToMinutes, type ISODate } from '../../../shared/dates';
import type { LectureOccurrence, WeekData } from '../../../shared/types';

export const HOUR_PX = 64;

interface Positioned {
  occ: LectureOccurrence;
  start: number;
  end: number;
  col: number;
  cols: number;
}

/** Places overlapping lectures side by side. */
function layoutDay(lectures: LectureOccurrence[]): Positioned[] {
  const items = lectures
    .map((occ) => ({ occ, start: timeToMinutes(occ.startTime), end: timeToMinutes(occ.endTime), col: 0, cols: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: Positioned[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    for (const p of cluster) p.cols = colEnds.length;
    cluster = [];
    colEnds = [];
  };
  for (const p of items) {
    if (p.start >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= p.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(p.end);
    } else colEnds[col] = p.end;
    p.col = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.end);
  }
  flush();
  return items;
}

/** What one week's grid needs from its data: the days, visible hours, lecture placement and column widths. */
export function weekLayout(week: WeekData | undefined, weekStart: ISODate) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  // Visible hours: 07:00–21:00 by default (last row starts at 20:00), widened to fit this week's lectures.
  let lo = 7 * 60;
  let hi = 21 * 60;
  for (const l of week?.lectures ?? []) {
    lo = Math.min(lo, timeToMinutes(l.startTime));
    hi = Math.max(hi, timeToMinutes(l.endTime));
  }
  const firstHour = Math.floor(lo / 60);
  const lastHour = Math.min(24, Math.ceil(hi / 60));
  const lecturesByDay = new Map(days.map((d) => [d, layoutDay((week?.lectures ?? []).filter((l) => l.date === d))]));
  // Days with lectures side by side get wider so each lecture stays readable; empty days give up some width.
  const dayColumns = days
    .map((d) => {
      const cols = Math.max(0, ...lecturesByDay.get(d)!.map((p) => p.cols));
      const hasExercises =
        (week?.exercises ?? []).some((e) => e.plannedDates.includes(d) || e.deadlineDate === d) || (week?.exams ?? []).some((x) => x.date === d);
      const weight = cols === 0 && !hasExercises ? 0.7 : cols <= 1 ? 1 : cols === 2 ? 1.6 : 2.2;
      return `minmax(0, ${weight}fr)`;
    })
    .join(' ');
  return {
    week,
    days,
    firstHour,
    lastHour,
    lecturesByDay,
    hours: Array.from({ length: lastHour - firstHour }, (_, i) => firstHour + i),
    style: { '--hour': `${HOUR_PX}px`, '--days': dayColumns } as CSSProperties,
  };
}

export type WeekLayout = ReturnType<typeof weekLayout>;

/** The time (minutes since midnight) at the top of a week's time grid, just below its sticky rows. */
export function topMinute(scroll: HTMLElement | null): number | null {
  if (!scroll) return null;
  return Number(scroll.dataset.firstHour) * 60 + (scroll.scrollTop / HOUR_PX) * 60;
}

/** Scrolls a week's time grid so that `minute` is at its top. */
export function scrollToMinute(scroll: HTMLElement, minute: number): void {
  scroll.scrollTop = ((minute - Number(scroll.dataset.firstHour) * 60) / 60) * HOUR_PX;
}

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function defaultPlannedDate(weekStart: ISODate, today: ISODate): ISODate {
  // New exercises default to today when viewing the current week, otherwise the week's Monday.
  return today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart;
}
