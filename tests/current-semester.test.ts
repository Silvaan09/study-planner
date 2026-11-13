import { describe, expect, it } from 'vitest';
import { currentSemesterId, initialWeek, semesterLastDay } from '../src/shared/currentSemester';

const span = (id: number, startDate: string, endDate: string, studyEnd?: string) => ({
  semester: { id, name: `S${id}`, startDate, endDate },
  studyPeriod: studyEnd ? { startDate: '2000-01-01', endDate: studyEnd } : null,
});

const autumn = span(1, '2026-09-14', '2026-12-18', '2027-02-01');
const spring = span(2, '2027-02-15', '2027-05-28');
const list = [spring, autumn]; // newest first, as listed by the service

describe('current semester', () => {
  it('counts the exam study period as part of the semester', () => {
    expect(semesterLastDay(autumn)).toBe('2027-02-01');
    expect(semesterLastDay(spring)).toBe('2027-05-28');
    expect(currentSemesterId(list, '2026-10-01')).toBe(1);
    // In January the spring semester already exists, but the exams of autumn are what matters.
    expect(currentSemesterId(list, '2027-01-12')).toBe(1);
  });

  it('between semesters picks the next one, after the last one the latest', () => {
    expect(currentSemesterId(list, '2027-02-08')).toBe(2);
    expect(currentSemesterId(list, '2026-08-01')).toBe(1);
    expect(currentSemesterId(list, '2027-08-01')).toBe(2);
    expect(currentSemesterId([], '2027-08-01')).toBeNull();
  });

  it('prefers the later one when two overlap', () => {
    expect(currentSemesterId([span(1, '2026-09-14', '2026-12-18', '2027-03-01'), spring], '2027-02-20')).toBe(2);
  });
});

describe('initial week', () => {
  it('opens on this week during the semester and its exam study period', () => {
    expect(initialWeek(autumn, '2026-10-01')).toBe('2026-09-28');
    expect(initialWeek(autumn, '2027-01-14')).toBe('2027-01-11');
  });

  it('opens on the first week before it starts and on the last after it ended', () => {
    expect(initialWeek(autumn, '2026-08-01')).toBe('2026-09-14');
    expect(initialWeek(autumn, '2027-03-01')).toBe('2027-02-01');
    expect(initialWeek(spring, '2027-07-01')).toBe('2027-05-24');
  });
});
