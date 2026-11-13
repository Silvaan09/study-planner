// Credits and results of subjects: Swiss grades (1–6, 6 best, passed from 4) or pass/fail. Pure, shared by the
// service (validation) and the Semesters page (averages).
import type { Subject } from './types';

export const GRADE_MIN = 1;
export const GRADE_MAX = 6;
export const PASS_GRADE = 4;
export const MAX_CREDITS = 1000;

/** Whether `n` has at most two decimals (4.12 yes, 4.125 no), tolerant of floating-point noise. */
export function twoDecimals(n: number): boolean {
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A typed number, with a comma or a point as the decimal mark. '' → null; anything else unreadable → NaN. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  return /^\d+(\.\d*)?$|^\.\d+$/.test(t) ? Number(t) : NaN;
}

/** 4.5 → "4.5", 4.12 → "4.12", 5 → "5". */
export function formatNumber(n: number): string {
  return String(round2(n));
}

/** An average, always with two decimals: "4.83". */
export function formatAverage(n: number): string {
  return round2(n).toFixed(2);
}

/** "6 credits", "1.5 credits", "1 credit". */
export function formatCredits(n: number): string {
  return `${formatNumber(n)} credit${n === 1 ? '' : 's'}`;
}

/** Passed / failed, or null while there is no result (and always for the personal subject). */
export function subjectOutcome(s: Pick<Subject, 'assessment' | 'grade' | 'passed' | 'personal'>): 'passed' | 'failed' | null {
  if (s.personal) return null;
  if (s.assessment === 'pass_fail') return s.passed === null ? null : s.passed ? 'passed' : 'failed';
  return s.grade === null ? null : s.grade >= PASS_GRADE ? 'passed' : 'failed';
}

/** The result as shown: "5.25", "Passed", "Failed", or null. */
export function resultLabel(s: Pick<Subject, 'assessment' | 'grade' | 'passed' | 'personal'>): string | null {
  if (s.personal) return null;
  if (s.assessment === 'pass_fail') return s.passed === null ? null : s.passed ? 'Passed' : 'Failed';
  return s.grade === null ? null : formatNumber(s.grade);
}

export interface GradeStats {
  /** Credit-weighted average of the graded subjects that have a grade and credits; null when there are none. */
  average: number | null;
  /** Credits behind the average (graded subjects with a grade). */
  gradedCredits: number;
  /** Credits of every subject (with or without a result). */
  totalCredits: number;
  /** Credits of the passed subjects (grade ≥ 4, or "Passed"). */
  earnedCredits: number;
  /** Subjects that have a result. */
  withResult: number;
  /** Graded subjects with a grade but no credits: they have no weight, so they aren't in the average. */
  gradesWithoutCredits: number;
}

/** Averages and credits over `subjects` (the personal subject is ignored). */
export function gradeStats(subjects: Pick<Subject, 'assessment' | 'grade' | 'passed' | 'personal' | 'credits'>[]): GradeStats {
  let weighted = 0;
  let weight = 0;
  const stats: GradeStats = { average: null, gradedCredits: 0, totalCredits: 0, earnedCredits: 0, withResult: 0, gradesWithoutCredits: 0 };
  for (const s of subjects) {
    if (s.personal) continue;
    const credits = s.credits ?? 0;
    stats.totalCredits += credits;
    const outcome = subjectOutcome(s);
    if (outcome !== null) stats.withResult++;
    if (outcome === 'passed') stats.earnedCredits += credits;
    if (s.assessment === 'grade' && s.grade !== null) {
      if (credits > 0) {
        weighted += s.grade * credits;
        weight += credits;
      } else stats.gradesWithoutCredits++;
    }
  }
  stats.totalCredits = round2(stats.totalCredits);
  stats.earnedCredits = round2(stats.earnedCredits);
  stats.gradedCredits = round2(weight);
  if (weight > 0) stats.average = weighted / weight;
  return stats;
}
