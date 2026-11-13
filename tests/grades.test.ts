import { describe, expect, it } from 'vitest';
import { formatAverage, formatCredits, formatNumber, gradeStats, parseDecimal, resultLabel, subjectOutcome, twoDecimals } from '../src/shared/grades';
import type { Subject } from '../src/shared/types';

const subject = (o: Partial<Subject>): Subject => ({
  id: 1,
  semesterId: 1,
  name: 'S',
  color: '#000000',
  personal: false,
  assessment: 'grade',
  credits: null,
  grade: null,
  passed: null,
  ...o,
});

describe('grades', () => {
  it('reads numbers with a comma or a point', () => {
    expect(parseDecimal('4.12')).toBe(4.12);
    expect(parseDecimal(' 4,5 ')).toBe(4.5);
    expect(parseDecimal('6')).toBe(6);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNaN();
    expect(parseDecimal('-1')).toBeNaN();
    expect(twoDecimals(4.12)).toBe(true);
    expect(twoDecimals(4.125)).toBe(false);
    expect(twoDecimals(0.1 + 0.2)).toBe(true);
  });

  it('formats grades, averages and credits', () => {
    expect(formatNumber(4.5)).toBe('4.5');
    expect(formatNumber(5)).toBe('5');
    expect(formatAverage(4.8333)).toBe('4.83');
    expect(formatAverage(5)).toBe('5.00');
    expect(formatCredits(1)).toBe('1 credit');
    expect(formatCredits(7.5)).toBe('7.5 credits');
  });

  it('passed from 4.0, or by hand for pass/fail', () => {
    expect(subjectOutcome(subject({ grade: 4 }))).toBe('passed');
    expect(subjectOutcome(subject({ grade: 3.99 }))).toBe('failed');
    expect(subjectOutcome(subject({}))).toBeNull();
    expect(subjectOutcome(subject({ assessment: 'pass_fail', passed: false }))).toBe('failed');
    expect(resultLabel(subject({ assessment: 'pass_fail', passed: true }))).toBe('Passed');
    expect(resultLabel(subject({ grade: 5.25 }))).toBe('5.25');
    expect(resultLabel(subject({ personal: true, grade: 5 }))).toBeNull();
  });

  it('averages by credits; pass/fail and grades without credits have no weight; earned = passed only', () => {
    const stats = gradeStats([
      subject({ grade: 5.5, credits: 6 }),
      subject({ grade: 4, credits: 3 }),
      subject({ grade: 3.5, credits: 3 }), // failed: in the average, no earned credits
      subject({ grade: 6, credits: null }), // no weight
      subject({ assessment: 'pass_fail', passed: true, credits: 2 }),
      subject({ credits: 4 }), // no result yet
      subject({ personal: true, credits: 9, grade: 1 }),
    ]);
    expect(stats.average).toBeCloseTo((5.5 * 6 + 4 * 3 + 3.5 * 3) / 12);
    expect(stats.gradedCredits).toBe(12);
    expect(stats.totalCredits).toBe(18);
    expect(stats.earnedCredits).toBe(11);
    expect(stats.withResult).toBe(5);
    expect(stats.gradesWithoutCredits).toBe(1);
    expect(gradeStats([subject({ credits: 3 })]).average).toBeNull();
  });
});
