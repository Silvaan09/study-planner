import { describe, expect, it } from 'vitest';
import { addMonths, daysInMonth, formatCountdown, formatMonth, startOfMonth } from '../src/shared/dates';

describe('month helpers (date picker)', () => {
  it('finds the first day and length of a month', () => {
    expect(startOfMonth('2026-09-28')).toBe('2026-09-01');
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('adds months across years and clamps to the end of shorter months', () => {
    expect(addMonths('2026-09-28', 1)).toBe('2026-10-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-10', -1)).toBe('2025-12-10');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonths('2026-09-28', -12)).toBe('2025-09-28');
  });

  it('formats the month title', () => {
    expect(formatMonth('2026-09-28')).toBe('September 2026');
  });
});

describe('countdown (exams)', () => {
  it('describes how far a date is from today', () => {
    const t = '2026-09-29';
    expect(formatCountdown(t, t)).toBe('Today');
    expect(formatCountdown(t, '2026-09-30')).toBe('Tomorrow');
    expect(formatCountdown(t, '2026-09-28')).toBe('Yesterday');
    expect(formatCountdown(t, '2026-09-25')).toBe('4 days ago');
    expect(formatCountdown(t, '2026-10-19')).toBe('in 20 days');
    expect(formatCountdown(t, '2026-10-20')).toBe('in 3 weeks');
    expect(formatCountdown(t, '2026-11-04')).toBe('in 5 weeks, 1 day');
  });
});
