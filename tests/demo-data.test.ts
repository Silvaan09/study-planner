import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/main/db/database';
import { StudyService } from '../src/main/service';
import { seedDemo } from '../src/main/demoData';

let dir: string;
let svc: StudyService;
let close: () => void;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-demo-'));
  const opened = openDatabase(dir);
  svc = new StudyService(opened.db);
  close = () => opened.db.close();
});

afterEach(() => {
  close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('demo data (npm run seed-demo)', () => {
  it('builds a semester in progress as of the given day', () => {
    const today = '2026-09-28';
    const { semesterId } = seedDemo(svc, today);
    const overview = svc.subjectOverview(semesterId);
    expect(overview.map((o) => o.subject.name)).toEqual(['Chemistry', 'Computer Science', 'Mathematics', 'Physics']);

    // Week 2 is a full week in the past: everything done except the one missed lecture.
    const week2 = svc.getWeek(semesterId, '2026-09-21');
    expect(week2.lectures).toHaveLength(12);
    expect(week2.lectures.filter((l) => !l.completed).map((l) => l.title)).toEqual(['Programming Tutorial']);

    // Nothing in the future is completed.
    expect(svc.getWeek(semesterId, '2026-10-05').lectures.some((l) => l.completed)).toBe(false);

    const out = svc.getOutstanding(semesterId, today);
    const overdue = out.items.filter((i) => i.kind === 'exercise' && i.overdue).map((i) => (i.kind === 'exercise' ? i.exercise.title : ''));
    expect(overdue.sort()).toEqual(['Git Basics Quiz', 'Mechanics Problems 01']);
    // The two missed lectures, plus today's (Monday's) two, which are still open.
    expect(out.items.filter((i) => i.kind === 'lecture').map((i) => i.date)).toEqual(['2026-09-16', '2026-09-24', '2026-09-28', '2026-09-28']);

    // Exams: every subject has at least one, listed by date.
    expect(overview.map((o) => o.exams.length)).toEqual([1, 1, 2, 1]);
    const todayData = svc.getToday(semesterId, today);
    expect(todayData.exams.map((e) => e.date)).toEqual(['2026-11-04', '2026-11-11', '2026-12-16', '2027-01-25', '2027-02-01']);

    // Checklists follow the status: Lab Report 01 (due today, planned before) is half done.
    const lab = overview[3].exercises.find((e) => e.title === 'Lab Report 01')!;
    expect(lab.checklist.map((c) => c.done)).toEqual([true, true, true, false, false]);
    expect(lab.status).toBe('in_progress');
    // The essay (due tomorrow, planned days past) is done but not handed in, so it is still outstanding.
    const essay = overview[0].exercises.find((e) => e.title === 'Essay: Chemical Bonding')!;
    expect([essay.status, essay.handedIn, essay.checklist.every((c) => c.done)]).toEqual(['completed', false, true]);
    expect(out.items.some((i) => i.kind === 'exercise' && i.exercise.id === essay.id)).toBe(true);
    // Exercises due before today are handed in.
    const set1 = overview[2].exercises.find((e) => e.title === 'Problem Set 01')!;
    expect([set1.status, set1.handedIn]).toEqual(['completed', true]);
    const lab2 = overview[3].exercises.find((e) => e.title === 'Lab Report 02')!;
    expect(lab2.checklist.every((c) => !c.done)).toBe(true);
  });
});
