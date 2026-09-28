import { describe, expect, it } from 'vitest';
import { addMonths, daysInMonth, formatMonth, startOfMonth } from '../src/shared/dates';

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
